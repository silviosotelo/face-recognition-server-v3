/**
 * DatabaseManager — PostgreSQL con pg.Pool
 *
 * Mejoras sobre el driver SQLite anterior:
 * - Pool de conexiones real: múltiples workers PM2 comparten el pool
 * - BOOLEAN / TIMESTAMPTZ nativos de PostgreSQL
 * - Índices parciales (WHERE is_active = TRUE)
 * - RETURNING id en INSERTs (sin necesidad de lastID)
 * - Reconexión automática ante caídas transitorias
 * - Misma interfaz pública: query() y run() — sin cambios en los modelos de nivel superior
 */

const { Pool } = require('pg');
const logger = require('../utils/logger');

class DatabaseManager {
    constructor() {
        this.pool = null;
        this.isConnected = false;
        this._initPromise = null;
    }

    /**
     * Inicializa el pool de conexiones.
     * Idempotente: múltiples llamadas devuelven la misma promesa.
     */
    async initialize() {
        if (this.isConnected) return;
        if (this._initPromise) return this._initPromise;

        this._initPromise = this._connect();
        return this._initPromise;
    }

    async _connect() {
        try {
            // Construir configuración: DATABASE_URL tiene prioridad sobre variables individuales
            const poolConfig = process.env.DATABASE_URL
                ? {
                    connectionString: process.env.DATABASE_URL,
                    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
                }
                : {
                    host:     process.env.PGHOST     || 'localhost',
                    port:     parseInt(process.env.PGPORT) || 5432,
                    database: process.env.PGDATABASE || 'face_recognition',
                    user:     process.env.PGUSER     || 'postgres',
                    password: process.env.PGPASSWORD || '',
                    ssl:      process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
                };

            this.pool = new Pool({
                ...poolConfig,
                // Pool sizing: min conexiones activas, max para picos
                min:                    parseInt(process.env.DB_POOL_MIN) || 2,
                max:                    parseInt(process.env.DB_POOL_MAX) || 20,
                idleTimeoutMillis:      30_000,   // cerrar conexiones ociosas a los 30 s
                connectionTimeoutMillis: parseInt(process.env.DB_TIMEOUT) || 5_000,
                maxUses:                7_500     // reconectar después de N usos (evita conexiones rancias)
            });

            // Propagar errores inesperados de conexiones ociosas del pool
            this.pool.on('error', (err, client) => {
                logger.error('❌ Error inesperado en cliente del pool PostgreSQL:', err.message);
            });

            // Verificar conexión inicial
            const client = await this.pool.connect();
            const { rows } = await client.query('SELECT version()');
            client.release();

            this.isConnected = true;
            logger.info(`✅ PostgreSQL conectado: ${rows[0].version.split(' ').slice(0, 2).join(' ')}`);
            logger.info(`   Pool: min=${this.pool.options.min} max=${this.pool.options.max}`);

            // Crear schema y aplicar índices
            await this._createSchema();

        } catch (error) {
            this._initPromise = null; // permitir reintento
            logger.error('❌ Error al conectar con PostgreSQL:', error.message);
            logger.error('   Verifica: PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD (o DATABASE_URL)');
            throw error;
        }
    }

    async _createSchema() {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // ── Tabla users ────────────────────────────────────────────
            await client.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id                   SERIAL PRIMARY KEY,
                    id_cliente           TEXT        NOT NULL DEFAULT '',
                    name                 TEXT        NOT NULL,
                    ci                   TEXT        UNIQUE NOT NULL,
                    descriptor           TEXT        NOT NULL,
                    confidence_score     REAL        DEFAULT 0,
                    created_at           TIMESTAMPTZ DEFAULT NOW(),
                    updated_at           TIMESTAMPTZ DEFAULT NOW(),
                    is_active            BOOLEAN     DEFAULT TRUE,
                    face_encoding_version TEXT       DEFAULT '4.0',
                    last_recognition_at  TIMESTAMPTZ,
                    recognition_count    INTEGER     DEFAULT 0
                )
            `);

            // ── Tabla recognition_logs ─────────────────────────────────
            await client.query(`
                CREATE TABLE IF NOT EXISTS recognition_logs (
                    id                  SERIAL PRIMARY KEY,
                    user_id             INTEGER     REFERENCES users(id) ON DELETE SET NULL,
                    recognition_type    TEXT,
                    confidence_score    REAL,
                    processing_time_ms  INTEGER,
                    success             BOOLEAN,
                    error_message       TEXT,
                    ip_address          TEXT,
                    user_agent          TEXT,
                    created_at          TIMESTAMPTZ DEFAULT NOW()
                )
            `);

            await client.query('COMMIT');

            // ── Índices (fuera de la transacción para usar CREATE INDEX CONCURRENTLY si es posible) ──
            const indexes = [
                // Índice exacto en CI para búsquedas de registro/reconocimiento
                `CREATE INDEX IF NOT EXISTS idx_users_ci
                     ON users(ci)`,

                // Índice parcial: la enorme mayoría de queries filtra is_active = TRUE
                // Este índice es ~10× más pequeño que uno completo → más rápido
                `CREATE INDEX IF NOT EXISTS idx_users_ci_active
                     ON users(ci) WHERE is_active = TRUE`,

                `CREATE INDEX IF NOT EXISTS idx_users_id_cliente
                     ON users(id_cliente)`,

                `CREATE INDEX IF NOT EXISTS idx_users_active
                     ON users(id) WHERE is_active = TRUE`,

                // Logs: búsquedas por usuario y por rango de fechas
                `CREATE INDEX IF NOT EXISTS idx_logs_user_id
                     ON recognition_logs(user_id)`,

                `CREATE INDEX IF NOT EXISTS idx_logs_created_at
                     ON recognition_logs(created_at DESC)`,

                // Índice compuesto para getStats(): GROUP BY recognition_type + filtro created_at
                `CREATE INDEX IF NOT EXISTS idx_logs_type_created
                     ON recognition_logs(recognition_type, created_at DESC)`
            ];

            for (const ddl of indexes) {
                try {
                    await this.pool.query(ddl);
                } catch (idxErr) {
                    // Ignorar si ya existe — no debería pasar con IF NOT EXISTS, pero por seguridad
                    if (!idxErr.message.includes('already exists')) {
                        logger.warn('Advertencia creando índice:', idxErr.message);
                    }
                }
            }

            logger.info('✅ Schema de PostgreSQL verificado/creado');

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    // ── API pública (misma interfaz que el DatabaseManager de SQLite) ────────

    /**
     * Ejecuta una consulta SELECT y retorna el array de filas.
     * @param {string} sql   - Query con placeholders $1, $2, ...
     * @param {Array}  params
     * @returns {Promise<Array>}
     */
    async query(sql, params = []) {
        await this.initialize();
        try {
            const result = await this.pool.query(sql, params);
            return result.rows;
        } catch (error) {
            logger.error('Error en query SQL:', { sql: sql.substring(0, 120), error: error.message });
            throw error;
        }
    }

    /**
     * Ejecuta INSERT/UPDATE/DELETE.
     * Para INSERT el SQL debe terminar en RETURNING id para que result.id sea el nuevo ID.
     * @returns {Promise<{ id: number|null, changes: number }>}
     */
    async run(sql, params = []) {
        await this.initialize();
        try {
            const result = await this.pool.query(sql, params);
            return {
                id:      result.rows[0]?.id ?? null,
                changes: result.rowCount
            };
        } catch (error) {
            logger.error('Error en run SQL:', { sql: sql.substring(0, 120), error: error.message });
            throw error;
        }
    }

    /**
     * Ejecuta una función dentro de una transacción.
     * Si la función lanza, hace ROLLBACK automático.
     * @param {Function} fn  - async (client) => { ... }
     */
    async transaction(fn) {
        await this.initialize();
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /** Cierra el pool de conexiones (graceful shutdown). */
    async close() {
        if (this.pool) {
            await this.pool.end();
            this.isConnected = false;
            this._initPromise = null;
            logger.info('🔒 Pool de PostgreSQL cerrado');
        }
    }

    /** Estadísticas del pool para /health/detailed */
    getPoolStats() {
        if (!this.pool) return { connected: false };
        return {
            connected:   this.isConnected,
            total:       this.pool.totalCount,
            idle:        this.pool.idleCount,
            waiting:     this.pool.waitingCount,
            max:         this.pool.options.max,
            min:         this.pool.options.min
        };
    }
}

module.exports = new DatabaseManager();

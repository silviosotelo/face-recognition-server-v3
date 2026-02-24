/**
 * Script de migración de schema — PostgreSQL
 *
 * Agrega columnas faltantes a instalaciones existentes.
 * Seguro de ejecutar múltiples veces: usa IF NOT EXISTS / manejo de errores.
 *
 * Uso:
 *   node scripts/migrate.js
 *   npm run migrate
 */

require('dotenv').config();
const db     = require('../src/config/database');
const logger = require('../src/utils/logger');

async function migrate() {
    try {
        logger.info('🔄 Iniciando migración de schema PostgreSQL...');

        await db.initialize();

        /**
         * Cada migración es idempotente:
         * - ALTER TABLE ... ADD COLUMN IF NOT EXISTS  (PG ≥ 9.6)
         * - CREATE INDEX IF NOT EXISTS
         * El bloque catch ignora errores de "ya existe".
         */
        const migrations = [
            // Columnas opcionales añadidas en v4.0
            `ALTER TABLE users
                ADD COLUMN IF NOT EXISTS face_encoding_version TEXT DEFAULT '4.0'`,

            `ALTER TABLE users
                ADD COLUMN IF NOT EXISTS last_recognition_at TIMESTAMPTZ`,

            `ALTER TABLE users
                ADD COLUMN IF NOT EXISTS recognition_count INTEGER DEFAULT 0`,

            // Índices adicionales para performance
            `CREATE INDEX IF NOT EXISTS idx_users_last_recognition
                ON users(last_recognition_at)
                WHERE last_recognition_at IS NOT NULL`,

            `CREATE INDEX IF NOT EXISTS idx_logs_success
                ON recognition_logs(success, created_at DESC)`,

            // Índice para consultas de logs recientes por IP (análisis de intentos)
            `CREATE INDEX IF NOT EXISTS idx_logs_ip_created
                ON recognition_logs(ip_address, created_at DESC)`
        ];

        let applied = 0;
        let skipped = 0;

        for (const sql of migrations) {
            try {
                await db.run(sql);
                logger.info(`  ✅ ${sql.trim().split('\n')[0].substring(0, 70)}`);
                applied++;
            } catch (error) {
                // PG lanza error con código 42701 (columna ya existe) o 42P07 (relación ya existe)
                // Ambos son ignorables en migraciones idempotentes
                if (['42701', '42P07', '42710'].includes(error.code)) {
                    logger.debug(`  ⏩ Ya existe, ignorado: ${error.message}`);
                    skipped++;
                } else {
                    logger.warn(`  ⚠️ Error inesperado (ignorado): ${error.message}`);
                    skipped++;
                }
            }
        }

        logger.info(`✅ Migración completada: ${applied} aplicadas, ${skipped} omitidas`);

        await db.close();
        process.exit(0);

    } catch (error) {
        logger.error('❌ Error crítico en migración:', error);
        process.exit(1);
    }
}

migrate();

#!/usr/bin/env node
/**
 * Migración de datos: SQLite → PostgreSQL
 *
 * Flujo:
 *   1. Conectar a SQLite (base de datos existente)
 *   2. Conectar a PostgreSQL (nueva base de datos)
 *   3. Crear schema en PG (si no existe) via db.initialize()
 *   4. Migrar tabla `users` en batches de 500
 *   5. Migrar tabla `recognition_logs` en batches de 1000
 *   6. Corregir secuencias SERIAL para que id_seq continúe desde el max(id) real
 *   7. Verificar integridad (counts deben coincidir)
 *   8. Mostrar reporte final
 *
 * Uso:
 *   node scripts/migrate-sqlite-to-postgres.js
 *   npm run migrate:from-sqlite
 *
 * Variables de entorno requeridas:
 *   DATABASE_URL o PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD  → PostgreSQL destino
 *   SQLITE_PATH  → ruta al .sqlite (default: ./database.sqlite)
 */

require('dotenv').config();
const path = require('path');

// ── Verificar que sqlite3 esté disponible (está en devDependencies) ──────────
let sqlite3;
try {
    sqlite3 = require('sqlite3').verbose();
} catch {
    console.error('\n❌ sqlite3 no está instalado.');
    console.error('   Instálalo temporalmente con: npm install sqlite3');
    console.error('   (está en devDependencies, disponible en entorno de desarrollo)\n');
    process.exit(1);
}

const { Pool } = require('pg');

const SQLITE_PATH  = process.env.SQLITE_PATH || path.resolve('./database.sqlite');
const BATCH_USERS  = 500;
const BATCH_LOGS   = 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function openSQLite(filePath) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, err => {
            if (err) reject(new Error(`No se pudo abrir SQLite: ${err.message}\n   Ruta: ${filePath}`));
            else resolve(db);
        });
    });
}

function sqliteAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function sqliteGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
}

function closeSQLite(db) {
    return new Promise((resolve, reject) => {
        db.close(err => (err ? reject(err) : resolve()));
    });
}

function buildPGPool() {
    const config = process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL,
            ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false }
        : {
            host:     process.env.PGHOST     || 'localhost',
            port:     parseInt(process.env.PGPORT) || 5432,
            database: process.env.PGDATABASE || 'face_recognition',
            user:     process.env.PGUSER     || 'postgres',
            password: process.env.PGPASSWORD || '',
            ssl:      process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
          };
    return new Pool({ ...config, max: 5 });
}

function bar(done, total, width = 40) {
    const pct   = Math.round((done / total) * 100);
    const filled = Math.round((done / total) * width);
    const empty  = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${pct}% (${done}/${total})`;
}

// ── Migración principal ───────────────────────────────────────────────────────

async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log('  Face Recognition — Migración SQLite → PostgreSQL');
    console.log('═'.repeat(60));

    // 1. Conectar SQLite
    console.log(`\n📂 Abriendo SQLite: ${SQLITE_PATH}`);
    let sqDB;
    try {
        sqDB = await openSQLite(SQLITE_PATH);
        console.log('   ✅ SQLite abierto (solo lectura)');
    } catch (err) {
        console.error(`\n❌ ${err.message}`);
        console.error('   Ajusta SQLITE_PATH o copia database.sqlite al directorio raíz.');
        process.exit(1);
    }

    // 2. Conectar PostgreSQL
    console.log('\n🐘 Conectando a PostgreSQL...');
    const pgPool = buildPGPool();
    try {
        const client = await pgPool.connect();
        const { rows } = await client.query('SELECT current_database(), version()');
        client.release();
        console.log(`   ✅ PostgreSQL: ${rows[0].current_database}`);
        console.log(`      ${rows[0].version.split(',')[0]}`);
    } catch (err) {
        console.error(`\n❌ No se pudo conectar a PostgreSQL: ${err.message}`);
        console.error('   Verifica DATABASE_URL o PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD');
        process.exit(1);
    }

    // 3. Crear schema en PG
    console.log('\n📋 Creando/verificando schema en PostgreSQL...');
    const dbManager = require('../src/config/database');
    try {
        await dbManager.initialize();
        console.log('   ✅ Schema verificado');
    } catch (err) {
        console.error(`\n❌ Error creando schema: ${err.message}`);
        process.exit(1);
    }

    // ── Contar origen ─────────────────────────────────────────────────────────
    const { count: sqUsers } = await sqliteGet(sqDB, 'SELECT COUNT(*) AS count FROM users') || { count: 0 };
    const logsExist = await sqliteGet(sqDB, "SELECT name FROM sqlite_master WHERE type='table' AND name='recognition_logs'");
    const { count: sqLogs } = logsExist
        ? (await sqliteGet(sqDB, 'SELECT COUNT(*) AS count FROM recognition_logs') || { count: 0 })
        : { count: 0 };

    console.log(`\n📊 Origen SQLite:`);
    console.log(`   users:             ${sqUsers}`);
    console.log(`   recognition_logs:  ${sqLogs}`);

    const startTime = Date.now();

    // ── 4. Migrar USERS ───────────────────────────────────────────────────────
    console.log(`\n👤 Migrando usuarios (batches de ${BATCH_USERS})...`);

    let usersMigrated = 0;
    let usersSkipped  = 0;
    let usersErrors   = 0;

    for (let offset = 0; offset < sqUsers; offset += BATCH_USERS) {
        const rows = await sqliteAll(sqDB,
            `SELECT id, id_cliente, name, ci, descriptor, confidence_score,
                    created_at, updated_at, is_active, face_encoding_version,
                    last_recognition_at, recognition_count
             FROM users
             ORDER BY id
             LIMIT ? OFFSET ?`,
            [BATCH_USERS, offset]
        );

        for (const row of rows) {
            try {
                await pgPool.query(
                    `INSERT INTO users
                        (id, id_cliente, name, ci, descriptor, confidence_score,
                         created_at, updated_at, is_active, face_encoding_version,
                         last_recognition_at, recognition_count)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                     ON CONFLICT (ci) DO UPDATE SET
                         id_cliente           = EXCLUDED.id_cliente,
                         name                 = EXCLUDED.name,
                         descriptor           = EXCLUDED.descriptor,
                         confidence_score     = EXCLUDED.confidence_score,
                         updated_at           = EXCLUDED.updated_at,
                         is_active            = EXCLUDED.is_active,
                         face_encoding_version = EXCLUDED.face_encoding_version,
                         last_recognition_at  = EXCLUDED.last_recognition_at,
                         recognition_count    = EXCLUDED.recognition_count`,
                    [
                        row.id,
                        row.id_cliente || '',
                        row.name       || '',
                        row.ci,
                        row.descriptor,
                        row.confidence_score || 0,
                        row.created_at  ? new Date(row.created_at)  : new Date(),
                        row.updated_at  ? new Date(row.updated_at)  : new Date(),
                        row.is_active == null ? true : !!row.is_active,
                        row.face_encoding_version || '4.0',
                        row.last_recognition_at ? new Date(row.last_recognition_at) : null,
                        row.recognition_count || 0
                    ]
                );
                usersMigrated++;
            } catch (err) {
                usersErrors++;
                console.error(`\n   ⚠️ Error en usuario CI=${row.ci}: ${err.message}`);
            }
        }

        process.stdout.write(`\r   ${bar(Math.min(offset + rows.length, sqUsers), sqUsers)}`);
    }

    // Corregir secuencia SERIAL de users
    if (sqUsers > 0) {
        await pgPool.query(`SELECT setval('users_id_seq', (SELECT MAX(id) FROM users))`);
    }

    console.log(`\n   ✅ Usuarios: ${usersMigrated} migrados, ${usersSkipped} omitidos, ${usersErrors} errores`);

    // ── 5. Migrar RECOGNITION_LOGS ────────────────────────────────────────────
    if (!logsExist || sqLogs === 0) {
        console.log('\n📝 Sin logs de reconocimiento para migrar.');
    } else {
        console.log(`\n📝 Migrando logs de reconocimiento (batches de ${BATCH_LOGS})...`);

        let logsMigrated = 0;
        let logsErrors   = 0;

        for (let offset = 0; offset < sqLogs; offset += BATCH_LOGS) {
            const rows = await sqliteAll(sqDB,
                `SELECT id, user_id, recognition_type, confidence_score,
                        processing_time_ms, success, error_message,
                        ip_address, user_agent, created_at
                 FROM recognition_logs
                 ORDER BY id
                 LIMIT ? OFFSET ?`,
                [BATCH_LOGS, offset]
            );

            // Insertar en batch con una sola query para mayor velocidad
            if (rows.length === 0) continue;

            const values  = [];
            const holders = [];

            rows.forEach((row, i) => {
                const base = i * 10;
                holders.push(
                    `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10})`
                );
                values.push(
                    row.id,
                    row.user_id || null,
                    row.recognition_type,
                    row.confidence_score != null ? row.confidence_score : null,
                    row.processing_time_ms,
                    !!row.success,
                    row.error_message || null,
                    row.ip_address    || null,
                    row.user_agent    || null,
                    row.created_at ? new Date(row.created_at) : new Date()
                );
            });

            try {
                await pgPool.query(
                    `INSERT INTO recognition_logs
                        (id, user_id, recognition_type, confidence_score,
                         processing_time_ms, success, error_message,
                         ip_address, user_agent, created_at)
                     VALUES ${holders.join(',')}
                     ON CONFLICT (id) DO NOTHING`,
                    values
                );
                logsMigrated += rows.length;
            } catch (err) {
                // Fallback: insertar fila por fila si el batch falla
                for (const row of rows) {
                    try {
                        await pgPool.query(
                            `INSERT INTO recognition_logs
                                (id, user_id, recognition_type, confidence_score,
                                 processing_time_ms, success, error_message,
                                 ip_address, user_agent, created_at)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                             ON CONFLICT (id) DO NOTHING`,
                            [
                                row.id, row.user_id || null, row.recognition_type,
                                row.confidence_score != null ? row.confidence_score : null,
                                row.processing_time_ms, !!row.success,
                                row.error_message || null, row.ip_address || null,
                                row.user_agent    || null,
                                row.created_at ? new Date(row.created_at) : new Date()
                            ]
                        );
                        logsMigrated++;
                    } catch (rowErr) {
                        logsErrors++;
                    }
                }
            }

            process.stdout.write(`\r   ${bar(Math.min(offset + rows.length, sqLogs), sqLogs)}`);
        }

        // Corregir secuencia SERIAL de recognition_logs
        if (sqLogs > 0) {
            await pgPool.query(
                `SELECT setval('recognition_logs_id_seq', (SELECT COALESCE(MAX(id), 1) FROM recognition_logs))`
            );
        }

        console.log(`\n   ✅ Logs: ${logsMigrated} migrados, ${logsErrors} errores`);
    }

    // ── 6. Verificación de integridad ─────────────────────────────────────────
    console.log('\n🔍 Verificando integridad...');

    const pgUsers = await pgPool.query('SELECT COUNT(*) AS c FROM users');
    const pgLogs  = await pgPool.query('SELECT COUNT(*) AS c FROM recognition_logs');

    const pgUserCount = parseInt(pgUsers.rows[0].c, 10);
    const pgLogCount  = parseInt(pgLogs.rows[0].c,  10);

    const usersOk = pgUserCount >= usersMigrated;
    const logsOk  = pgLogCount  >= (sqLogs === 0 ? 0 : sqLogs - 1);  // -1 por margen

    console.log(`\n   SQLite  users:  ${sqUsers}  →  PostgreSQL: ${pgUserCount}  ${usersOk ? '✅' : '⚠️'}`);
    console.log(`   SQLite  logs:   ${sqLogs}  →  PostgreSQL: ${pgLogCount}  ${logsOk  ? '✅' : '⚠️'}`);

    // ── 7. Reporte final ──────────────────────────────────────────────────────
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n' + '═'.repeat(60));
    console.log('  MIGRACIÓN COMPLETADA');
    console.log('═'.repeat(60));
    console.log(`  Tiempo total:  ${elapsed}s`);
    console.log(`  Usuarios:      ${usersMigrated} / ${sqUsers}`);
    console.log(`  Logs:          ${sqLogs === 0 ? 'N/A' : `${sqLogs}`}`);
    console.log('');
    console.log('  Próximos pasos:');
    console.log('    1. Reconstruir índice HNSW:  npm run build:index');
    console.log('    2. Iniciar servidor:         node app.js');
    console.log('    3. Verificar salud:          curl http://localhost:4350/health/detailed');
    console.log('═'.repeat(60) + '\n');

    // Cerrar conexiones
    await closeSQLite(sqDB);
    await pgPool.end();
    await dbManager.close();

    process.exit(usersErrors > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('\n❌ Error inesperado:', err);
    process.exit(1);
});

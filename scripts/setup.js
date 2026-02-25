#!/usr/bin/env node
/**
 * Setup automático al iniciar el contenedor Docker
 *
 * Ejecutado por entrypoint.sh antes de iniciar node app.js
 *
 * Pasos:
 *   1. Migración de schema PostgreSQL  (siempre — idempotente)
 *   2. Importación SQLite → PostgreSQL (si ./data/database.sqlite existe y PG está vacío)
 *   3. Construcción del índice HNSW    (si ./data/hnsw.index no existe todavía)
 */

require('dotenv').config();
const path = require('path');
const fs   = require('fs');
const { spawnSync } = require('child_process');

const SQLITE_PATH     = process.env.SQLITE_PATH
    || path.resolve('/app/data/database.sqlite');
const HNSW_INDEX_PATH = process.env.HNSW_INDEX_PATH
    || path.resolve('/app/data/hnsw.index');

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(script, args = []) {
    console.log(`\n[setup] → node ${path.basename(script)} ${args.join(' ')}`);
    const result = spawnSync('node', [script, ...args], { stdio: 'inherit' });
    return result.status === 0;
}

async function getPgUserCount() {
    // Usa el DatabaseManager existente para evitar duplicar la lógica de conexión
    const db = require(path.join(__dirname, '..', 'src', 'config', 'database'));
    try {
        await db.initialize();
        const rows = await db.query('SELECT COUNT(*) AS c FROM users');
        await db.close();
        return parseInt(rows[0].c, 10);
    } catch (err) {
        console.warn('[setup] ⚠️  No se pudo consultar PostgreSQL:', err.message);
        try { await db.close(); } catch {}
        return -1; // -1 = error (no bloquear el arranque)
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log('  Face Recognition — Setup automático');
    console.log('═'.repeat(60));

    // ── 1. Migración de schema (siempre) ──────────────────────────────────────
    console.log('\n[setup] 1/3 Migrando schema PostgreSQL...');
    if (!run(path.join(__dirname, 'migrate.js'))) {
        console.error('[setup] ❌ Falló la migración de schema. El servidor no puede arrancar.');
        process.exit(1);
    }
    console.log('[setup] ✅ Schema OK');

    // ── 2. Importación SQLite (solo si hay datos y PG está vacío) ─────────────
    if (fs.existsSync(SQLITE_PATH)) {
        console.log(`\n[setup] 2/3 Detectado ${SQLITE_PATH} — verificando PostgreSQL...`);
        const pgCount = await getPgUserCount();

        if (pgCount === 0) {
            console.log('[setup] PostgreSQL vacío — importando desde SQLite...');
            // El script puede terminar con status 1 si hay errores parciales; continuamos igual
            run(path.join(__dirname, 'migrate-sqlite-to-postgres.js'), ['--sqlite-path', SQLITE_PATH]);
        } else if (pgCount > 0) {
            console.log(`[setup] ✅ PostgreSQL ya tiene ${pgCount} usuarios — omitiendo importación SQLite.`);
        } else {
            console.log('[setup] ⚠️  No se pudo verificar PostgreSQL — omitiendo importación SQLite.');
        }
    } else {
        console.log('\n[setup] 2/3 No hay database.sqlite — omitiendo importación.');
    }

    // ── 3. Índice HNSW (si no existe) ─────────────────────────────────────────
    console.log('\n[setup] 3/3 Verificando índice HNSW...');
    if (!fs.existsSync(HNSW_INDEX_PATH)) {
        console.log('[setup] Índice HNSW no encontrado — construyendo...');
        // Si no hay usuarios el script termina limpiamente con status 0
        run(path.join(__dirname, 'build-hnsw-index.js'));
    } else {
        console.log('[setup] ✅ Índice HNSW ya existe — omitiendo construcción.');
    }

    console.log('\n' + '═'.repeat(60));
    console.log('  Setup completado — arrancando servidor...');
    console.log('═'.repeat(60) + '\n');
}

main().catch(err => {
    console.error('\n[setup] ❌ Error inesperado:', err.message);
    process.exit(1);
});

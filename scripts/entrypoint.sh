#!/bin/bash
# ============================================================
# Entrypoint para face-recognition-api
#
# Corre como ROOT para poder corregir permisos en volúmenes
# montados, luego hace exec como 'nodeuser' via gosu.
#
# Pasos:
#   1. Arregla permisos de /app/data, /app/logs, /app/public/uploads
#   2. Verifica / descarga modelos de face-api
#   3. Ejecuta setup.js:
#        a) Migración de schema PostgreSQL (idempotente)
#        b) Importación SQLite → PG (si ./data/database.sqlite existe y PG vacío)
#        c) Construcción del índice HNSW (si no existe)
#   4. Inicia el servidor como nodeuser
# ============================================================

set -e

MODELS_DIR="${MODELS_PATH:-/app/public/models}"
CRITICAL_MODEL="$MODELS_DIR/ssd_mobilenetv1_model-weights_manifest.json"

echo "[entrypoint] Iniciando Face Recognition Server..."

# ── 1. Arreglar permisos en directorios bind-mounted ──────────────────────────
# El directorio del host puede estar creado como root; nodeuser necesita escribir ahí.
echo "[entrypoint] Ajustando permisos de volúmenes..."
mkdir -p /app/data /app/logs /app/public/uploads
chown -R nodeuser:nodeuser /app/data /app/logs /app/public/uploads 2>/dev/null || true

# ── 2. Modelos face-api ───────────────────────────────────────────────────────
echo "[entrypoint] Directorio de modelos: $MODELS_DIR"
if [ ! -f "$CRITICAL_MODEL" ]; then
    echo "[entrypoint] Modelos no encontrados — descargando desde vladmandic/face-api..."
    node /app/scripts/download-models.js --dest "$MODELS_DIR"
    if [ ! -f "$CRITICAL_MODEL" ]; then
        echo "[entrypoint] ERROR: No se pudieron descargar los modelos. El servidor no puede iniciar."
        exit 1
    fi
    echo "[entrypoint] Modelos descargados correctamente."
else
    echo "[entrypoint] Modelos OK."
fi

# ── 3. Setup automático: schema + SQLite import + HNSW index ──────────────────
echo "[entrypoint] Ejecutando setup automático..."
node /app/scripts/setup.js

# ── 4. Arrancar servidor como nodeuser ────────────────────────────────────────
echo "[entrypoint] Iniciando servidor Node.js como nodeuser..."
exec gosu nodeuser node /app/app.js

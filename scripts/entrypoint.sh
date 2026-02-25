#!/bin/bash
# ============================================================
# Entrypoint para face-recognition-api
#
# Pasos:
#   1. Verifica que los modelos de face-api.js estén presentes
#   2. Si el directorio de modelos está vacío, los descarga
#   3. Inicia el servidor con node app.js
# ============================================================

set -e

MODELS_DIR="${MODELS_PATH:-/app/public/models}"
CRITICAL_MODEL="$MODELS_DIR/ssd_mobilenetv1_model-weights_manifest.json"

echo "[entrypoint] Iniciando Face Recognition Server..."
echo "[entrypoint] Directorio de modelos: $MODELS_DIR"

# Verificar si los modelos están presentes
if [ ! -f "$CRITICAL_MODEL" ]; then
    echo "[entrypoint] Modelos no encontrados — descargando desde vladmandic/face-api..."
    node /app/scripts/download-models.js --dest "$MODELS_DIR"

    # Verificar que la descarga fue exitosa
    if [ ! -f "$CRITICAL_MODEL" ]; then
        echo "[entrypoint] ERROR: No se pudieron descargar los modelos. El servidor no puede iniciar."
        exit 1
    fi
    echo "[entrypoint] Modelos descargados correctamente."
else
    echo "[entrypoint] Modelos encontrados en $MODELS_DIR"
fi

echo "[entrypoint] Iniciando servidor Node.js..."
exec node /app/app.js

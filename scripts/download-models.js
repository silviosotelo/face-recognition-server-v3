#!/usr/bin/env node
/**
 * Descarga los modelos de face-api.js desde el repositorio de vladmandic/face-api.
 * Los modelos son binarios compatibles con @vladmandic/face-api y face-api.js.
 *
 * Uso:
 *   node scripts/download-models.js
 *   node scripts/download-models.js --dest /app/public/models
 *
 * Ejecutado automáticamente durante el build de Docker (Dockerfile.gpu).
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://raw.githubusercontent.com/vladmandic/face-api/master/model';

const MODEL_FILES = [
    // Detector rápido (CPU-friendly)
    'tiny_face_detector_model-weights_manifest.json',
    'tiny_face_detector_model-shard1',

    // SSD MobileNet v1 (más preciso, requerido para GPU)
    'ssd_mobilenetv1_model-weights_manifest.json',
    'ssd_mobilenetv1_model-shard1',
    'ssd_mobilenetv1_model-shard2',

    // Red de reconocimiento facial (genera descriptores 128D)
    'face_recognition_model-weights_manifest.json',
    'face_recognition_model-shard1',
    'face_recognition_model-shard2',

    // Landmarks faciales 68 puntos
    'face_landmark_68_model-weights_manifest.json',
    'face_landmark_68_model-shard1',

    // Expresiones faciales
    'face_expression_recognition_model-weights_manifest.json',
    'face_expression_recognition_model-shard1',
];

// Destino desde argumento --dest o variable de entorno
let destDir = path.resolve(process.cwd(), 'public/models');
const destArgIdx = process.argv.indexOf('--dest');
if (destArgIdx !== -1 && process.argv[destArgIdx + 1]) {
    destDir = path.resolve(process.argv[destArgIdx + 1]);
}

function downloadFile(url, destPath, retries = 3) {
    return new Promise((resolve, reject) => {
        const attempt = (attemptsLeft) => {
            const protocol = url.startsWith('https') ? https : http;
            const file = fs.createWriteStream(destPath);

            const req = protocol.get(url, (response) => {
                // Seguir redirecciones (301, 302, 307, 308)
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    file.close();
                    fs.unlink(destPath, () => {});
                    return attempt(attemptsLeft);  // retry with same count (redirect is not an error)
                }

                if (response.statusCode !== 200) {
                    file.close();
                    fs.unlink(destPath, () => {});
                    const err = new Error(`HTTP ${response.statusCode} para ${url}`);
                    if (attemptsLeft > 1) {
                        console.log(`   ↩ Reintentando (${attemptsLeft - 1} restantes)...`);
                        setTimeout(() => attempt(attemptsLeft - 1), 2000);
                    } else {
                        reject(err);
                    }
                    return;
                }

                response.pipe(file);
                file.on('finish', () => file.close(resolve));
            });

            req.on('error', (err) => {
                file.close();
                fs.unlink(destPath, () => {});
                if (attemptsLeft > 1) {
                    console.log(`   ↩ Error de red, reintentando (${attemptsLeft - 1} restantes)...`);
                    setTimeout(() => attempt(attemptsLeft - 1), 2000);
                } else {
                    reject(err);
                }
            });

            req.setTimeout(30000, () => {
                req.abort();
            });
        };

        attempt(retries);
    });
}

async function downloadModels() {
    console.log('\n📦 Descargando modelos de face-api.js\n');
    console.log(`   Destino: ${destDir}`);
    console.log(`   Fuente:  ${BASE_URL}\n`);

    // Crear directorio de destino
    fs.mkdirSync(destDir, { recursive: true });

    let downloaded = 0;
    let skipped = 0;
    let failed = [];

    for (const filename of MODEL_FILES) {
        const destPath = path.join(destDir, filename);

        // Saltar si ya existe (evita re-descargar en rebuilds)
        if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
            process.stdout.write(`   ⏭  ${filename} (ya existe)\n`);
            skipped++;
            continue;
        }

        process.stdout.write(`   ⬇  ${filename}... `);

        try {
            const url = `${BASE_URL}/${filename}`;
            await downloadFile(url, destPath);
            const size = fs.statSync(destPath).size;
            const sizeMB = (size / 1024 / 1024).toFixed(2);
            process.stdout.write(`✅ (${sizeMB} MB)\n`);
            downloaded++;
        } catch (err) {
            process.stdout.write(`❌\n`);
            console.error(`   Error: ${err.message}`);
            failed.push(filename);
            // Limpiar archivo parcial
            if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        }
    }

    console.log('\n' + '─'.repeat(50));
    console.log(`   Descargados:  ${downloaded}`);
    console.log(`   Omitidos:     ${skipped}`);
    console.log(`   Errores:      ${failed.length}`);

    if (failed.length > 0) {
        console.error('\n❌ Archivos que fallaron:');
        failed.forEach(f => console.error(`   - ${f}`));
        console.error('\nVerifica tu conexión a internet y reintenta.');
        process.exit(1);
    }

    console.log('\n✅ Modelos listos en:', destDir);
}

downloadModels().catch(err => {
    console.error('\n❌ Error descargando modelos:', err.message);
    process.exit(1);
});

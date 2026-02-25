#!/usr/bin/env node
/**
 * Descarga dinámicamente los modelos de face-api.js desde el repo de vladmandic.
 * 1. Consulta la lista de archivos vía GitHub API.
 * 2. Descarga cada archivo a la carpeta de destino.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
// Configuración
const REPO_OWNER = 'vladmandic';
const REPO_NAME = 'face-api';
const REPO_PATH = 'model';
const API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${REPO_PATH}`;
const RAW_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/master/${REPO_PATH}`;
// Argumentos y Destino
let destDir = path.resolve(process.cwd(), 'public/models');
const destArgIdx = process.argv.indexOf('--dest');
if (destArgIdx !== -1 && process.argv[destArgIdx + 1]) {
    destDir = path.resolve(process.argv[destArgIdx + 1]);
}
/**
 * Helper para peticiones HTTPS GET
 */
function getHttps(url) {
    return new Promise((resolve, reject) => {
        // GitHub API requiere un User-Agent
        const options = {
            headers: { 'User-Agent': 'Node.js-Model-Downloader' }
        };
        https.get(url, options, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return resolve(getHttps(res.headers.location));
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`Status ${res.statusCode} para ${url}`));
            }
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}
/**
 * Descarga un archivo binario con User-Agent (requerido por GitHub)
 */
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: { 'User-Agent': 'Node.js-Model-Downloader' }
        };
        const file = fs.createWriteStream(destPath);
        https.get(url, options, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                file.close();
                fs.unlink(destPath, () => {});
                return resolve(downloadFile(res.headers.location, destPath));
            }
            if (res.statusCode !== 200) {
                file.close();
                fs.unlink(destPath, () => {});
                return reject(new Error(`Status ${res.statusCode}`));
            }
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
        });
    });
}
async function run() {
    console.log('\n🔍 Consultando modelos disponibles en el repositorio...');

    try {
        // 1. Obtener lista de archivos desde la API
        const response = await getHttps(API_URL);
        const files = JSON.parse(response)
            .filter(item => item.type === 'file') // Solo archivos, no carpetas
            .map(item => item.name);
        console.log(`✅ Encontrados ${files.length} archivos.\n`);
        console.log(`📂 Destino: ${destDir}\n`);
        fs.mkdirSync(destDir, { recursive: true });
        let downloaded = 0;
        let skipped = 0;
        // 2. Iterar y descargar
        for (const filename of files) {
            const destPath = path.join(destDir, filename);
            const url = `${RAW_URL}/${filename}`;
            if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
                console.log(`  ⏭️  ${filename} (ya existe)`);
                skipped++;
                continue;
            }
            process.stdout.write(`  ⬇️  Descargando ${filename}... `);
            try {
                await downloadFile(url, destPath);
                const size = (fs.statSync(destPath).size / 1024 / 1024).toFixed(2);
                process.stdout.write(`✅ (${size} MB)\n`);
                downloaded++;
            } catch (err) {
                process.stdout.write(`❌ Error: ${err.message}\n`);
            }
        }
        console.log(`\n✨ Proceso finalizado. Descargados: ${downloaded}, Omitidos: ${skipped}.`);
    } catch (err) {
        console.error('\n❌ Error crítico:', err.message);
        process.exit(1);
    }
}
run();

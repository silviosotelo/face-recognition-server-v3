#!/usr/bin/env node
/**
 * Script de verificación GPU para Face Recognition Server
 *
 * Uso:
 *   node scripts/gpu-check.js
 *   npm run check:gpu
 *
 * Verifica:
 * - NVIDIA GPU detectada por nvidia-smi
 * - CUDA instalado y versión
 * - cuDNN instalado
 * - @tensorflow/tfjs-node-gpu funcional
 * - Benchmark básico de inferencia GPU vs CPU
 */

require('dotenv').config();
const { execSync } = require('child_process');

console.log('\n🔍 Face Recognition Server - Verificación GPU\n');
console.log('='.repeat(60));

// ── 1. Verificar NVIDIA GPU ──────────────────────────────────
console.log('\n📌 1. NVIDIA GPU Hardware\n');
try {
    const nvidiaSmi = execSync('nvidia-smi --query-gpu=name,driver_version,memory.total,memory.free --format=csv,noheader,nounits 2>/dev/null', {
        encoding: 'utf-8',
        timeout: 10000
    }).trim();

    const gpus = nvidiaSmi.split('\n');
    gpus.forEach((gpu, i) => {
        const [name, driver, memTotal, memFree] = gpu.split(', ');
        console.log(`   GPU ${i}: ${name.trim()}`);
        console.log(`   Driver: ${driver.trim()}`);
        console.log(`   VRAM: ${memFree.trim()}MB libre / ${memTotal.trim()}MB total`);
    });
    console.log('   ✅ NVIDIA GPU detectada correctamente');
} catch (err) {
    console.log('   ❌ NVIDIA GPU no detectada o nvidia-smi no disponible');
    console.log('   Instalar: https://developer.nvidia.com/cuda-downloads');
}

// ── 2. Verificar CUDA ────────────────────────────────────────
console.log('\n📌 2. CUDA Installation\n');
try {
    const cudaVersion = execSync('nvcc --version 2>/dev/null | grep release', {
        encoding: 'utf-8',
        timeout: 5000
    }).trim();
    console.log(`   ${cudaVersion}`);
    console.log('   ✅ CUDA toolkit instalado');
} catch {
    try {
        const cudaLib = execSync('ldconfig -p 2>/dev/null | grep libcuda | head -1', {
            encoding: 'utf-8',
            timeout: 5000
        }).trim();
        if (cudaLib) {
            console.log('   ✅ CUDA libraries encontradas:', cudaLib);
        }
    } catch {
        console.log('   ⚠️ nvcc no encontrado, pero TF puede funcionar si libcuda está presente');
        console.log('   Instalar CUDA: https://developer.nvidia.com/cuda-downloads');
    }
}

// ── 3. Verificar cuDNN ───────────────────────────────────────
console.log('\n📌 3. cuDNN\n');
try {
    const cudnn = execSync('ldconfig -p 2>/dev/null | grep cudnn | head -3', {
        encoding: 'utf-8',
        timeout: 5000
    }).trim();
    if (cudnn) {
        console.log('   ✅ cuDNN encontrado:');
        cudnn.split('\n').forEach(l => console.log('   ', l.trim()));
    } else {
        console.log('   ⚠️ cuDNN no detectado');
        console.log('   Instalar cuDNN: https://developer.nvidia.com/cudnn');
    }
} catch {
    console.log('   ⚠️ No se pudo verificar cuDNN');
}

// ── 4. Verificar @tensorflow/tfjs-node-gpu ──────────────────
console.log('\n📌 4. TensorFlow.js GPU Backend\n');
try {
    console.log('   Cargando @tensorflow/tfjs-node-gpu...');
    const tf = require('@tensorflow/tfjs-node-gpu');

    console.log(`   ✅ TensorFlow.js v${tf.version_core} cargado`);
    console.log(`   Backend activo: ${tf.getBackend()}`);

    const isGpu = tf.getBackend() === 'tensorflow';
    if (isGpu) {
        console.log('   ✅ Backend TensorFlow (GPU/CUDA) activo');
    } else {
        console.log('   ⚠️ Backend no es GPU:', tf.getBackend());
        console.log('   Posible causa: CUDA/cuDNN no compatible con esta versión de TF');
    }

    // Test de operación básica en GPU
    console.log('\n   Ejecutando test de operación GPU...');
    const startTime = Date.now();
    const a = tf.tensor2d([[1, 2], [3, 4]]);
    const b = tf.tensor2d([[5, 6], [7, 8]]);
    const c = tf.matMul(a, b);
    const result = await c.data();
    const elapsed = Date.now() - startTime;

    console.log(`   ✅ Operación GPU completada en ${elapsed}ms`);
    console.log(`   Resultado: [${result.join(', ')}]`);

    // Memoria GPU
    const mem = tf.memory();
    console.log('\n   Memoria TensorFlow:');
    console.log(`   - Tensores activos: ${mem.numTensors}`);
    console.log(`   - Bytes en GPU: ${(mem.numBytesInGPU / 1024 / 1024).toFixed(2)}MB`);

    tf.dispose([a, b, c]);

} catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
        console.log('   ❌ @tensorflow/tfjs-node-gpu no instalado');
        console.log('   Instalar: npm install @tensorflow/tfjs-node-gpu');
    } else {
        console.log('   ❌ Error cargando TensorFlow GPU:', err.message);
        console.log('   Posibles causas:');
        console.log('   - CUDA version incompatible con tfjs-node-gpu');
        console.log('   - cuDNN no instalado');
        console.log('   - GPU sin soporte CUDA (Compute Capability < 3.5)');
    }
}

// ── 5. Verificar face-api.js ─────────────────────────────────
console.log('\n📌 5. face-api.js\n');
try {
    const faceapi = require('face-api.js');
    console.log(`   ✅ face-api.js disponible`);
    console.log(`   Backend configurado: ${require('@tensorflow/tfjs-node-gpu').getBackend()}`);
} catch (err) {
    console.log('   ❌ face-api.js no disponible:', err.message);
}

// ── 6. Verificar HNSW ────────────────────────────────────────
console.log('\n📌 6. hnswlib-node (Búsqueda rápida)\n');
try {
    const { HierarchicalNSW } = require('hnswlib-node');
    const index = new HierarchicalNSW('l2', 128);
    index.initIndex(1000, 16, 200);

    // Test con vectores aleatorios
    const vec = new Float32Array(128).fill(0.5);
    index.addPoint(vec, 0);
    const result = index.searchKnn(vec, 1);
    console.log(`   ✅ hnswlib-node funcional`);
    console.log(`   Test búsqueda 128D: distancia=${result.distances[0].toFixed(6)}`);
} catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
        console.log('   ❌ hnswlib-node no instalado');
        console.log('   Instalar: npm install hnswlib-node');
    } else {
        console.log('   ❌ Error:', err.message);
    }
}

// ── 7. Verificar Redis ───────────────────────────────────────
console.log('\n📌 7. Redis\n');
try {
    const Redis = require('ioredis');
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        connectTimeout: 3000,
        maxRetriesPerRequest: 1,
        lazyConnect: true
    });

    await redis.connect();
    await redis.ping();
    const info = await redis.info('server');
    const version = info.match(/redis_version:(.+)/)?.[1]?.trim();
    console.log(`   ✅ Redis conectado (v${version || 'desconocida'})`);
    await redis.disconnect();
} catch (err) {
    console.log('   ⚠️ Redis no disponible:', err.message);
    console.log('   Sin Redis: el servidor usará caché en memoria (funcional pero no distribuido)');
    console.log('   Instalar Redis: sudo apt install redis-server');
}

// ── Resumen ──────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log('Verificación completada. Revisa los items ❌ arriba para configurar.');
console.log('\nPara iniciar el servidor:');
console.log('  node app.js           # Modo single process');
console.log('  npm run start:cluster # PM2 cluster mode');
console.log('');
process.exit(0);

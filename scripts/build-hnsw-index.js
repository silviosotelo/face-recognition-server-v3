#!/usr/bin/env node
/**
 * Script para construir/reconstruir el índice HNSW desde la base de datos
 *
 * Uso:
 *   node scripts/build-hnsw-index.js
 *   npm run build:index
 *
 * Cuándo usarlo:
 * - Primera vez después de instalar v4.0
 * - Después de importar usuarios masivamente via SQL
 * - Cuando el índice está desincronizado con la DB
 * - Para optimizar el índice después de muchas eliminaciones
 */

require('dotenv').config();
const path = require('path');

console.log('\n🔨 Face Recognition Server v4.0 - Construcción de Índice HNSW\n');
console.log('='.repeat(60));

async function buildIndex() {
    try {
        // Inicializar DB
        console.log('\n📂 Conectando a base de datos...');
        const db = require('../src/config/database');
        await db.initialize();

        // Cargar todos los usuarios activos
        console.log('📋 Cargando usuarios desde DB...');
        const User = require('../src/models/User');
        const users = await User.getActiveUsers();

        console.log(`   Usuarios activos encontrados: ${users.length}`);

        if (users.length === 0) {
            console.log('\n⚠️ No hay usuarios en la base de datos.');
            console.log('   El índice se construirá automáticamente cuando registres usuarios.');
            process.exit(0);
        }

        // Validar que los descriptores sean válidos
        let validUsers = 0;
        let invalidUsers = 0;

        for (const user of users) {
            try {
                const desc = JSON.parse(user.descriptor);
                if (Array.isArray(desc) && desc.length === 128) {
                    validUsers++;
                } else {
                    invalidUsers++;
                    console.warn(`   ⚠️ Descriptor inválido para usuario ${user.ci} (dimensión: ${desc.length})`);
                }
            } catch {
                invalidUsers++;
                console.warn(`   ⚠️ Descriptor corrupto para usuario ${user.ci}`);
            }
        }

        console.log(`\n   Usuarios válidos: ${validUsers}`);
        if (invalidUsers > 0) {
            console.log(`   Usuarios con descriptor inválido: ${invalidUsers} (serán ignorados)`);
        }

        // Construir índice HNSW
        console.log('\n🔨 Construyendo índice HNSW...');
        console.log('   Esto puede tomar varios minutos para datasets grandes.');
        console.log('   Estimación: ~1 segundo por cada 1000 usuarios');

        const hnswService = require('../src/services/hnsw.service');
        await hnswService.initialize(); // Inicializar para crear índice vacío

        // Pasar solo usuarios con descriptores válidos
        const validUsersToIndex = users.filter(user => {
            try {
                const desc = JSON.parse(user.descriptor);
                return Array.isArray(desc) && desc.length === 128;
            } catch {
                return false;
            }
        });

        const startTime = Date.now();
        const result = await hnswService.rebuildIndex(validUsersToIndex);
        const elapsed = Date.now() - startTime;

        // Guardar índice en disco
        console.log('\n💾 Guardando índice en disco...');
        await hnswService.saveIndex();

        // Mostrar resultados
        console.log('\n' + '='.repeat(60));
        console.log('✅ ÍNDICE HNSW CONSTRUIDO EXITOSAMENTE');
        console.log('='.repeat(60));
        console.log(`\n   Vectores indexados: ${result.added}`);
        console.log(`   Errores: ${result.errors}`);
        console.log(`   Tiempo total: ${(elapsed / 1000).toFixed(2)}s`);
        console.log(`   Velocidad: ${Math.round(result.added / (elapsed / 1000))} vectores/segundo`);

        const stats = hnswService.getStats();
        console.log(`\n   📊 Estadísticas del índice:`);
        console.log(`   - Dimensión: ${stats.dimension}D`);
        console.log(`   - M (conexiones por nodo): ${stats.hnswM}`);
        console.log(`   - ef_construction: ${stats.hnswEfConstruction}`);
        console.log(`   - ef_search: ${stats.hnswEfSearch}`);
        console.log(`   - Ruta: ${stats.indexPath}`);

        // Estimar performance
        const msPerSearch = stats.avgSearchTimeMs || 1;
        const capacity = 1_000_000;
        console.log(`\n   🚀 Performance estimada:`);
        console.log(`   - Búsqueda típica: <${Math.max(10, Math.round(msPerSearch))}ms`);
        console.log(`   - Capacidad máxima del índice: ${capacity.toLocaleString()} vectores`);
        console.log(`   - Escalabilidad: O(log n) independiente del tamaño`);

        console.log('\n   El servidor cargará este índice automáticamente al iniciar.\n');

    } catch (error) {
        console.error('\n❌ Error construyendo índice:', error.message);
        console.error(error.stack);
        process.exit(1);
    }

    process.exit(0);
}

buildIndex();

/**
 * Script de seed de datos de prueba — PostgreSQL
 *
 * Uso:
 *   node scripts/seed.js
 *   npm run seed
 */

require('dotenv').config();
const db     = require('../src/config/database');
const User   = require('../src/models/User');
const logger = require('../src/utils/logger');

async function seed() {
    try {
        logger.info('🌱 Iniciando seed de datos de prueba...');

        await db.initialize();

        const testUsers = [
            {
                ci:              '12345678',
                id_cliente:      'TEST001',
                name:            'Usuario de Prueba 1',
                descriptor:      JSON.stringify(Array.from({ length: 128 }, () => Math.random())),
                confidence_score: 0.95
            },
            {
                ci:              '87654321',
                id_cliente:      'TEST002',
                name:            'Usuario de Prueba 2',
                descriptor:      JSON.stringify(Array.from({ length: 128 }, () => Math.random())),
                confidence_score: 0.92
            }
        ];

        for (const user of testUsers) {
            try {
                const created = await User.create(user);
                logger.info(`✅ Usuario creado: ${user.name} (id: ${created.id})`);
            } catch (error) {
                // PostgreSQL error 23505 = violación de UNIQUE constraint
                if (error.code === '23505' || error.message.includes('unique')) {
                    logger.info(`⚠️ Usuario ya existe: ${user.name}`);
                } else {
                    throw error;
                }
            }
        }

        logger.info('✅ Seed completado exitosamente');

        await db.close();
        process.exit(0);

    } catch (error) {
        logger.error('❌ Error en seed:', error);
        process.exit(1);
    }
}

seed();

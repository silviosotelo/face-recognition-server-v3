const db = require('../src/config/database');
const User = require('../src/models/User');
const logger = require('../src/utils/logger');

async function seed() {
    try {
        logger.info('🌱 Iniciando seed de datos de prueba...');
        
        await db.initialize();
        
        // Datos de prueba
        const testUsers = [
            {
                ci: '12345678',
                id_cliente: 'TEST001',
                name: 'Usuario de Prueba 1',
                descriptor: JSON.stringify(Array(128).fill(0).map(() => Math.random())),
                confidence_score: 0.95
            },
            {
                ci: '87654321',
                id_cliente: 'TEST002', 
                name: 'Usuario de Prueba 2',
                descriptor: JSON.stringify(Array(128).fill(0).map(() => Math.random())),
                confidence_score: 0.92
            }
        ];

        for (const user of testUsers) {
            try {
                await User.create(user);
                logger.info(`✅ Usuario de prueba creado: ${user.name}`);
            } catch (error) {
                if (error.message.includes('UNIQUE')) {
                    logger.info(`⚠️ Usuario ya existe: ${user.name}`);
                } else {
                    throw error;
                }
            }
        }
        
        logger.info('✅ Seed completado exitosamente');
        process.exit(0);
        
    } catch (error) {
        logger.error('❌ Error en seed:', error);
        process.exit(1);
    }
}

seed();
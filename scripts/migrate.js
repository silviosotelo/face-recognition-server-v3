const db = require('../src/config/database');
const logger = require('../src/utils/logger');

async function migrate() {
    try {
        logger.info('🔄 Iniciando migración de base de datos...');
        
        await db.initialize();
        
        // Agregar nuevas columnas si no existen
        const migrations = [
            `ALTER TABLE users ADD COLUMN face_encoding_version TEXT DEFAULT '2.0'`,
            `ALTER TABLE users ADD COLUMN last_recognition_at DATETIME`,
            `ALTER TABLE users ADD COLUMN recognition_count INTEGER DEFAULT 0`,
            `CREATE INDEX IF NOT EXISTS idx_recognition_logs_created_at ON recognition_logs(created_at)`,
            `CREATE INDEX IF NOT EXISTS idx_users_last_recognition ON users(last_recognition_at)`
        ];

        for (const migration of migrations) {
            try {
                await db.run(migration);
                logger.info(`✅ Migración ejecutada: ${migration.substring(0, 50)}...`);
            } catch (error) {
                if (!error.message.includes('duplicate column name') && 
                    !error.message.includes('already exists')) {
                    logger.warn(`⚠️ Error en migración (ignorado): ${error.message}`);
                }
            }
        }
        
        logger.info('✅ Migración completada exitosamente');
        process.exit(0);
        
    } catch (error) {
        logger.error('❌ Error en migración:', error);
        process.exit(1);
    }
}

migrate();
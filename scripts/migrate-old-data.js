const sqlite3 = require('sqlite3').verbose();
const User = require('../src/models/User');

class FacialRecognitionMigrator {
    constructor() {
        this.oldDb = null;
        this.migrationStats = {
            total: 0,
            migrated: 0,
            errors: 0,
            duplicates: 0
        };
    }

    async initialize() {
        try {
            this.oldDb = new sqlite3.Database('./old-database.sqlite');
            console.log('✅ Conexión a base de datos antigua establecida');
        } catch (error) {
            console.error('❌ Error conectando a la base de datos antigua:', error.message);
            throw error;
        }
    }

    async validateOldData() {
        return new Promise((resolve, reject) => {
            this.oldDb.all(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN ci IS NULL OR ci = '' THEN 1 END) as missing_ci,
                    COUNT(CASE WHEN descriptor IS NULL OR descriptor = '' THEN 1 END) as missing_descriptor,
                    COUNT(CASE WHEN name IS NULL OR name = '' THEN 1 END) as missing_name
                FROM users
            `, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const stats = rows[0];
                    console.log('📊 Estadísticas de datos antiguos:');
                    console.log(`   Total registros: ${stats.total}`);
                    console.log(`   CI faltantes: ${stats.missing_ci}`);
                    console.log(`   Descriptores faltantes: ${stats.missing_descriptor}`);
                    console.log(`   Nombres faltantes: ${stats.missing_name}`);
                    resolve(stats);
                }
            });
        });
    }

    async checkExistingUsers(ciList) {
        try {
            // Verificar usuarios que ya existen en la nueva estructura
            const existingUsers = await User.findAll({
                where: {
                    ci: ciList
                },
                attributes: ['ci']
            });
            return existingUsers.map(user => user.ci);
        } catch (error) {
            console.error('Error verificando usuarios existentes:', error);
            return [];
        }
    }

    async migrateUsers() {
        try {
            console.log('🚀 Iniciando migración de usuarios...');
            
            // Validar datos antiguos primero
            await this.validateOldData();

            // Obtener todos los usuarios de la BD antigua
            const oldUsers = await new Promise((resolve, reject) => {
                this.oldDb.all(`
                    SELECT 
                        id_cliente,
                        name,
                        ci,
                        descriptor,
                        created_at,
                        updated_at
                    FROM users 
                    WHERE ci IS NOT NULL 
                    AND ci != ''
                    AND descriptor IS NOT NULL 
                    AND descriptor != ''
                    ORDER BY id_cliente, ci
                `, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });

            this.migrationStats.total = oldUsers.length;
            console.log(`📋 ${oldUsers.length} usuarios válidos encontrados para migrar`);

            if (oldUsers.length === 0) {
                console.log('⚠️  No hay usuarios válidos para migrar');
                return;
            }

            // Verificar duplicados por CI
            const ciList = oldUsers.map(user => user.ci);
            const existingCIs = await this.checkExistingUsers(ciList);
            
            if (existingCIs.length > 0) {
                console.log(`⚠️  ${existingCIs.length} usuarios ya existen en el sistema nuevo`);
                this.migrationStats.duplicates = existingCIs.length;
            }

            // Procesar usuarios en lotes para mejor performance
            const batchSize = 50;
            for (let i = 0; i < oldUsers.length; i += batchSize) {
                const batch = oldUsers.slice(i, i + batchSize);
                await this.processBatch(batch, existingCIs);
                
                const progress = Math.round(((i + batch.length) / oldUsers.length) * 100);
                console.log(`⏳ Progreso: ${progress}% (${i + batch.length}/${oldUsers.length})`);
            }

            this.printMigrationSummary();

        } catch (error) {
            console.error('❌ Error durante la migración:', error);
            throw error;
        }
    }

    async processBatch(batch, existingCIs) {
        const migrationPromises = batch.map(async (user) => {
            try {
                // Saltar si ya existe
                if (existingCIs.includes(user.ci)) {
                    return { status: 'skipped', ci: user.ci };
                }

                // Preparar datos para migración
                const userData = {
                    id_cliente: user.id_cliente || 1, // Cliente por defecto
                    name: user.name?.trim() || '',
                    ci: user.ci.toString().trim(),
                    descriptor: user.descriptor,
                    confidence_score: 0.8, // Score por defecto para migrados
                    migrated_from_old_system: true, // Flag para identificar migrados
                    old_created_at: user.created_at,
                    created_at: new Date(),
                    updated_at: new Date()
                };

                // Validaciones adicionales
                if (!this.validateUserData(userData)) {
                    throw new Error(`Datos inválidos para CI: ${user.ci}`);
                }

                // Crear usuario en el nuevo sistema
                await User.create(userData);
                this.migrationStats.migrated++;
                
                return { status: 'success', ci: user.ci };

            } catch (error) {
                console.error(`❌ Error migrando usuario CI ${user.ci}:`, error.message);
                this.migrationStats.errors++;
                return { status: 'error', ci: user.ci, error: error.message };
            }
        });

        await Promise.allSettled(migrationPromises);
    }

    validateUserData(userData) {
        // Validaciones básicas
        if (!userData.ci || userData.ci.length === 0) {
            return false;
        }
        
        if (!userData.descriptor || userData.descriptor.length === 0) {
            return false;
        }

        // Validar que el CI sea numérico (ajustar según tu formato)
        if (!/^\d+$/.test(userData.ci)) {
            console.warn(`⚠️  CI no numérico detectado: ${userData.ci}`);
        }

        return true;
    }

    printMigrationSummary() {
        console.log('\n📈 RESUMEN DE MIGRACIÓN:');
        console.log('========================');
        console.log(`Total usuarios procesados: ${this.migrationStats.total}`);
        console.log(`✅ Migrados exitosamente: ${this.migrationStats.migrated}`);
        console.log(`⚠️  Duplicados omitidos: ${this.migrationStats.duplicates}`);
        console.log(`❌ Errores: ${this.migrationStats.errors}`);
        console.log(`📊 Tasa de éxito: ${Math.round((this.migrationStats.migrated / this.migrationStats.total) * 100)}%`);
    }

    async cleanup() {
        if (this.oldDb) {
            this.oldDb.close();
            console.log('🔒 Conexión a base de datos antigua cerrada');
        }
    }

    // Método para rollback en caso de problemas
    async rollbackMigration() {
        try {
            console.log('🔄 Iniciando rollback de migración...');
            const result = await User.destroy({
                where: {
                    migrated_from_old_system: true
                }
            });
            console.log(`✅ Rollback completado. ${result} usuarios eliminados.`);
        } catch (error) {
            console.error('❌ Error durante rollback:', error);
        }
    }
}

// Función principal de migración
async function runMigration() {
    const migrator = new FacialRecognitionMigrator();
    
    try {
        await migrator.initialize();
        await migrator.migrateUsers();
        console.log('🎉 Migración completada exitosamente!');
        
    } catch (error) {
        console.error('💥 Migración falló:', error);
        
        // Preguntar si hacer rollback
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        readline.question('¿Deseas hacer rollback? (y/n): ', async (answer) => {
            if (answer.toLowerCase() === 'y') {
                await migrator.rollbackMigration();
            }
            readline.close();
            await migrator.cleanup();
            process.exit(1);
        });
        
    } finally {
        await migrator.cleanup();
    }
}

// Ejecutar migración
if (require.main === module) {
    runMigration();
}

module.exports = { FacialRecognitionMigrator };
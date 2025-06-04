const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const config = require('./server');

class DatabaseManager {
    constructor() {
        this.db = null;
        this.isConnected = false;
    }

    async initialize() {
        try {
            const dbPath = path.resolve(config.DATABASE.PATH);
            const dbDir = path.dirname(dbPath);
            
            // Crear directorio si no existe
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }

            this.db = new sqlite3.Database(dbPath, (err) => {
                if (err) {
                    logger.error('Error al conectar con la base de datos:', err);
                    throw err;
                }
                logger.info('✅ Conectado a la base de datos SQLite');
            });

            // Configurar optimizaciones de SQLite
            await this.configureDatabase();
            
            // Crear tablas
            await this.createTables();
            
            this.isConnected = true;
            
        } catch (error) {
            logger.error('❌ Error al inicializar base de datos:', error);
            throw error;
        }
    }

    async configureDatabase() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Optimizaciones de rendimiento
                this.db.run('PRAGMA journal_mode = WAL'); // Write-Ahead Logging
                this.db.run('PRAGMA synchronous = NORMAL'); // Velocidad vs seguridad
                this.db.run('PRAGMA cache_size = 10000'); // Cache más grande
                this.db.run('PRAGMA temp_store = MEMORY'); // Tablas temporales en memoria
                this.db.run('PRAGMA mmap_size = 268435456'); // 256MB mmap
                
                logger.info('✅ Configuraciones de base de datos aplicadas');
                resolve();
            });
        });
    }

    async createTables() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Tabla de usuarios optimizada
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        id_cliente TEXT NOT NULL,
                        name TEXT NOT NULL,
                        ci TEXT UNIQUE NOT NULL,
                        descriptor TEXT NOT NULL,
                        confidence_score REAL DEFAULT 0,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        is_active BOOLEAN DEFAULT 1,
                        face_encoding_version TEXT DEFAULT '3.0'
                    )
                `, (err) => {
                    if (err) reject(err);
                });

                // Tabla de logs de reconocimiento
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS recognition_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER,
                        recognition_type TEXT,
                        confidence_score REAL,
                        processing_time_ms INTEGER,
                        success BOOLEAN,
                        error_message TEXT,
                        ip_address TEXT,
                        user_agent TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (user_id) REFERENCES users(id)
                    )
                `, (err) => {
                    if (err) reject(err);
                });

                // Índices para optimización de consultas
                this.db.run('CREATE INDEX IF NOT EXISTS idx_users_ci ON users(ci)');
                this.db.run('CREATE INDEX IF NOT EXISTS idx_users_id_cliente ON users(id_cliente)');
                this.db.run('CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active)');
                this.db.run('CREATE INDEX IF NOT EXISTS idx_recognition_logs_user_id ON recognition_logs(user_id)');
                this.db.run('CREATE INDEX IF NOT EXISTS idx_recognition_logs_created_at ON recognition_logs(created_at)');

                logger.info('✅ Tablas de base de datos creadas/verificadas');
                resolve();
            });
        });
    }

    getConnection() {
        if (!this.isConnected) {
            throw new Error('Base de datos no está conectada');
        }
        return this.db;
    }

    async query(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    logger.error('Error en consulta SQL:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    logger.error('Error en ejecución SQL:', err);
                    reject(err);
                } else {
                    resolve({ id: this.lastID, changes: this.changes });
                }
            });
        });
    }

    async close() {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    this.isConnected = false;
                    logger.info('🔒 Conexión a base de datos cerrada');
                    resolve();
                }
            });
        });
    }
}

module.exports = new DatabaseManager();
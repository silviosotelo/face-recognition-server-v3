const winston = require('winston');
const path = require('path');
const config = require('../config/server');

// Crear directorio de logs si no existe
const logDir = path.dirname(config.LOG_FILE);
require('fs').mkdirSync(logDir, { recursive: true });

const logger = winston.createLogger({
    level: config.LOG_LEVEL,
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'face-recognition-backend' },
    transports: [
        // Archivo de logs
        new winston.transports.File({ 
            filename: config.LOG_FILE,
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        
        // Logs de errores separados
        new winston.transports.File({ 
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            maxsize: 5242880,
            maxFiles: 5
        })
    ]
});

// En desarrollo, también loggear a consola
if (config.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

module.exports = logger;
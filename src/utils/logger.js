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

// Siempre loggear errores a stderr para que sean visibles en `docker logs`
// (en producción los logs van a archivo; sin esto, los crashes son silenciosos)
logger.add(new winston.transports.Console({
    level: 'error',
    stderrLevels: ['error'],
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ timestamp, level, message, stack }) =>
            `${timestamp} [${level.toUpperCase()}] ${stack || message}`
        )
    )
}));

// En desarrollo, loggear todo a consola con colores
if (config.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

module.exports = logger;
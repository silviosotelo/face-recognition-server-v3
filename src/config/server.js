require('dotenv').config();

module.exports = {
    PORT: process.env.PORT || 4300,
    NODE_ENV: process.env.NODE_ENV || 'development',
    VERSION: '3.0.0',
    
    // Configuración de base de datos
    DATABASE: {
        PATH: process.env.DB_PATH || './database.sqlite',
        POOL_SIZE: parseInt(process.env.DB_POOL_SIZE) || 10,
        TIMEOUT: parseInt(process.env.DB_TIMEOUT) || 30000
    },
    
    // Configuración de archivos
    MAX_FILE_SIZE: process.env.MAX_FILE_SIZE || '50mb',
    UPLOAD_PATH: process.env.UPLOAD_PATH || './public/uploads',
    MODELS_PATH: process.env.MODELS_PATH || './public/models',
    
    // Configuración CORS
    CORS_OPTIONS: {
        origin: process.env.ALLOWED_ORIGINS ? 
            process.env.ALLOWED_ORIGINS.split(',') : 
            ['http://localhost:3000', 'https://tu-dominio.com'],
        credentials: true,
        optionsSuccessStatus: 200
    },
    
    // Configuración de caché
    CACHE: {
        ENABLED: process.env.CACHE_ENABLED === 'true',
        TTL: parseInt(process.env.CACHE_TTL) || 3600, // 1 hora
        MAX_SIZE: parseInt(process.env.CACHE_MAX_SIZE) || 1000
    },
    
    // Configuración de logs
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    LOG_FILE: process.env.LOG_FILE || './logs/app.log'
};
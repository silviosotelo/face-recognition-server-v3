require('dotenv').config();

module.exports = {
    PORT:     process.env.PORT     || 4350,
    NODE_ENV: process.env.NODE_ENV || 'development',
    VERSION:  '4.1.0',

    // ── Base de datos PostgreSQL ───────────────────────────────
    DATABASE: {
        // Opción A: URL completa (tiene prioridad)
        URL:       process.env.DATABASE_URL || null,
        // Opción B: variables individuales
        HOST:      process.env.PGHOST     || 'localhost',
        PORT:      parseInt(process.env.PGPORT) || 5432,
        NAME:      process.env.PGDATABASE || 'face_recognition',
        USER:      process.env.PGUSER     || 'postgres',
        PASSWORD:  process.env.PGPASSWORD || '',
        SSL:       process.env.PGSSL === 'true',
        // Pool
        POOL_MIN:  parseInt(process.env.DB_POOL_MIN) || 2,
        POOL_MAX:  parseInt(process.env.DB_POOL_MAX) || 20,
        TIMEOUT:   parseInt(process.env.DB_TIMEOUT)  || 5000
    },

    // ── Archivos ───────────────────────────────────────────────
    MAX_FILE_SIZE: process.env.MAX_FILE_SIZE || '50mb',
    UPLOAD_PATH:   process.env.UPLOAD_PATH   || './public/uploads',
    MODELS_PATH:   process.env.MODELS_PATH   || './public/models',

    // ── CORS ───────────────────────────────────────────────────
    CORS_OPTIONS: {
        origin: process.env.ALLOWED_ORIGINS
            ? process.env.ALLOWED_ORIGINS.split(',')
            : ['http://localhost:3000'],
        credentials:         true,
        optionsSuccessStatus: 200
    },

    // ── Caché ──────────────────────────────────────────────────
    CACHE: {
        ENABLED:  process.env.CACHE_ENABLED !== 'false',
        TTL:      parseInt(process.env.CACHE_TTL)      || 3600,
        MAX_SIZE: parseInt(process.env.CACHE_MAX_SIZE) || 1000
    },

    // ── Logging ────────────────────────────────────────────────
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    LOG_FILE:  process.env.LOG_FILE  || './logs/app.log'
};

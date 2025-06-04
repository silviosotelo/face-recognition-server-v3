const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const config = require('./src/config/server');
const faceRecognitionConfig = require('./src/config/face-recognition');
const logger = require('./src/utils/logger');
const errorMiddleware = require('./src/middleware/error.middleware');

// Routes
const authRoutes = require('./src/routes/auth.routes');
const recognitionRoutes = require('./src/routes/recognition.routes');
const userRoutes = require('./src/routes/user.routes');
const faceConfigRoutes = require('./src/routes/face-config.routes');

class FaceRecognitionServer {
    constructor() {
        this.app = express();
        this.port = config.PORT;
        this.initializeMiddlewares();
        this.initializeRoutes();
        this.initializeErrorHandling();
    }

    initializeMiddlewares() {
        // Seguridad y compresión
        this.app.use(helmet());
        this.app.use(compression());
        this.app.use(cors(config.CORS_OPTIONS));

        // Rate limiting
        const limiter = rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutos
            max: 1000, // límite de 100 requests por IP
            message: 'Demasiadas solicitudes desde esta IP'
        });
        this.app.use('/api/', limiter);

        // Body parsing con límites de seguridad
        this.app.use(express.json({ 
            limit: config.MAX_FILE_SIZE,
            verify: (req, res, buf) => {
                req.rawBody = buf;
            }
        }));
        this.app.use(express.urlencoded({ 
            extended: true, 
            limit: config.MAX_FILE_SIZE 
        }));

        // Archivos estáticos
        this.app.use('/models', express.static('public/models'));
        this.app.use('/uploads', express.static('public/uploads'));

        // Logging de requests
        this.app.use((req, res, next) => {
            logger.info(`${req.method} ${req.path} - ${req.ip}`);
            next();
        });
    }

    initializeRoutes() {
        // Health check
        this.app.get('/health', (req, res) => {
            res.status(200).json({
                status: 'OK',
                timestamp: new Date().toISOString(),
                version: config.VERSION,
                uptime: process.uptime()
            });
        });

        // API Routes
        this.app.use('/api/auth', authRoutes);
        this.app.use('/api/recognition', recognitionRoutes);
        this.app.use('/api/users', userRoutes);
        this.app.use('/api/face-config', faceConfigRoutes);
    }

    initializeErrorHandling() {
        // Usar el middleware de error modular
        this.app.use(errorMiddleware.errorHandler);
        
        // 404 handler
        this.app.use('*', errorMiddleware.notFoundHandler);
    }

    async start() {
        try {
            // Inicializar configuración de face-api
            await faceRecognitionConfig.initialize();
            
            this.app.listen(this.port, () => {
                logger.info(`🚀 Servidor de Reconocimiento Facial v3.0 ejecutándose en puerto ${this.port}`);
                logger.info(`📊 Modelos cargados: ${faceRecognitionConfig.getLoadedModels().join(', ')}`);
                logger.info(`🎯 Umbral de confianza: ${faceRecognitionConfig.CONFIDENCE_THRESHOLD}`);
            });
        } catch (error) {
            logger.error('Error al inicializar servidor:', error);
            process.exit(1);
        }
    }
}

// Inicializar servidor
const server = new FaceRecognitionServer();
server.start();

module.exports = server;
/**
 * Face Recognition Server v4.0
 *
 * Mejoras v4.0:
 * - GPU/CUDA via @tensorflow/tfjs-node-gpu
 * - Búsqueda HNSW O(log n) - escala a 1M+ caras
 * - Cache Redis distribuida (compartida entre workers PM2)
 * - Batch processing (hasta 50 imágenes por lote)
 * - Métricas Prometheus en /metrics
 * - PM2 Cluster mode para 50-200 req/seg
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const config = require('./src/config/server');
// IMPORTANTE: face-recognition config importa @tensorflow/tfjs-node-gpu PRIMERO
// esto activa CUDA antes de cargar face-api.js
const faceRecognitionConfig = require('./src/config/face-recognition');
const logger = require('./src/utils/logger');
const errorMiddleware = require('./src/middleware/error.middleware');
const metricsService = require('./src/services/metrics.service');

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

        // Middleware de métricas HTTP (antes de las rutas)
        this.app.use(metricsService.httpMiddleware());

        // Rate limiting global
        const globalLimiter = rateLimit({
            windowMs: 15 * 60 * 1000,
            max: 1000,
            message: 'Demasiadas solicitudes desde esta IP',
            standardHeaders: true,
            legacyHeaders: false
        });
        this.app.use('/api/', globalLimiter);

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
            logger.debug(`${req.method} ${req.path} - ${req.ip}`);
            next();
        });
    }

    initializeRoutes() {
        // Health check básico
        this.app.get('/health', (req, res) => {
            res.status(200).json({
                status: 'OK',
                timestamp: new Date().toISOString(),
                version: config.VERSION,
                uptime: Math.floor(process.uptime()),
                pid: process.pid
            });
        });

        // Health check extendido con info GPU e índice
        this.app.get('/health/detailed', async (req, res) => {
            try {
                const hnswService = require('./src/services/hnsw.service');
                const cacheService = require('./src/services/cache.service');
                const User = require('./src/models/User');

                let gpuInfo = { available: false };
                try {
                    const tf = require('@tensorflow/tfjs-node-gpu');
                    gpuInfo = {
                        available: true,
                        backend: tf.getBackend(),
                        memory: tf.memory()
                    };
                } catch {}

                res.status(200).json({
                    status: 'OK',
                    timestamp: new Date().toISOString(),
                    version: config.VERSION,
                    uptime: Math.floor(process.uptime()),
                    pid: process.pid,
                    gpu: gpuInfo,
                    tensorflow: {
                        backend: faceRecognitionConfig.tfBackend,
                        modelsLoaded: faceRecognitionConfig.getLoadedModels()
                    },
                    hnsw: hnswService.getStats(),
                    cache: cacheService.getStats(),
                    users: {
                        active: await User.count({ active_only: true })
                    }
                });
            } catch (error) {
                res.status(500).json({ status: 'ERROR', error: error.message });
            }
        });

        // Endpoint de métricas Prometheus
        this.app.get('/metrics', async (req, res) => {
            res.set('Content-Type', metricsService.contentType);
            res.end(await metricsService.getMetrics());
        });

        // API Routes
        this.app.use('/api/auth', authRoutes);
        this.app.use('/api/recognition', recognitionRoutes);
        this.app.use('/api/users', userRoutes);
        this.app.use('/api/face-config', faceConfigRoutes);
    }

    initializeErrorHandling() {
        this.app.use(errorMiddleware.errorHandler);
        this.app.use('*', errorMiddleware.notFoundHandler);
    }

    async start() {
        try {
            logger.info('🚀 Iniciando Face Recognition Server v4.0...');
            logger.info(`   PID: ${process.pid}`);
            logger.info(`   Node: ${process.version}`);

            // 1. Cargar modelos de face-api.js (con GPU si disponible)
            await faceRecognitionConfig.initialize();

            // 2. Inicializar índice HNSW (cargar desde disco o crear vacío)
            const hnswService = require('./src/services/hnsw.service');
            await hnswService.initialize();

            // 3. Si el índice HNSW está vacío, poblarlo desde la DB
            if (hnswService.size() === 0) {
                logger.info('📂 Índice HNSW vacío, cargando usuarios desde DB...');
                const User = require('./src/models/User');
                const users = await User.getActiveUsers();

                if (users.length > 0) {
                    await hnswService.rebuildIndex(users);
                    logger.info(`✅ ${users.length} usuarios cargados en índice HNSW`);
                } else {
                    logger.info('ℹ️ No hay usuarios en DB, índice HNSW vacío');
                }
            }

            // 4. Actualizar métricas iniciales
            const User = require('./src/models/User');
            metricsService.updateHnswIndexSize(hnswService.size());
            metricsService.updateActiveUsers(await User.count({ active_only: true }));

            // 5. Iniciar servidor HTTP
            this.app.listen(this.port, () => {
                logger.info(`✅ Servidor listo en puerto ${this.port}`);
                logger.info(`   Backend TF: ${faceRecognitionConfig.tfBackend}`);
                logger.info(`   Modelos: ${faceRecognitionConfig.getLoadedModels().join(', ')}`);
                logger.info(`   HNSW Index: ${hnswService.size()} vectores`);
                logger.info(`   Umbral confianza: ${faceRecognitionConfig.CONFIDENCE_THRESHOLD}`);
                logger.info(`   Métricas: http://localhost:${this.port}/metrics`);
                logger.info(`   Health: http://localhost:${this.port}/health/detailed`);
            });

            // Manejar señales de cierre limpio
            process.on('SIGTERM', () => this._gracefulShutdown('SIGTERM'));
            process.on('SIGINT', () => this._gracefulShutdown('SIGINT'));

        } catch (error) {
            logger.error('❌ Error al inicializar servidor:', error);
            process.exit(1);
        }
    }

    async _gracefulShutdown(signal) {
        logger.info(`⚡ ${signal} recibido. Cerrando servidor limpiamente...`);

        try {
            // Guardar índice HNSW antes de cerrar
            const hnswService = require('./src/services/hnsw.service');
            await hnswService.saveIndex();
            logger.info('✅ Índice HNSW guardado');

            // Desconectar Redis si está activo
            const cacheService = require('./src/services/cache.service');
            await cacheService.disconnect();
            logger.info('✅ Redis desconectado');

        } catch (err) {
            logger.warn('Advertencia en cierre limpio:', err.message);
        }

        process.exit(0);
    }
}

const server = new FaceRecognitionServer();
server.start();

module.exports = server;

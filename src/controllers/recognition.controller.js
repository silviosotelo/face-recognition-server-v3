const faceRecognitionService = require('../services/face-recognition.service');
const imageProcessingService = require('../services/image-processing.service');
const batchService = require('../services/batch.service');
const hnswService = require('../services/hnsw.service');
const metricsService = require('../services/metrics.service');
const User = require('../models/User');
const Recognition = require('../models/Recognition');
const logger = require('../utils/logger');
const { validateBase64Image, sanitizeInput } = require('../utils/validators');

class RecognitionController {
    async register(req, res, next) {
        const startTime = Date.now();

        try {
            const { ci, id_cliente, name, image } = req.body;

            if (!ci || !name || !image) {
                return res.status(400).json({
                    error: 'Campos requeridos: ci, name, image',
                    code: 'MISSING_FIELDS'
                });
            }

            const sanitizedData = {
                ci: sanitizeInput(ci),
                id_cliente: sanitizeInput(id_cliente || ''),
                name: sanitizeInput(name)
            };

            if (!validateBase64Image(image)) {
                return res.status(400).json({
                    error: 'Formato de imagen inválido',
                    code: 'INVALID_IMAGE_FORMAT'
                });
            }

            const existingUser = await User.findByCI(sanitizedData.ci);
            if (existingUser) {
                return res.status(409).json({
                    error: 'Ya existe una persona registrada con ese documento',
                    code: 'USER_EXISTS'
                });
            }

            const imageBuffer = Buffer.from(image, 'base64');

            const imageQuality = await imageProcessingService.analyzeImageQuality(imageBuffer);
            if (imageQuality.quality === 'poor') {
                return res.status(400).json({
                    error: 'Calidad de imagen insuficiente. Mejore la iluminación y nitidez.',
                    code: 'POOR_IMAGE_QUALITY',
                    quality: imageQuality
                });
            }

            const faceData = await faceRecognitionService.registerFace(imageBuffer, sanitizedData, {
                requireHighQuality: true
            });

            const userData = {
                ...sanitizedData,
                descriptor: JSON.stringify(faceData.descriptor),
                confidence_score: faceData.confidenceScore
            };

            const newUser = await User.create(userData);

            // Agregar al índice HNSW para búsqueda rápida futura
            await faceRecognitionService.syncHNSWIndex(
                newUser.id,
                faceData.descriptor,
                { ci: sanitizedData.ci, name: sanitizedData.name, id_cliente: sanitizedData.id_cliente },
                'add'
            );

            // Actualizar métrica de usuarios activos
            metricsService.updateActiveUsers(await User.count({ active_only: true }));

            await Recognition.logEvent({
                user_id: newUser.id,
                recognition_type: 'REGISTER',
                confidence_score: faceData.confidenceScore,
                processing_time_ms: Date.now() - startTime,
                success: true,
                ip_address: req.ip,
                user_agent: req.get('User-Agent')
            });

            logger.info(`✅ Usuario registrado: ${sanitizedData.ci}`);

            res.status(201).json({
                success: true,
                message: 'Usuario registrado exitosamente',
                data: {
                    id: newUser.id,
                    ci: newUser.ci,
                    name: newUser.name,
                    confidence_score: faceData.confidenceScore,
                    processing_time_ms: Date.now() - startTime,
                    backend: faceData.backend || require('../config/face-recognition').tfBackend
                }
            });

        } catch (error) {
            await Recognition.logEvent({
                recognition_type: 'REGISTER',
                processing_time_ms: Date.now() - startTime,
                success: false,
                error_message: error.message,
                ip_address: req.ip,
                user_agent: req.get('User-Agent')
            });
            next(error);
        }
    }

    async recognize(req, res, next) {
        const startTime = Date.now();

        try {
            const { image } = req.body;

            if (!image) {
                return res.status(400).json({
                    error: 'Campo requerido: image',
                    code: 'MISSING_IMAGE'
                });
            }

            if (!validateBase64Image(image)) {
                return res.status(400).json({
                    error: 'Formato de imagen inválido',
                    code: 'INVALID_IMAGE_FORMAT'
                });
            }

            // Si HNSW está disponible, no necesitamos cargar usuarios de la DB
            let users = [];
            if (!hnswService.isInitialized || hnswService.size() === 0) {
                users = await User.getActiveUsers();
                if (users.length === 0) {
                    return res.status(404).json({
                        error: 'No hay usuarios registrados en el sistema',
                        code: 'NO_USERS_REGISTERED'
                    });
                }
            }

            const imageBuffer = Buffer.from(image, 'base64');

            const recognition = await faceRecognitionService.recognizeFace(
                imageBuffer,
                users,
                { enableCache: true }
            );

            const processingTime = Date.now() - startTime;

            if (recognition.match) {
                await Recognition.logEvent({
                    user_id: recognition.match.id,
                    recognition_type: 'RECOGNIZE',
                    confidence_score: recognition.confidence,
                    processing_time_ms: processingTime,
                    success: true,
                    ip_address: req.ip,
                    user_agent: req.get('User-Agent')
                });

                logger.info(`✅ Reconocido: ${recognition.match.ci} (dist: ${recognition.confidence?.toFixed(4)})`);

                res.json({
                    success: true,
                    message: 'Usuario reconocido exitosamente',
                    data: {
                        id: recognition.match.id,
                        id_cliente: recognition.match.id_cliente,
                        name: recognition.match.name,
                        ci: recognition.match.ci,
                        confidence: recognition.confidence,
                        similarity: recognition.match.similarity,
                        processing_time_ms: processingTime,
                        backend: recognition.backend
                    }
                });
            } else {
                await Recognition.logEvent({
                    recognition_type: 'RECOGNIZE',
                    confidence_score: recognition.confidence || 0,
                    processing_time_ms: processingTime,
                    success: false,
                    error_message: 'Usuario no reconocido',
                    ip_address: req.ip,
                    user_agent: req.get('User-Agent')
                });

                logger.info(`❌ No reconocido (dist: ${recognition.confidence?.toFixed(4) || 'N/A'})`);

                res.status(404).json({
                    success: false,
                    message: 'Usuario no reconocido',
                    code: 'USER_NOT_RECOGNIZED',
                    data: {
                        confidence: recognition.confidence,
                        processing_time_ms: processingTime,
                        backend: recognition.backend
                    }
                });
            }

        } catch (error) {
            await Recognition.logEvent({
                recognition_type: 'RECOGNIZE',
                processing_time_ms: Date.now() - startTime,
                success: false,
                error_message: error.message,
                ip_address: req.ip,
                user_agent: req.get('User-Agent')
            });
            next(error);
        }
    }

    async update(req, res, next) {
        const startTime = Date.now();

        try {
            const { ci, image } = req.body;

            if (!ci || !image) {
                return res.status(400).json({
                    error: 'Campos requeridos: ci, image',
                    code: 'MISSING_FIELDS'
                });
            }

            const user = await User.findByCI(sanitizeInput(ci));
            if (!user) {
                return res.status(404).json({
                    error: 'Usuario no encontrado',
                    code: 'USER_NOT_FOUND'
                });
            }

            if (!validateBase64Image(image)) {
                return res.status(400).json({
                    error: 'Formato de imagen inválido',
                    code: 'INVALID_IMAGE_FORMAT'
                });
            }

            const imageBuffer = Buffer.from(image, 'base64');

            const faceData = await faceRecognitionService.registerFace(imageBuffer, user, {
                requireHighQuality: true
            });

            await User.update(user.id, {
                descriptor: JSON.stringify(faceData.descriptor),
                confidence_score: faceData.confidenceScore,
                updated_at: new Date().toISOString()
            });

            // Actualizar en índice HNSW
            await faceRecognitionService.syncHNSWIndex(
                user.id,
                faceData.descriptor,
                { ci: user.ci, name: user.name, id_cliente: user.id_cliente },
                'update'
            );

            await Recognition.logEvent({
                user_id: user.id,
                recognition_type: 'UPDATE',
                confidence_score: faceData.confidenceScore,
                processing_time_ms: Date.now() - startTime,
                success: true,
                ip_address: req.ip,
                user_agent: req.get('User-Agent')
            });

            logger.info(`✅ Usuario actualizado: ${ci}`);

            res.json({
                success: true,
                message: 'Usuario actualizado exitosamente',
                data: {
                    id: user.id,
                    ci: user.ci,
                    confidence_score: faceData.confidenceScore,
                    processing_time_ms: Date.now() - startTime
                }
            });

        } catch (error) {
            await Recognition.logEvent({
                recognition_type: 'UPDATE',
                processing_time_ms: Date.now() - startTime,
                success: false,
                error_message: error.message,
                ip_address: req.ip,
                user_agent: req.get('User-Agent')
            });
            next(error);
        }
    }

    /**
     * POST /api/recognition/batch
     * Procesa múltiples imágenes en paralelo (máx 50 por lote)
     *
     * Body: { images: [{ id: "item1", image: "base64..." }, ...] }
     * Response: { jobId, status, totalImages }
     */
    async batchRecognize(req, res, next) {
        try {
            const { images } = req.body;

            if (!Array.isArray(images) || images.length === 0) {
                return res.status(400).json({
                    error: 'Se requiere un array de imágenes: { images: [{ id, image }] }',
                    code: 'INVALID_BATCH_INPUT'
                });
            }

            // Validar formato de cada imagen
            for (let i = 0; i < images.length; i++) {
                const item = images[i];
                if (!item.image || !validateBase64Image(item.image)) {
                    return res.status(400).json({
                        error: `Imagen inválida en posición ${i}`,
                        code: 'INVALID_IMAGE_FORMAT'
                    });
                }
            }

            const job = await batchService.createRecognitionJob(images, { enableCache: true });

            res.status(202).json({
                success: true,
                message: `Lote de ${images.length} imágenes encolado para procesamiento`,
                data: job
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/recognition/batch/:jobId
     * Obtiene el estado y resultados de un job batch
     */
    async getBatchJob(req, res, next) {
        try {
            const { jobId } = req.params;
            const job = batchService.getJob(jobId);

            if (!job) {
                return res.status(404).json({
                    error: 'Job no encontrado',
                    code: 'JOB_NOT_FOUND'
                });
            }

            res.json({
                success: true,
                data: job
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/recognition/batch
     * Lista los últimos jobs batch
     */
    async listBatchJobs(req, res, next) {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 20, 100);
            const jobs = batchService.listJobs(limit);

            res.json({
                success: true,
                data: jobs,
                stats: batchService.getStats()
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /api/recognition/index/rebuild
     * Reconstruye el índice HNSW desde la base de datos
     * Útil después de importaciones masivas o cuando el índice está desincronizado
     */
    async rebuildHNSWIndex(req, res, next) {
        try {
            logger.info('🔨 Solicitud de reconstrucción de índice HNSW recibida');
            const users = await User.getActiveUsers();

            // Ejecutar en background para no bloquear
            const startResult = {
                message: 'Reconstrucción iniciada en background',
                usersToIndex: users.length
            };

            // Procesar async
            hnswService.rebuildIndex(users).then(result => {
                metricsService.updateHnswIndexSize(hnswService.size());
                logger.info(`✅ Índice HNSW reconstruido: ${result.added} usuarios`);
            }).catch(err => {
                logger.error('Error reconstruyendo índice HNSW:', err);
            });

            res.json({
                success: true,
                message: startResult.message,
                data: startResult
            });

        } catch (error) {
            next(error);
        }
    }

    async getStats(req, res, next) {
        try {
            const faceStats = faceRecognitionService.getStats();
            const dbStats = await Recognition.getStats();
            const cacheService = require('../services/cache.service');

            res.json({
                success: true,
                data: {
                    face_recognition: faceStats,
                    database: dbStats,
                    cache: cacheService.getStats(),
                    hnsw: hnswService.getStats(),
                    batch: batchService.getStats(),
                    timestamp: new Date().toISOString()
                }
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new RecognitionController();

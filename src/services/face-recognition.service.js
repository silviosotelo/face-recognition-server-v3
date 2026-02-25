/**
 * Servicio de Reconocimiento Facial con GPU + HNSW
 *
 * Mejoras sobre v3:
 * - GPU aceleración via @tensorflow/tfjs-node-gpu
 * - Búsqueda HNSW O(log n) vs O(n) lineal anterior
 * - SsdMobilenetv1 en GPU (más preciso que TinyFaceDetector en CPU)
 * - Cache Redis distribuida (compartida entre procesos PM2)
 * - Métricas Prometheus integradas
 * - Mejor alineación de rostros via landmarks
 */

const faceapi = require('@vladmandic/face-api');
const { Canvas, Image } = require('canvas');
const sharp = require('sharp');
const crypto = require('crypto');
const logger = require('../utils/logger');
const faceConfig = require('../config/face-recognition');
const cacheService = require('./cache.service');
const imageProcessingService = require('./image-processing.service');
const hnswService = require('./hnsw.service');
const metricsService = require('./metrics.service');

class FaceRecognitionService {
    constructor() {
        this.stats = {
            totalRecognitions: 0,
            successfulRecognitions: 0,
            failedRecognitions: 0,
            cacheHits: 0,
            hnswSearches: 0,
            averageProcessingTimeMs: 0
        };
    }

    async processImageBuffer(imageBuffer, options = {}) {
        if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
            throw new Error('Buffer de imagen inválido');
        }

        const processedBuffer = await imageProcessingService.optimizeForRecognition(imageBuffer);
        const image = await this.bufferToImage(processedBuffer);
        this.validateImageDimensions(image);

        return image;
    }

    async bufferToImage(buffer) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Error al cargar imagen en canvas'));
            img.src = buffer;
        });
    }

    validateImageDimensions(image) {
        const { width, height } = image;

        if (width < 200 || height < 200) {
            throw new Error('Imagen demasiado pequeña (mínimo 200x200px)');
        }

        if (width > 4000 || height > 4000) {
            throw new Error('Imagen demasiado grande (máximo 4000x4000px)');
        }
    }

    /**
     * Registra un nuevo rostro en el sistema
     * Usa SsdMobilenetv1 (alta precisión) + GPU si disponible
     */
    async registerFace(imageBuffer, userData, options = {}) {
        const startTime = Date.now();

        try {
            logger.info(`🔄 Registrando rostro para CI: ${userData.ci}`);

            const image = await this.processImageBuffer(imageBuffer, options);

            // Detección con alta precisión (SSD + GPU)
            const detection = await faceConfig.detectFace(image, 'REGISTER');

            if (!detection) {
                throw new Error('No se detectó ningún rostro en la imagen');
            }

            this.validateFaceQuality(detection, image);

            const descriptor = Array.from(detection.descriptor);
            const confidenceScore = this.calculateConfidenceScore(detection);

            const processingTime = Date.now() - startTime;
            metricsService.recordRegistration(processingTime, 'success');
            logger.info(`✅ Rostro registrado en ${processingTime}ms (backend: ${faceConfig.tfBackend})`);

            return {
                descriptor,
                confidenceScore,
                landmarks: detection.landmarks?.positions || null,
                box: detection.detection?.box || null,
                processingTime
            };

        } catch (error) {
            const processingTime = Date.now() - startTime;
            metricsService.recordRegistration(processingTime, 'error');
            logger.error('❌ Error en registro facial:', error);
            throw error;
        }
    }

    /**
     * Reconoce un rostro comparando contra todos los usuarios registrados
     *
     * Flujo optimizado:
     * 1. Verificar caché (Redis/memoria)
     * 2. Procesar imagen + detectar rostro (GPU)
     * 3. Buscar en índice HNSW O(log n) - escala a 1M+ caras
     * 4. Fallback a búsqueda lineal si HNSW no está disponible
     * 5. Guardar resultado en caché
     */
    async recognizeFace(imageBuffer, userDescriptors = [], options = {}) {
        const startTime = Date.now();

        try {
            logger.info('🔄 Iniciando reconocimiento facial');

            // 1. Verificar caché
            const cacheKey = options.enableCache ?
                this.generateCacheKey(imageBuffer) : null;

            if (cacheKey) {
                const cached = await cacheService.get(cacheKey);
                if (cached) {
                    this.stats.cacheHits++;
                    metricsService.recordCacheHit();
                    metricsService.recordRecognition(Date.now() - startTime, 'cache_hit');
                    logger.info('✅ Resultado desde caché');
                    return cached;
                }
                metricsService.recordCacheMiss();
            }

            // 2. Procesar imagen + detección (GPU si disponible)
            const image = await this.processImageBuffer(imageBuffer, options);
            const detection = await faceConfig.detectFace(image, 'RECOGNIZE');

            if (!detection) {
                throw new Error('No se detectó ningún rostro en la imagen');
            }

            // 3. Buscar match (HNSW preferido, fallback a lineal)
            let match = null;

            if (hnswService.isInitialized && hnswService.size() > 0) {
                match = await this._searchHNSW(detection.descriptor);
                this.stats.hnswSearches++;
            } else if (userDescriptors.length > 0) {
                // Fallback a búsqueda lineal (O(n))
                logger.debug('Usando búsqueda lineal (HNSW no disponible)');
                match = await this.findBestMatch(detection.descriptor, userDescriptors);
            }

            const processingTime = Date.now() - startTime;
            const result = {
                match,
                confidence: match ? match.distance : null,
                processingTime,
                backend: faceConfig.tfBackend,
                detectionBox: detection.detection?.box || null
            };

            // 4. Guardar en caché si hay match
            if (cacheKey && match) {
                await cacheService.set(cacheKey, result, 1800); // 30 min TTL
            }

            // 5. Actualizar métricas y stats
            this._updateStats(processingTime, !!match);
            metricsService.recordRecognition(processingTime, match ? 'success' : 'not_found');
            logger.info(`✅ Reconocimiento en ${processingTime}ms (${faceConfig.tfBackend})`);

            return result;

        } catch (error) {
            const processingTime = Date.now() - startTime;
            metricsService.recordRecognition(processingTime, 'error');
            logger.error('❌ Error en reconocimiento facial:', error);
            throw error;
        }
    }

    /**
     * Búsqueda HNSW O(log n) - para 100K-1M caras
     */
    async _searchHNSW(queryDescriptor) {
        const startTime = Date.now();

        const results = await hnswService.search(
            queryDescriptor,
            5, // Buscar top-5 candidatos
            faceConfig.CONFIDENCE_THRESHOLD
        );

        metricsService.recordHnswSearch(Date.now() - startTime);

        if (results.length === 0) return null;

        const best = results[0];
        if (best.distance > faceConfig.CONFIDENCE_THRESHOLD) return null;

        return {
            id: best.userId,
            ci: best.ci,
            name: best.name,
            id_cliente: best.id_cliente,
            distance: best.distance,
            similarity: best.similarity
        };
    }

    /**
     * Búsqueda lineal O(n) - fallback para cuando HNSW no está disponible
     */
    async findBestMatch(queryDescriptor, userDescriptors) {
        if (!userDescriptors || userDescriptors.length === 0) return null;

        let bestMatch = null;
        let bestDistance = Infinity;

        const comparisons = userDescriptors.map(async (user) => {
            try {
                const dbDescriptor = new Float32Array(JSON.parse(user.descriptor));
                const distance = faceapi.euclideanDistance(queryDescriptor, dbDescriptor);
                return { user, distance, isMatch: distance < faceConfig.CONFIDENCE_THRESHOLD };
            } catch (error) {
                logger.warn(`Error comparando descriptor usuario ${user.ci}:`, error);
                return null;
            }
        });

        const results = await Promise.all(comparisons);

        for (const result of results) {
            if (result && result.isMatch && result.distance < bestDistance) {
                bestDistance = result.distance;
                bestMatch = {
                    ...result.user,
                    distance: result.distance,
                    similarity: Math.round((1 - result.distance) * 100)
                };
            }
        }

        return bestMatch;
    }

    /**
     * Sincroniza el índice HNSW con la base de datos
     * Llama esto después de register/update/delete para mantener el índice actualizado
     */
    async syncHNSWIndex(userId, descriptor, userMeta, operation = 'add') {
        try {
            if (operation === 'add' || operation === 'update') {
                await hnswService.addUser(userId, descriptor, userMeta);
                metricsService.updateHnswIndexSize(hnswService.size());
            } else if (operation === 'remove') {
                await hnswService.removeUser(userId);
                metricsService.updateHnswIndexSize(hnswService.size());
            }
        } catch (error) {
            // Error en HNSW no es crítico - búsqueda lineal como fallback
            logger.warn(`Error sincronizando HNSW para usuario ${userId}:`, error.message);
        }
    }

    validateFaceQuality(detection, image) {
        const { width, height } = detection.detection.box;

        if (width < faceConfig.MIN_FACE_SIZE || height < faceConfig.MIN_FACE_SIZE) {
            throw new Error(`Rostro demasiado pequeño. Mínimo ${faceConfig.MIN_FACE_SIZE}px`);
        }

        if (width > faceConfig.MAX_FACE_SIZE || height > faceConfig.MAX_FACE_SIZE) {
            throw new Error(`Rostro demasiado grande. Máximo ${faceConfig.MAX_FACE_SIZE}px`);
        }

        if (detection.detection.score < 0.8) {
            throw new Error('Calidad de detección insuficiente. Mejore iluminación y enfoque.');
        }
    }

    calculateConfidenceScore(detection) {
        const detectionScore = detection.detection.score || 0;
        const landmarkQuality = detection.landmarks ? 0.9 : 0.7;
        return Math.round((detectionScore * landmarkQuality) * 100) / 100;
    }

    generateCacheKey(imageBuffer) {
        return `face_recog_${crypto.createHash('md5').update(imageBuffer).digest('hex')}`;
    }

    _updateStats(processingTime, success) {
        this.stats.totalRecognitions++;
        if (success) {
            this.stats.successfulRecognitions++;
        } else {
            this.stats.failedRecognitions++;
        }
        this.stats.averageProcessingTimeMs = (
            (this.stats.averageProcessingTimeMs * (this.stats.totalRecognitions - 1) + processingTime) /
            this.stats.totalRecognitions
        );
    }

    getStats() {
        return {
            ...this.stats,
            successRate: this.stats.totalRecognitions > 0
                ? (this.stats.successfulRecognitions / this.stats.totalRecognitions * 100).toFixed(2) + '%'
                : '0%',
            tfBackend: faceConfig.tfBackend,
            gpuEnabled: faceConfig.tfBackend === 'gpu',
            hnswEnabled: hnswService.isInitialized,
            hnswSize: hnswService.size(),
            hnswStats: hnswService.getStats()
        };
    }

    resetStats() {
        this.stats = {
            totalRecognitions: 0,
            successfulRecognitions: 0,
            failedRecognitions: 0,
            cacheHits: 0,
            hnswSearches: 0,
            averageProcessingTimeMs: 0
        };
    }
}

module.exports = new FaceRecognitionService();

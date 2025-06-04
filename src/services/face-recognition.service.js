const faceapi = require('face-api.js');
const { Canvas, Image } = require('canvas');
const sharp = require('sharp');
const logger = require('../utils/logger');
const faceConfig = require('../config/face-recognition');
const cacheService = require('./cache.service');
const imageProcessingService = require('./image-processing.service');

class FaceRecognitionService {
    constructor() {
        this.processingQueue = [];
        this.isProcessing = false;
        this.stats = {
            totalRecognitions: 0,
            successfulRecognitions: 0,
            averageProcessingTime: 0,
            cacheHits: 0
        };
    }

    async processImageBuffer(imageBuffer, options = {}) {
        const startTime = Date.now();
        
        try {
            // Validar buffer de imagen
            if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
                throw new Error('Buffer de imagen inválido');
            }

            // Procesar imagen para optimizar reconocimiento
            const processedBuffer = await imageProcessingService.optimizeForRecognition(imageBuffer);
            
            // Convertir a Image object para face-api
            const image = await this.bufferToImage(processedBuffer);
            
            // Validar dimensiones de imagen
            this.validateImageDimensions(image);
            
            const processingTime = Date.now() - startTime;
            this.updateStats(processingTime);
            
            return image;
            
        } catch (error) {
            logger.error('Error al procesar imagen:', error);
            throw new Error(`Error en procesamiento de imagen: ${error.message}`);
        }
    }

    async bufferToImage(buffer) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = (err) => reject(new Error('Error al cargar imagen'));
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

    async registerFace(imageBuffer, userData, options = {}) {
        const startTime = Date.now();
        
        try {
            logger.info(`🔄 Iniciando registro facial para CI: ${userData.ci}`);
            
            // Procesar imagen
            const image = await this.processImageBuffer(imageBuffer, options);
            
            // Detectar rostro con alta precisión para registro
            const detection = await faceConfig.detectFace(image, 'REGISTER');
            
            if (!detection) {
                throw new Error('No se detectó ningún rostro en la imagen');
            }

            // Validar calidad del rostro detectado
            this.validateFaceQuality(detection, image);
            
            // Extraer descriptor facial
            const descriptor = Array.from(detection.descriptor);
            
            // Calcular score de confianza
            const confidenceScore = this.calculateConfidenceScore(detection);
            
            const processingTime = Date.now() - startTime;
            logger.info(`✅ Rostro registrado exitosamente en ${processingTime}ms`);
            
            return {
                descriptor,
                confidenceScore,
                landmarks: detection.landmarks?.positions || null,
                box: detection.detection?.box || null,
                processingTime
            };
            
        } catch (error) {
            logger.error('❌ Error en registro facial:', error);
            throw error;
        }
    }

    async recognizeFace(imageBuffer, userDescriptors = [], options = {}) {
        const startTime = Date.now();
        
        try {
            logger.info('🔄 Iniciando reconocimiento facial');
            
            // Verificar caché si está habilitado
            const cacheKey = options.enableCache ? 
                await this.generateCacheKey(imageBuffer) : null;
                
            if (cacheKey) {
                const cached = await cacheService.get(cacheKey);
                if (cached) {
                    this.stats.cacheHits++;
                    logger.info('✅ Resultado obtenido desde caché');
                    return cached;
                }
            }
            
            // Procesar imagen
            const image = await this.processImageBuffer(imageBuffer, options);
            
            // Detectar rostro
            const detection = await faceConfig.detectFace(image, 'RECOGNIZE');
            
            if (!detection) {
                throw new Error('No se detectó ningún rostro en la imagen');
            }

            // Encontrar mejor coincidencia
            const match = await this.findBestMatch(detection.descriptor, userDescriptors);
            
            const processingTime = Date.now() - startTime;
            
            const result = {
                match,
                confidence: match ? match.distance : null,
                processingTime,
                detectionBox: detection.detection?.box || null
            };
            
            // Guardar en caché si está habilitado
            if (cacheKey && match) {
                await cacheService.set(cacheKey, result);
            }
            
            this.updateRecognitionStats(!!match);
            logger.info(`✅ Reconocimiento completado en ${processingTime}ms`);
            
            return result;
            
        } catch (error) {
            logger.error('❌ Error en reconocimiento facial:', error);
            throw error;
        }
    }

    async findBestMatch(queryDescriptor, userDescriptors) {
        if (!userDescriptors || userDescriptors.length === 0) {
            return null;
        }

        let bestMatch = null;
        let bestDistance = Infinity;

        // Paralelizar comparaciones para mejor rendimiento
        const comparisons = userDescriptors.map(async (user) => {
            try {
                const dbDescriptor = new Float32Array(JSON.parse(user.descriptor));
                const distance = faceapi.euclideanDistance(queryDescriptor, dbDescriptor);
                
                return {
                    user,
                    distance,
                    isMatch: distance < faceConfig.CONFIDENCE_THRESHOLD
                };
            } catch (error) {
                logger.warn(`Error comparando descriptor para usuario ${user.ci}:`, error);
                return null;
            }
        });

        const results = await Promise.all(comparisons);
        
        // Encontrar la mejor coincidencia
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

    validateFaceQuality(detection, image) {
        const { width, height } = detection.detection.box;
        
        // Validar tamaño mínimo del rostro
        if (width < faceConfig.MIN_FACE_SIZE || height < faceConfig.MIN_FACE_SIZE) {
            throw new Error(`Rostro demasiado pequeño. Mínimo ${faceConfig.MIN_FACE_SIZE}px`);
        }
        
        // Validar tamaño máximo del rostro
        if (width > faceConfig.MAX_FACE_SIZE || height > faceConfig.MAX_FACE_SIZE) {
            throw new Error(`Rostro demasiado grande. Máximo ${faceConfig.MAX_FACE_SIZE}px`);
        }
        
        // Validar score de detección
        if (detection.detection.score < 0.8) {
            throw new Error('Calidad de detección insuficiente. Mejore la iluminación y enfoque.');
        }
    }

    calculateConfidenceScore(detection) {
        const detectionScore = detection.detection.score || 0;
        const landmarkQuality = detection.landmarks ? 0.9 : 0.7;
        
        return Math.round((detectionScore * landmarkQuality) * 100) / 100;
    }

    async generateCacheKey(imageBuffer) {
        const crypto = require('crypto');
        const hash = crypto.createHash('md5').update(imageBuffer).digest('hex');
        return `face_recognition_${hash}`;
    }

    updateStats(processingTime) {
        this.stats.totalRecognitions++;
        this.stats.averageProcessingTime = 
            (this.stats.averageProcessingTime + processingTime) / 2;
    }

    updateRecognitionStats(success) {
        if (success) {
            this.stats.successfulRecognitions++;
        }
    }

    getStats() {
        return {
            ...this.stats,
            successRate: this.stats.totalRecognitions > 0 ? 
                (this.stats.successfulRecognitions / this.stats.totalRecognitions * 100).toFixed(2) + '%' : '0%'
        };
    }

    resetStats() {
        this.stats = {
            totalRecognitions: 0,
            successfulRecognitions: 0,
            averageProcessingTime: 0,
            cacheHits: 0
        };
    }
}

module.exports = new FaceRecognitionService();
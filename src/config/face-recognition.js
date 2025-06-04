const faceapi = require('face-api.js');
const { Canvas, Image, ImageData } = require('canvas');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const config = require('./server');

class FaceRecognitionConfig {
    constructor() {
        this.modelsLoaded = false;
        this.loadedModels = [];
        
        // ===== 🎯 CONFIGURACIÓN DESDE VARIABLES DE ENTORNO =====
        
        // Umbrales de confianza configurables
        this.CONFIDENCE_THRESHOLD = parseFloat(process.env.FACE_CONFIDENCE_THRESHOLD) || 0.42;
        this.DETECTION_CONFIDENCE = parseFloat(process.env.FACE_DETECTION_CONFIDENCE) || 0.65;
        this.LANDMARK_CONFIDENCE = parseFloat(process.env.FACE_LANDMARK_CONFIDENCE) || 0.7;
        
        // Tamaños de rostro configurables
        this.MIN_FACE_SIZE = parseInt(process.env.FACE_MIN_SIZE) || 60;
        this.MAX_FACE_SIZE = parseInt(process.env.FACE_MAX_SIZE) || 800;
        
        // Configuración de resolución
        this.INPUT_SIZE_TINY = parseInt(process.env.FACE_INPUT_SIZE_TINY) || 416;
        this.INPUT_SIZE_SSD = parseInt(process.env.FACE_INPUT_SIZE_SSD) || 512;
        this.MAX_RESULTS = parseInt(process.env.FACE_MAX_RESULTS) || 1;
        
        // Configuración específica por tipo de operación
        this.OPERATION_CONFIG = {
            REGISTER: {
                confidence: parseFloat(process.env.REGISTER_CONFIDENCE) || 0.75,
                detectionConfidence: parseFloat(process.env.REGISTER_DETECTION_CONFIDENCE) || 0.8,
                inputSize: this.INPUT_SIZE_SSD,
                requireLandmarks: true,
                requireHighQuality: true
            },
            RECOGNIZE: {
                confidence: parseFloat(process.env.RECOGNIZE_CONFIDENCE) || 0.42,
                detectionConfidence: parseFloat(process.env.RECOGNIZE_DETECTION_CONFIDENCE) || 0.65,
                inputSize: this.INPUT_SIZE_TINY,
                requireLandmarks: false,
                requireHighQuality: false
            },
            PRECISE: {
                confidence: parseFloat(process.env.PRECISE_CONFIDENCE) || 0.35,
                detectionConfidence: parseFloat(process.env.PRECISE_DETECTION_CONFIDENCE) || 0.7,
                inputSize: this.INPUT_SIZE_SSD,
                requireLandmarks: true,
                requireHighQuality: true
            }
        };
        
        // Configuración avanzada
        this.DETECTION_TIMEOUT = parseInt(process.env.FACE_DETECTION_TIMEOUT) || 10000;
        this.MODEL_LOAD_TIMEOUT = parseInt(process.env.FACE_MODEL_LOAD_TIMEOUT) || 30000;
        
        // Configuración de validación
        this.REQUIRE_LANDMARKS = process.env.REQUIRE_LANDMARKS === 'true';
        this.REQUIRE_EXPRESSIONS = process.env.REQUIRE_EXPRESSIONS === 'true';
        this.VALIDATE_FACE_AREA = process.env.VALIDATE_FACE_AREA !== 'false';
        this.VALIDATE_FACE_CLARITY = process.env.VALIDATE_FACE_CLARITY !== 'false';
        
        // ===== OPCIONES DE DETECCIÓN DINÁMICAS =====
        this.buildDetectionOptions();
        
        // Monkey patch para Canvas
        faceapi.env.monkeyPatch({ Canvas, Image, ImageData });
        
        // Log configuración cargada
        this.logConfiguration();
    }

    buildDetectionOptions() {
        this.DETECTION_OPTIONS = {
            // Para registros (alta precisión)
            REGISTER: new faceapi.SsdMobilenetv1Options({ 
                minConfidence: this.OPERATION_CONFIG.REGISTER.detectionConfidence,
                maxResults: this.MAX_RESULTS,
                inputSize: this.OPERATION_CONFIG.REGISTER.inputSize
            }),
            
            // Para reconocimiento rápido (velocidad balanceada)
            RECOGNIZE: new faceapi.TinyFaceDetectorOptions({ 
                inputSize: this.OPERATION_CONFIG.RECOGNIZE.inputSize,
                scoreThreshold: this.OPERATION_CONFIG.RECOGNIZE.detectionConfidence
            }),
            
            // Para reconocimiento de alta precisión
            PRECISE: new faceapi.SsdMobilenetv1Options({ 
                minConfidence: this.OPERATION_CONFIG.PRECISE.detectionConfidence,
                maxResults: this.MAX_RESULTS,
                inputSize: this.OPERATION_CONFIG.PRECISE.inputSize
            })
        };
    }

    logConfiguration() {
        logger.info('🎯 Configuración de Reconocimiento Facial cargada:', {
            confidenceThreshold: this.CONFIDENCE_THRESHOLD,
            detectionConfidence: this.DETECTION_CONFIDENCE,
            minFaceSize: this.MIN_FACE_SIZE,
            maxFaceSize: this.MAX_FACE_SIZE,
            inputSizeTiny: this.INPUT_SIZE_TINY,
            inputSizeSSD: this.INPUT_SIZE_SSD,
            requireLandmarks: this.REQUIRE_LANDMARKS,
            validateFaceArea: this.VALIDATE_FACE_AREA
        });
    }

    async initialize() {
        try {
            logger.info('🔄 Inicializando modelos de face-api.js...');
            
            const modelPath = path.resolve(config.MODELS_PATH);
            
            if (!fs.existsSync(modelPath)) {
                throw new Error(`Directorio de modelos no encontrado: ${modelPath}`);
            }

            // Cargar modelos con timeout
            const modelPromises = [
                this.loadModel('tinyFaceDetector', faceapi.nets.tinyFaceDetector, modelPath),
                this.loadModel('ssdMobilenetv1', faceapi.nets.ssdMobilenetv1, modelPath),
                this.loadModel('faceRecognitionNet', faceapi.nets.faceRecognitionNet, modelPath),
                this.loadModel('faceLandmark68Net', faceapi.nets.faceLandmark68Net, modelPath),
                this.loadModel('faceExpressionNet', faceapi.nets.faceExpressionNet, modelPath)
            ];

            // Aplicar timeout a la carga de modelos
            const loadWithTimeout = Promise.race([
                Promise.allSettled(modelPromises),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout cargando modelos')), this.MODEL_LOAD_TIMEOUT)
                )
            ]);

            await loadWithTimeout;
            
            this.modelsLoaded = true;
            logger.info(`✅ Modelos cargados exitosamente: ${this.loadedModels.join(', ')}`);
            
            // Validar que los modelos críticos estén cargados
            this.validateCriticalModels();
            
            // Log estadísticas de configuración
            this.logLoadedConfiguration();
            
        } catch (error) {
            logger.error('❌ Error al cargar modelos:', error);
            throw error;
        }
    }

    async loadModel(name, modelNet, modelPath) {
        try {
            await modelNet.loadFromDisk(modelPath);
            this.loadedModels.push(name);
            logger.info(`✅ Modelo ${name} cargado`);
        } catch (error) {
            logger.warn(`⚠️ No se pudo cargar modelo ${name}:`, error.message);
        }
    }

    validateCriticalModels() {
        const critical = ['faceRecognitionNet'];
        const missing = critical.filter(model => !this.loadedModels.includes(model));
        
        if (missing.length > 0) {
            throw new Error(`Modelos críticos faltantes: ${missing.join(', ')}`);
        }
    }

    logLoadedConfiguration() {
        logger.info('📊 Configuración final de reconocimiento:', {
            modelos: this.loadedModels,
            operaciones: {
                register: `Confianza: ${this.OPERATION_CONFIG.REGISTER.confidence}, Detección: ${this.OPERATION_CONFIG.REGISTER.detectionConfidence}`,
                recognize: `Confianza: ${this.OPERATION_CONFIG.RECOGNIZE.confidence}, Detección: ${this.OPERATION_CONFIG.RECOGNIZE.detectionConfidence}`,
                precise: `Confianza: ${this.OPERATION_CONFIG.PRECISE.confidence}, Detección: ${this.OPERATION_CONFIG.PRECISE.detectionConfidence}`
            },
            validaciones: {
                landmarks: this.REQUIRE_LANDMARKS,
                faceArea: this.VALIDATE_FACE_AREA,
                clarity: this.VALIDATE_FACE_CLARITY
            }
        });
    }

    getDetectionOptions(type = 'RECOGNIZE') {
        return this.DETECTION_OPTIONS[type] || this.DETECTION_OPTIONS.RECOGNIZE;
    }

    getOperationConfig(type = 'RECOGNIZE') {
        return this.OPERATION_CONFIG[type] || this.OPERATION_CONFIG.RECOGNIZE;
    }

    getLoadedModels() {
        return this.loadedModels;
    }

    isModelLoaded(modelName) {
        return this.loadedModels.includes(modelName);
    }

    async detectFace(image, operationType = 'RECOGNIZE') {
        if (!this.modelsLoaded) {
            throw new Error('Modelos no están cargados');
        }

        const detectionOptions = this.getDetectionOptions(operationType);
        const operationConfig = this.getOperationConfig(operationType);
        
        try {
            // Aplicar timeout a la detección
            const detectionPromise = faceapi
                .detectSingleFace(image, detectionOptions)
                .withFaceLandmarks()
                .withFaceDescriptor();
            
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout en detección facial')), this.DETECTION_TIMEOUT)
            );
            
            const detection = await Promise.race([detectionPromise, timeoutPromise]);
            
            // Validaciones adicionales si están habilitadas
            if (detection && this.VALIDATE_FACE_AREA) {
                this.validateFaceArea(detection, operationConfig);
            }
            
            if (detection && operationConfig.requireLandmarks && !detection.landmarks) {
                throw new Error('Landmarks requeridos pero no detectados');
            }
                
            return detection;
        } catch (error) {
            logger.error('Error en detección facial:', error);
            throw new Error(`Error al procesar imagen para detección facial: ${error.message}`);
        }
    }

    validateFaceArea(detection, operationConfig) {
        if (!detection.detection || !detection.detection.box) {
            throw new Error('Información de detección incompleta');
        }

        const { width, height } = detection.detection.box;
        
        if (width < this.MIN_FACE_SIZE || height < this.MIN_FACE_SIZE) {
            throw new Error(`Rostro demasiado pequeño. Mínimo: ${this.MIN_FACE_SIZE}px`);
        }
        
        if (width > this.MAX_FACE_SIZE || height > this.MAX_FACE_SIZE) {
            throw new Error(`Rostro demasiado grande. Máximo: ${this.MAX_FACE_SIZE}px`);
        }

        // Validación de score si es requerida alta calidad
        if (operationConfig.requireHighQuality && detection.detection.score < operationConfig.detectionConfidence) {
            throw new Error(`Calidad de detección insuficiente: ${detection.detection.score.toFixed(3)} < ${operationConfig.detectionConfidence}`);
        }
    }

    // ===== NUEVOS MÉTODOS PARA GESTIÓN DE CONFIGURACIÓN =====

    updateConfiguration(newConfig) {
        try {
            // Actualizar configuración en tiempo real
            if (newConfig.confidenceThreshold !== undefined) {
                this.CONFIDENCE_THRESHOLD = parseFloat(newConfig.confidenceThreshold);
            }
            
            if (newConfig.detectionConfidence !== undefined) {
                this.DETECTION_CONFIDENCE = parseFloat(newConfig.detectionConfidence);
            }
            
            if (newConfig.minFaceSize !== undefined) {
                this.MIN_FACE_SIZE = parseInt(newConfig.minFaceSize);
            }
            
            if (newConfig.maxFaceSize !== undefined) {
                this.MAX_FACE_SIZE = parseInt(newConfig.maxFaceSize);
            }
            
            // Reconstruir opciones de detección
            this.buildDetectionOptions();
            
            logger.info('✅ Configuración actualizada en tiempo real:', newConfig);
            return true;
            
        } catch (error) {
            logger.error('Error actualizando configuración:', error);
            return false;
        }
    }

    getCurrentConfiguration() {
        return {
            confidenceThreshold: this.CONFIDENCE_THRESHOLD,
            detectionConfidence: this.DETECTION_CONFIDENCE,
            landmarkConfidence: this.LANDMARK_CONFIDENCE,
            minFaceSize: this.MIN_FACE_SIZE,
            maxFaceSize: this.MAX_FACE_SIZE,
            inputSizeTiny: this.INPUT_SIZE_TINY,
            inputSizeSSD: this.INPUT_SIZE_SSD,
            maxResults: this.MAX_RESULTS,
            operations: this.OPERATION_CONFIG,
            validations: {
                requireLandmarks: this.REQUIRE_LANDMARKS,
                requireExpressions: this.REQUIRE_EXPRESSIONS,
                validateFaceArea: this.VALIDATE_FACE_AREA,
                validateFaceClarity: this.VALIDATE_FACE_CLARITY
            },
            timeouts: {
                detection: this.DETECTION_TIMEOUT,
                modelLoad: this.MODEL_LOAD_TIMEOUT
            },
            modelsLoaded: this.modelsLoaded,
            loadedModels: this.loadedModels
        };
    }

    getRecommendedSettings(scenario) {
        const recommendations = {
            // Para aplicaciones de alta seguridad (bancos, gobierno)
            'high_security': {
                confidenceThreshold: 0.25,
                detectionConfidence: 0.85,
                requireLandmarks: true,
                validateFaceArea: true,
                inputSize: 512
            },
            
            // Para aplicaciones comerciales balanceadas
            'balanced': {
                confidenceThreshold: 0.42,
                detectionConfidence: 0.65,
                requireLandmarks: false,
                validateFaceArea: true,
                inputSize: 416
            },
            
            // Para aplicaciones de alta velocidad
            'fast': {
                confidenceThreshold: 0.55,
                detectionConfidence: 0.6,
                requireLandmarks: false,
                validateFaceArea: false,
                inputSize: 320
            },
            
            // Para aplicaciones muy permisivas
            'permissive': {
                confidenceThreshold: 0.65,
                detectionConfidence: 0.5,
                requireLandmarks: false,
                validateFaceArea: false,
                inputSize: 416
            }
        };

        return recommendations[scenario] || recommendations['balanced'];
    }
}

module.exports = new FaceRecognitionConfig();
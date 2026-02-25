/**
 * Configuración de Face Recognition con soporte GPU/CUDA
 *
 * IMPORTANTE: @tensorflow/tfjs-node-gpu DEBE importarse ANTES que face-api.js
 * para que TensorFlow use el backend CUDA en lugar de CPU.
 *
 * Con NVIDIA GPU + CUDA:
 * - SsdMobilenetv1 en GPU: ~30-50ms (vs ~300-500ms en CPU)
 * - Todos los modelos corren en GPU automáticamente
 * - TF_FORCE_GPU_ALLOW_GROWTH=true evita que TF reserve toda la VRAM
 */

// ===== INICIALIZACIÓN GPU =====
// Cargar @tensorflow/tfjs-node-gpu PRIMERO para activar CUDA.
// Si GPU falla, cargar @tensorflow/tfjs-node (CPU) como fallback exclusivo.
// NUNCA cargar ambos simultáneamente — ambos registran el backend 'tensorflow'
// con los mismos kernel names, causando cientos de warnings de registro duplicado.
let tf = null;
let tfBackend = 'default';

try {
    tf = require('@tensorflow/tfjs-node-gpu');
    tfBackend = 'gpu';
    console.log('[TF] GPU backend (CUDA) cargado correctamente');
} catch (gpuError) {
    console.warn('[TF] GPU no disponible, intentando CPU Node.js:', gpuError.message);
    try {
        tf = require('@tensorflow/tfjs-node');
        tfBackend = 'cpu';
        console.log('[TF] CPU backend (Node.js nativo) cargado como fallback');
    } catch (cpuError) {
        console.warn('[TF] tfjs-node no disponible, usando backend por defecto de face-api');
        tfBackend = 'default';
    }
}

const faceapi = require('@vladmandic/face-api');
const { Canvas, Image, ImageData } = require('canvas');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const config = require('./server');

class FaceRecognitionConfig {
    constructor() {
        this.modelsLoaded = false;
        this.loadedModels = [];
        this.tfBackend = tfBackend;

        // ===== CONFIGURACIÓN DESDE VARIABLES DE ENTORNO =====

        // Umbrales de confianza configurables
        this.CONFIDENCE_THRESHOLD = parseFloat(process.env.FACE_CONFIDENCE_THRESHOLD) || 0.42;
        this.DETECTION_CONFIDENCE = parseFloat(process.env.FACE_DETECTION_CONFIDENCE) || 0.65;
        this.LANDMARK_CONFIDENCE = parseFloat(process.env.FACE_LANDMARK_CONFIDENCE) || 0.7;

        // Tamaños de rostro configurables
        this.MIN_FACE_SIZE = parseInt(process.env.FACE_MIN_SIZE) || 60;
        this.MAX_FACE_SIZE = parseInt(process.env.FACE_MAX_SIZE) || 800;

        // Con GPU, podemos usar resoluciones más altas sin penalidad de velocidad
        this.INPUT_SIZE_TINY = parseInt(process.env.FACE_INPUT_SIZE_TINY) || 416;
        this.INPUT_SIZE_SSD = parseInt(process.env.FACE_INPUT_SIZE_SSD) || 512;
        // En GPU usamos SSD para todo (más preciso, misma velocidad que Tiny en CPU)
        this.INPUT_SIZE_SSD_GPU = parseInt(process.env.FACE_INPUT_SIZE_SSD_GPU) || 608;
        this.MAX_RESULTS = parseInt(process.env.FACE_MAX_RESULTS) || 1;

        // Configuración específica por tipo de operación
        this.OPERATION_CONFIG = {
            REGISTER: {
                confidence: parseFloat(process.env.REGISTER_CONFIDENCE) || 0.75,
                detectionConfidence: parseFloat(process.env.REGISTER_DETECTION_CONFIDENCE) || 0.8,
                inputSize: this.tfBackend === 'gpu' ? this.INPUT_SIZE_SSD_GPU : this.INPUT_SIZE_SSD,
                requireLandmarks: true,
                requireHighQuality: true
            },
            RECOGNIZE: {
                confidence: parseFloat(process.env.RECOGNIZE_CONFIDENCE) || 0.42,
                detectionConfidence: parseFloat(process.env.RECOGNIZE_DETECTION_CONFIDENCE) || 0.65,
                // En GPU usamos SSD para reconocimiento también (más preciso, igual de rápido)
                inputSize: this.tfBackend === 'gpu' ? this.INPUT_SIZE_SSD : this.INPUT_SIZE_TINY,
                requireLandmarks: false,
                requireHighQuality: false
            },
            PRECISE: {
                confidence: parseFloat(process.env.PRECISE_CONFIDENCE) || 0.35,
                detectionConfidence: parseFloat(process.env.PRECISE_DETECTION_CONFIDENCE) || 0.7,
                inputSize: this.tfBackend === 'gpu' ? this.INPUT_SIZE_SSD_GPU : this.INPUT_SIZE_SSD,
                requireLandmarks: true,
                requireHighQuality: true
            }
        };

        // Configuración avanzada
        this.DETECTION_TIMEOUT = parseInt(process.env.FACE_DETECTION_TIMEOUT) || 10000;
        this.MODEL_LOAD_TIMEOUT = parseInt(process.env.FACE_MODEL_LOAD_TIMEOUT) || 60000;

        // Configuración de validación
        this.REQUIRE_LANDMARKS = process.env.REQUIRE_LANDMARKS === 'true';
        this.REQUIRE_EXPRESSIONS = process.env.REQUIRE_EXPRESSIONS === 'true';
        this.VALIDATE_FACE_AREA = process.env.VALIDATE_FACE_AREA !== 'false';
        this.VALIDATE_FACE_CLARITY = process.env.VALIDATE_FACE_CLARITY !== 'false';

        // Configuración GPU
        this.GPU_MEMORY_GROWTH = process.env.TF_FORCE_GPU_ALLOW_GROWTH !== 'false';
        this.GPU_WARMUP_ENABLED = process.env.GPU_WARMUP !== 'false';

        // Monkey patch para Canvas (requerido por face-api.js en Node.js)
        faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

        // Construir opciones de detección
        this.buildDetectionOptions();

        this.logConfiguration();
    }

    buildDetectionOptions() {
        // En GPU: usar SsdMobilenetv1 para todo (más preciso, misma velocidad)
        // En CPU: usar TinyFaceDetector para reconocimiento (más rápido)
        const useHighPrecision = this.tfBackend === 'gpu';

        this.DETECTION_OPTIONS = {
            // Para registros (siempre alta precisión con SSD)
            REGISTER: new faceapi.SsdMobilenetv1Options({
                minConfidence: this.OPERATION_CONFIG.REGISTER.detectionConfidence,
                maxResults: this.MAX_RESULTS
            }),

            // Para reconocimiento:
            // GPU: SsdMobilenetv1 (más preciso, igual de rápido con GPU)
            // CPU: TinyFaceDetector (más rápido en CPU)
            RECOGNIZE: useHighPrecision
                ? new faceapi.SsdMobilenetv1Options({
                    minConfidence: this.OPERATION_CONFIG.RECOGNIZE.detectionConfidence,
                    maxResults: this.MAX_RESULTS
                })
                : new faceapi.TinyFaceDetectorOptions({
                    inputSize: this.OPERATION_CONFIG.RECOGNIZE.inputSize,
                    scoreThreshold: this.OPERATION_CONFIG.RECOGNIZE.detectionConfidence
                }),

            // Para reconocimiento de alta precisión (siempre SSD)
            PRECISE: new faceapi.SsdMobilenetv1Options({
                minConfidence: this.OPERATION_CONFIG.PRECISE.detectionConfidence,
                maxResults: this.MAX_RESULTS
            })
        };
    }

    logConfiguration() {
        logger.info('🎯 Face Recognition Config:', {
            tfBackend: this.tfBackend,
            gpuEnabled: this.tfBackend === 'gpu',
            confidenceThreshold: this.CONFIDENCE_THRESHOLD,
            detectionConfidence: this.DETECTION_CONFIDENCE,
            minFaceSize: this.MIN_FACE_SIZE,
            maxFaceSize: this.MAX_FACE_SIZE,
            recognizeInputSize: this.OPERATION_CONFIG.RECOGNIZE.inputSize,
            requireLandmarks: this.REQUIRE_LANDMARKS,
            validateFaceArea: this.VALIDATE_FACE_AREA
        });
    }

    async initialize() {
        try {
            logger.info(`🔄 Inicializando modelos de face-api.js (backend: ${this.tfBackend})...`);

            const modelPath = path.resolve(config.MODELS_PATH);

            if (!fs.existsSync(modelPath)) {
                throw new Error(`Directorio de modelos no encontrado: ${modelPath}`);
            }

            // Cargar modelos con timeout extendido (GPU necesita más tiempo)
            const modelPromises = [
                this.loadModel('tinyFaceDetector', faceapi.nets.tinyFaceDetector, modelPath),
                this.loadModel('ssdMobilenetv1', faceapi.nets.ssdMobilenetv1, modelPath),
                this.loadModel('faceRecognitionNet', faceapi.nets.faceRecognitionNet, modelPath),
                this.loadModel('faceLandmark68Net', faceapi.nets.faceLandmark68Net, modelPath),
                this.loadModel('faceExpressionNet', faceapi.nets.faceExpressionNet, modelPath)
            ];

            const loadWithTimeout = Promise.race([
                Promise.allSettled(modelPromises),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout cargando modelos')), this.MODEL_LOAD_TIMEOUT)
                )
            ]);

            await loadWithTimeout;

            this.modelsLoaded = true;
            logger.info(`✅ Modelos cargados: ${this.loadedModels.join(', ')}`);

            this.validateCriticalModels();

            // Warmup de GPU: ejecutar una inferencia vacía para "calentar" CUDA
            if (this.tfBackend === 'gpu' && this.GPU_WARMUP_ENABLED) {
                await this._warmupGPU();
            }

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
        const critical = ['faceRecognitionNet', 'ssdMobilenetv1'];
        const missing = critical.filter(model => !this.loadedModels.includes(model));

        if (missing.length > 0) {
            throw new Error(`Modelos críticos faltantes: ${missing.join(', ')}`);
        }
    }

    /**
     * Warmup GPU: ejecuta una inferencia de prueba para:
     * 1. Compilar shaders CUDA (evita latencia en primera solicitud real)
     * 2. Pre-alocar memoria GPU
     * 3. Verificar que la GPU funciona correctamente
     */
    async _warmupGPU() {
        try {
            logger.info('🔥 Calentando GPU (warmup de TensorFlow CUDA)...');
            const startTime = Date.now();

            // Crear una imagen de prueba mínima
            const { createCanvas } = require('canvas');
            const canvas = createCanvas(160, 160);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'gray';
            ctx.fillRect(0, 0, 160, 160);

            // Ejecutar detección en imagen vacía (compilará shaders CUDA)
            await Promise.race([
                faceapi.detectSingleFace(canvas, this.DETECTION_OPTIONS.RECOGNIZE),
                new Promise(resolve => setTimeout(resolve, 5000)) // Timeout de warmup
            ]);

            const warmupTime = Date.now() - startTime;
            logger.info(`✅ GPU calentada en ${warmupTime}ms - primera solicitud será instantánea`);

        } catch (error) {
            // El warmup es opcional, no bloquear inicio si falla
            logger.warn('⚠️ GPU warmup falló (no crítico):', error.message);
        }
    }

    logLoadedConfiguration() {
        logger.info('📊 Configuración final:', {
            backend: this.tfBackend,
            modelos: this.loadedModels,
            operaciones: {
                register: `SSD (confianza: ${this.OPERATION_CONFIG.REGISTER.confidence})`,
                recognize: `${this.tfBackend === 'gpu' ? 'SSD-GPU' : 'Tiny-CPU'} (confianza: ${this.OPERATION_CONFIG.RECOGNIZE.confidence})`,
                precise: `SSD (confianza: ${this.OPERATION_CONFIG.PRECISE.confidence})`
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
            const detectionPromise = faceapi
                .detectSingleFace(image, detectionOptions)
                .withFaceLandmarks()
                .withFaceDescriptor();

            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout en detección facial')), this.DETECTION_TIMEOUT)
            );

            const detection = await Promise.race([detectionPromise, timeoutPromise]);

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

        if (operationConfig.requireHighQuality && detection.detection.score < operationConfig.detectionConfidence) {
            throw new Error(`Calidad de detección insuficiente: ${detection.detection.score.toFixed(3)} < ${operationConfig.detectionConfidence}`);
        }
    }

    updateConfiguration(newConfig) {
        try {
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
            tfBackend: this.tfBackend,
            gpuEnabled: this.tfBackend === 'gpu',
            confidenceThreshold: this.CONFIDENCE_THRESHOLD,
            detectionConfidence: this.DETECTION_CONFIDENCE,
            landmarkConfidence: this.LANDMARK_CONFIDENCE,
            minFaceSize: this.MIN_FACE_SIZE,
            maxFaceSize: this.MAX_FACE_SIZE,
            inputSizeTiny: this.INPUT_SIZE_TINY,
            inputSizeSSD: this.INPUT_SIZE_SSD,
            inputSizeSSDGpu: this.INPUT_SIZE_SSD_GPU,
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
            'high_security': {
                confidenceThreshold: 0.25,
                detectionConfidence: 0.85,
                requireLandmarks: true,
                validateFaceArea: true,
                inputSize: this.tfBackend === 'gpu' ? 608 : 512
            },
            'balanced': {
                confidenceThreshold: 0.42,
                detectionConfidence: 0.65,
                requireLandmarks: false,
                validateFaceArea: true,
                inputSize: this.tfBackend === 'gpu' ? 512 : 416
            },
            'fast': {
                confidenceThreshold: 0.55,
                detectionConfidence: 0.6,
                requireLandmarks: false,
                validateFaceArea: false,
                inputSize: this.tfBackend === 'gpu' ? 416 : 320
            },
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

const instance = new FaceRecognitionConfig();
instance.tf = tf;          // expuesto para app.js y metrics.service (evita múltiples require)
module.exports = instance;

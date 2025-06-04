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
        
        // Configuración optimizada de detección
        this.CONFIDENCE_THRESHOLD = 0.38; // Umbral optimizado
        this.MIN_FACE_SIZE = 80; // Tamaño mínimo de rostro en píxeles
        this.MAX_FACE_SIZE = 800; // Tamaño máximo de rostro en píxeles
        
        // Opciones de detección múltiples para diferentes escenarios
        this.DETECTION_OPTIONS = {
            // Para registros (alta precisión)
            REGISTER: new faceapi.SsdMobilenetv1Options({ 
                minConfidence: 0.8,
                maxResults: 1 
            }),
            
            // Para reconocimiento rápido (velocidad)
            RECOGNIZE: new faceapi.TinyFaceDetectorOptions({ 
                inputSize: 416,
                scoreThreshold: 0.7 
            }),
            
            // Para reconocimiento de alta precisión
            PRECISE: new faceapi.SsdMobilenetv1Options({ 
                minConfidence: 0.75,
                maxResults: 1 
            })
        };
        
        // Monkey patch para Canvas
        faceapi.env.monkeyPatch({ Canvas, Image, ImageData });
    }

    async initialize() {
        try {
            logger.info('🔄 Inicializando modelos de face-api.js...');
            
            const modelPath = path.resolve(config.MODELS_PATH);
            
            if (!fs.existsSync(modelPath)) {
                throw new Error(`Directorio de modelos no encontrado: ${modelPath}`);
            }

            // Cargar modelos de forma paralela para mayor velocidad
            const modelPromises = [
                this.loadModel('tinyFaceDetector', faceapi.nets.tinyFaceDetector, modelPath),
                this.loadModel('ssdMobilenetv1', faceapi.nets.ssdMobilenetv1, modelPath),
                this.loadModel('faceRecognitionNet', faceapi.nets.faceRecognitionNet, modelPath),
                this.loadModel('faceLandmark68Net', faceapi.nets.faceLandmark68Net, modelPath),
                this.loadModel('faceExpressionNet', faceapi.nets.faceExpressionNet, modelPath)
            ];

            await Promise.allSettled(modelPromises);
            
            this.modelsLoaded = true;
            logger.info(`✅ Modelos cargados exitosamente: ${this.loadedModels.join(', ')}`);
            
            // Validar que los modelos críticos estén cargados
            this.validateCriticalModels();
            
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

    getDetectionOptions(type = 'RECOGNIZE') {
        return this.DETECTION_OPTIONS[type] || this.DETECTION_OPTIONS.RECOGNIZE;
    }

    getLoadedModels() {
        return this.loadedModels;
    }

    isModelLoaded(modelName) {
        return this.loadedModels.includes(modelName);
    }

    async detectFace(image, options = 'RECOGNIZE') {
        if (!this.modelsLoaded) {
            throw new Error('Modelos no están cargados');
        }

        const detectionOptions = this.getDetectionOptions(options);
        
        try {
            const detection = await faceapi
                .detectSingleFace(image, detectionOptions)
                .withFaceLandmarks()
                .withFaceDescriptor();
                
            return detection;
        } catch (error) {
            logger.error('Error en detección facial:', error);
            throw new Error('Error al procesar imagen para detección facial');
        }
    }
}

module.exports = new FaceRecognitionConfig();
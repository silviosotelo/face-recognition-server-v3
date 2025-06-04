const faceRecognitionService = require('../services/face-recognition.service');
const imageProcessingService = require('../services/image-processing.service');
const User = require('../models/User');
const Recognition = require('../models/Recognition');
const logger = require('../utils/logger');
const { validateBase64Image, sanitizeInput } = require('../utils/validators');

class RecognitionController {
    async register(req, res, next) {
        const startTime = Date.now();
        
        try {
            const { ci, id_cliente, name, image } = req.body;
            
            // Validación de entrada
            if (!ci || !name || !image) {
                return res.status(400).json({
                    error: 'Campos requeridos: ci, name, image',
                    code: 'MISSING_FIELDS'
                });
            }

            // Sanitizar entradas
            const sanitizedData = {
                ci: sanitizeInput(ci),
                id_cliente: sanitizeInput(id_cliente || ''),
                name: sanitizeInput(name)
            };

            // Validar formato de imagen
            if (!validateBase64Image(image)) {
                return res.status(400).json({
                    error: 'Formato de imagen inválido',
                    code: 'INVALID_IMAGE_FORMAT'
                });
            }

            // Verificar si el usuario ya existe
            const existingUser = await User.findByCI(sanitizedData.ci);
            if (existingUser) {
                return res.status(409).json({
                    error: 'Ya existe una persona registrada con ese documento',
                    code: 'USER_EXISTS'
                });
            }

            // Procesar imagen
            const imageBuffer = Buffer.from(image, 'base64');
            
            // Analizar calidad de imagen
            const imageQuality = await imageProcessingService.analyzeImageQuality(imageBuffer);
            if (imageQuality.quality === 'poor') {
                return res.status(400).json({
                    error: 'Calidad de imagen insuficiente. Mejore la iluminación y nitidez.',
                    code: 'POOR_IMAGE_QUALITY',
                    quality: imageQuality
                });
            }

            // Registrar rostro
            const faceData = await faceRecognitionService.registerFace(imageBuffer, sanitizedData, {
                requireHighQuality: true
            });

            // Guardar usuario en base de datos
            const userData = {
                ...sanitizedData,
                descriptor: JSON.stringify(faceData.descriptor),
                confidence_score: faceData.confidenceScore
            };

            const newUser = await User.create(userData);

            // Registrar evento en logs
            await Recognition.logEvent({
                user_id: newUser.id,
                recognition_type: 'REGISTER',
                confidence_score: faceData.confidenceScore,
                processing_time_ms: Date.now() - startTime,
                success: true,
                ip_address: req.ip,
                user_agent: req.get('User-Agent')
            });

            logger.info(`✅ Usuario registrado exitosamente: ${sanitizedData.ci}`);

            res.status(201).json({
                success: true,
                message: 'Usuario registrado exitosamente',
                data: {
                    id: newUser.id,
                    ci: newUser.ci,
                    name: newUser.name,
                    confidence_score: faceData.confidenceScore,
                    processing_time_ms: Date.now() - startTime
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

            // Validación de entrada
            if (!image) {
                return res.status(400).json({
                    error: 'Campo requerido: image',
                    code: 'MISSING_IMAGE'
                });
            }

            // Validar formato de imagen
            if (!validateBase64Image(image)) {
                return res.status(400).json({
                    error: 'Formato de imagen inválido',
                    code: 'INVALID_IMAGE_FORMAT'
                });
            }

            // Obtener usuarios activos para comparación
            const users = await User.getActiveUsers();
            if (users.length === 0) {
                return res.status(404).json({
                    error: 'No hay usuarios registrados en el sistema',
                    code: 'NO_USERS_REGISTERED'
                });
            }

            // Procesar imagen
            const imageBuffer = Buffer.from(image, 'base64');

            // Reconocer rostro
            const recognition = await faceRecognitionService.recognizeFace(
                imageBuffer, 
                users,
                { enableCache: true }
            );

            const processingTime = Date.now() - startTime;

            if (recognition.match) {
                // Usuario reconocido
                await Recognition.logEvent({
                    user_id: recognition.match.id,
                    recognition_type: 'RECOGNIZE',
                    confidence_score: recognition.confidence,
                    processing_time_ms: processingTime,
                    success: true,
                    ip_address: req.ip,
                    user_agent: req.get('User-Agent')
                });

                logger.info(`✅ Usuario reconocido: ${recognition.match.ci} (confianza: ${recognition.confidence.toFixed(4)})`);

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
                        processing_time_ms: processingTime
                    }
                });
            } else {
                // Usuario no reconocido
                await Recognition.logEvent({
                    recognition_type: 'RECOGNIZE',
                    confidence_score: recognition.confidence || 0,
                    processing_time_ms: processingTime,
                    success: false,
                    error_message: 'Usuario no reconocido',
                    ip_address: req.ip,
                    user_agent: req.get('User-Agent')
                });

                logger.info(`❌ Usuario no reconocido (mejor confianza: ${recognition.confidence?.toFixed(4) || 'N/A'})`);

                res.status(404).json({
                    success: false,
                    message: 'Usuario no reconocido',
                    code: 'USER_NOT_RECOGNIZED',
                    data: {
                        confidence: recognition.confidence,
                        processing_time_ms: processingTime
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

            // Validación de entrada
            if (!ci || !image) {
                return res.status(400).json({
                    error: 'Campos requeridos: ci, image',
                    code: 'MISSING_FIELDS'
                });
            }

            // Verificar si el usuario existe
            const user = await User.findByCI(sanitizeInput(ci));
            if (!user) {
                return res.status(404).json({
                    error: 'Usuario no encontrado',
                    code: 'USER_NOT_FOUND'
                });
            }

            // Validar formato de imagen
            if (!validateBase64Image(image)) {
                return res.status(400).json({
                    error: 'Formato de imagen inválido',
                    code: 'INVALID_IMAGE_FORMAT'
                });
            }

            // Procesar imagen
            const imageBuffer = Buffer.from(image, 'base64');

            // Actualizar descriptor facial
            const faceData = await faceRecognitionService.registerFace(imageBuffer, user, {
                requireHighQuality: true
            });

            // Actualizar en base de datos
            await User.update(user.id, {
                descriptor: JSON.stringify(faceData.descriptor),
                confidence_score: faceData.confidenceScore,
                updated_at: new Date().toISOString()
            });

            // Registrar evento
            await Recognition.logEvent({
                user_id: user.id,
                recognition_type: 'UPDATE',
                confidence_score: faceData.confidenceScore,
                processing_time_ms: Date.now() - startTime,
                success: true,
                ip_address: req.ip,
                user_agent: req.get('User-Agent')
            });

            logger.info(`✅ Usuario actualizado exitosamente: ${ci}`);

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

    async getStats(req, res, next) {
        try {
            const faceStats = faceRecognitionService.getStats();
            const dbStats = await Recognition.getStats();
            
            res.json({
                success: true,
                data: {
                    face_recognition: faceStats,
                    database: dbStats,
                    cache: require('../services/cache.service').getStats(),
                    timestamp: new Date().toISOString()
                }
            });
            
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new RecognitionController();
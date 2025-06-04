const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');

// Rate limiting específico para reconocimiento
const recognitionLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 50, // máximo 30 reconocimientos por minuto por IP
    message: {
        error: 'Demasiados intentos de reconocimiento. Espere un momento.',
        code: 'RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiting para registro
const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // máximo 5 registros por 15 minutos por IP
    message: {
        error: 'Demasiados intentos de registro. Espere 15 minutos.',
        code: 'RATE_LIMIT_EXCEEDED'
    }
});

// Validaciones para registro
const validateRegister = [
    body('ci')
        .notEmpty()
        .withMessage('CI es requerido')
        .isLength({ min: 6, max: 20 })
        .withMessage('CI debe tener entre 6 y 20 caracteres')
        .matches(/^[a-zA-Z0-9\-\.]+$/)
        .withMessage('CI contiene caracteres inválidos'),
    
    body('name')
        /*.notEmpty()
        .withMessage('Nombre es requerido')
        .isLength({ min: 2, max: 100 })
        .withMessage('Nombre debe tener entre 2 y 100 caracteres')
        .matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/)
        .withMessage('Nombre contiene caracteres inválidos'),*/
        .optional()
        .isLength({ max: 50 })
        .withMessage('Nombre debe tener entre 2 y 100 caracteres'),
    
    body('id_cliente')
        .optional()
        .isLength({ max: 50 })
        .withMessage('ID cliente muy largo'),
    
    body('image')
        .notEmpty()
        .withMessage('Imagen es requerida')
        .isBase64()
        .withMessage('Imagen debe estar en formato base64')
        .custom((value) => {
            const sizeInBytes = Buffer.byteLength(value, 'base64');
            const maxSize = 10 * 1024 * 1024; // 10MB
            if (sizeInBytes > maxSize) {
                throw new Error('Imagen demasiado grande (máximo 10MB)');
            }
            return true;
        })
];

// Validaciones para reconocimiento
const validateRecognize = [
    body('image')
        .notEmpty()
        .withMessage('Imagen es requerida')
        .isBase64()
        .withMessage('Imagen debe estar en formato base64')
        .custom((value) => {
            const sizeInBytes = Buffer.byteLength(value, 'base64');
            const maxSize = 10 * 1024 * 1024; // 10MB
            if (sizeInBytes > maxSize) {
                throw new Error('Imagen demasiado grande (máximo 10MB)');
            }
            return true;
        })
];

// Middleware para manejar errores de validación
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
        const errorMessages = errors.array().map(error => ({
            field: error.param,
            message: error.msg,
            value: error.value
        }));

        logger.warn('Errores de validación:', errorMessages);

        return res.status(400).json({
            error: 'Errores de validación',
            code: 'VALIDATION_ERROR',
            details: errorMessages
        });
    }
    
    next();
};

module.exports = {
    recognitionLimiter,
    registerLimiter,
    validateRegister,
    validateRecognize,
    handleValidationErrors
};
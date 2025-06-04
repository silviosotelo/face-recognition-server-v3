const express = require('express');
const router = express.Router();
const recognitionController = require('../controllers/recognition.controller');
const { 
    recognitionLimiter, 
    registerLimiter,
    validateRegister,
    validateRecognize,
    handleValidationErrors 
} = require('../middleware/validation.middleware');

// Rutas de reconocimiento facial
router.post('/register', 
    registerLimiter,
    validateRegister,
    handleValidationErrors,
    recognitionController.register
);

router.post('/recognize', 
    recognitionLimiter,
    validateRecognize,
    handleValidationErrors,
    recognitionController.recognize
);

router.put('/update', 
    registerLimiter,
    validateRegister,
    handleValidationErrors,
    recognitionController.update
);

router.get('/stats', recognitionController.getStats);

module.exports = router;
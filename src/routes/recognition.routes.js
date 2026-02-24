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

// ── Rutas existentes (sin cambios en firma) ─────────────────────
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

// ── Nuevas rutas batch ────────────────────────────────────────────
// POST /api/recognition/batch - encolar reconocimiento batch (hasta 50 imágenes)
router.post('/batch', recognitionLimiter, recognitionController.batchRecognize);

// GET /api/recognition/batch - listar jobs batch recientes
router.get('/batch', recognitionController.listBatchJobs);

// GET /api/recognition/batch/:jobId - estado y resultados de un job
router.get('/batch/:jobId', recognitionController.getBatchJob);

// ── Gestión del índice HNSW ───────────────────────────────────────
// POST /api/recognition/index/rebuild - reconstruir índice HNSW desde DB
router.post('/index/rebuild', registerLimiter, recognitionController.rebuildHNSWIndex);

module.exports = router;

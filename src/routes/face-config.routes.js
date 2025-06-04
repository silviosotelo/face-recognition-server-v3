const express = require('express');
const router = express.Router();
const faceConfig = require('../config/face-recognition');
const logger = require('../utils/logger');

// Obtener configuración actual
router.get('/config', (req, res) => {
    try {
        const config = faceConfig.getCurrentConfiguration();
        
        res.json({
            success: true,
            data: config
        });
        
    } catch (error) {
        logger.error('Error obteniendo configuración:', error);
        res.status(500).json({
            error: 'Error obteniendo configuración',
            code: 'CONFIG_ERROR'
        });
    }
});

// Actualizar configuración en tiempo real
router.put('/config', (req, res) => {
    try {
        const newConfig = req.body;
        const success = faceConfig.updateConfiguration(newConfig);
        
        if (success) {
            res.json({
                success: true,
                message: 'Configuración actualizada exitosamente',
                data: faceConfig.getCurrentConfiguration()
            });
        } else {
            res.status(400).json({
                error: 'Error actualizando configuración',
                code: 'CONFIG_UPDATE_ERROR'
            });
        }
        
    } catch (error) {
        logger.error('Error actualizando configuración:', error);
        res.status(500).json({
            error: 'Error interno actualizando configuración'
        });
    }
});

// Obtener recomendaciones por escenario
router.get('/config/recommendations/:scenario', (req, res) => {
    try {
        const { scenario } = req.params;
        const recommendations = faceConfig.getRecommendedSettings(scenario);
        
        res.json({
            success: true,
            scenario,
            recommendations,
            description: {
                'high_security': 'Configuración para máxima seguridad (bancos, gobierno)',
                'balanced': 'Configuración balanceada para uso comercial general',
                'fast': 'Configuración optimizada para velocidad',
                'permissive': 'Configuración permisiva para máxima compatibilidad'
            }[scenario] || 'Escenario no reconocido'
        });
        
    } catch (error) {
        logger.error('Error obteniendo recomendaciones:', error);
        res.status(500).json({
            error: 'Error obteniendo recomendaciones'
        });
    }
});

module.exports = router;
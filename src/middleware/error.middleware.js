const logger = require('../utils/logger');

const errorHandler = (error, req, res, next) => {
    logger.error('Error no manejado:', {
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });

    // Errores conocidos
    if (error.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Error de validación',
            code: 'VALIDATION_ERROR',
            message: error.message
        });
    }

    if (error.name === 'UnauthorizedError') {
        return res.status(401).json({
            error: 'No autorizado',
            code: 'UNAUTHORIZED',
            message: 'Token inválido o expirado'
        });
    }

    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({
            error: 'El recurso ya existe',
            code: 'DUPLICATE_RESOURCE',
            message: 'Ya existe un registro con esos datos'
        });
    }

    // Error genérico del servidor
    const statusCode = error.statusCode || 500;
    const message = process.env.NODE_ENV === 'production' 
        ? 'Error interno del servidor'
        : error.message;

    res.status(statusCode).json({
        error: 'Error interno del servidor',
        code: 'INTERNAL_SERVER_ERROR',
        message: message,
        ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
    });
};

// Middleware para rutas no encontradas
const notFoundHandler = (req, res) => {
    res.status(404).json({
        error: 'Ruta no encontrada',
        code: 'NOT_FOUND',
        message: `La ruta ${req.method} ${req.originalUrl} no existe`
    });
};

module.exports = {
    errorHandler,
    notFoundHandler
};
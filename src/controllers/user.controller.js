const User = require('../models/User');
const logger = require('../utils/logger');
const { sanitizeInput } = require('../utils/validators');

class UserController {
    async getAll(req, res, next) {
        try {
            const { page = 1, limit = 50, active_only = true } = req.query;
            
            const options = {
                page: parseInt(page),
                limit: Math.min(parseInt(limit), 100), // Máximo 100 por página
                activeOnly: active_only === 'true'
            };

            const users = await User.getAll(options);
            const total = await User.count(options);

            res.json({
                success: true,
                data: {
                    users,
                    pagination: {
                        page: options.page,
                        limit: options.limit,
                        total,
                        totalPages: Math.ceil(total / options.limit)
                    }
                }
            });

        } catch (error) {
            next(error);
        }
    }

    async getById(req, res, next) {
        try {
            const { id } = req.params;
            
            if (!id || isNaN(id)) {
                return res.status(400).json({
                    error: 'ID de usuario inválido',
                    code: 'INVALID_USER_ID'
                });
            }

            const user = await User.findById(parseInt(id));
            
            if (!user) {
                return res.status(404).json({
                    error: 'Usuario no encontrado',
                    code: 'USER_NOT_FOUND'
                });
            }

            // No incluir descriptor en la respuesta por seguridad
            const { descriptor, ...userResponse } = user;

            res.json({
                success: true,
                data: userResponse
            });

        } catch (error) {
            next(error);
        }
    }

    async getByCI(req, res, next) {
        try {
            const { ci } = req.params;
            
            if (!ci) {
                return res.status(400).json({
                    error: 'CI requerido',
                    code: 'MISSING_CI'
                });
            }

            const user = await User.findByCI(sanitizeInput(ci));
            
            if (!user) {
                return res.status(404).json({
                    error: 'Usuario no encontrado',
                    code: 'USER_NOT_FOUND'
                });
            }

            // No incluir descriptor en la respuesta por seguridad
            const { descriptor, ...userResponse } = user;

            res.json({
                success: true,
                data: userResponse
            });

        } catch (error) {
            next(error);
        }
    }

    async delete(req, res, next) {
        try {
            const { id } = req.params;
            
            if (!id || isNaN(id)) {
                return res.status(400).json({
                    error: 'ID de usuario inválido',
                    code: 'INVALID_USER_ID'
                });
            }

            const user = await User.findById(parseInt(id));
            
            if (!user) {
                return res.status(404).json({
                    error: 'Usuario no encontrado',
                    code: 'USER_NOT_FOUND'
                });
            }

            // Soft delete - marcar como inactivo
            await User.update(user.id, { 
                is_active: false,
                updated_at: new Date().toISOString()
            });

            logger.info(`Usuario eliminado (soft delete): ${user.ci}`);

            res.json({
                success: true,
                message: 'Usuario eliminado exitosamente'
            });

        } catch (error) {
            next(error);
        }
    }

    async activate(req, res, next) {
        try {
            const { id } = req.params;
            
            if (!id || isNaN(id)) {
                return res.status(400).json({
                    error: 'ID de usuario inválido',
                    code: 'INVALID_USER_ID'
                });
            }

            const user = await User.findById(parseInt(id));
            
            if (!user) {
                return res.status(404).json({
                    error: 'Usuario no encontrado',
                    code: 'USER_NOT_FOUND'
                });
            }

            await User.update(user.id, { 
                is_active: true,
                updated_at: new Date().toISOString()
            });

            logger.info(`Usuario activado: ${user.ci}`);

            res.json({
                success: true,
                message: 'Usuario activado exitosamente'
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new UserController();
const db = require('../config/database');
const logger = require('../utils/logger');

class User {
    static async create(userData) {
        try {
            await db.initialize();
            
            const result = await db.run(
                `INSERT INTO users (id_cliente, name, ci, descriptor, confidence_score, created_at, updated_at) 
                 VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [userData.id_cliente, userData.name, userData.ci, userData.descriptor, userData.confidence_score]
            );

            return { id: result.id, ...userData };
            
        } catch (error) {
            logger.error('Error al crear usuario:', error);
            throw error;
        }
    }

    static async findById(id) {
        try {
            await db.initialize();
            
            const users = await db.query(
                'SELECT * FROM users WHERE id = ? AND is_active = 1',
                [id]
            );

            return users[0] || null;
            
        } catch (error) {
            logger.error('Error al buscar usuario por ID:', error);
            throw error;
        }
    }

    static async findByCI(ci) {
        try {
            await db.initialize();
            
            const users = await db.query(
                'SELECT * FROM users WHERE ci = ? AND is_active = 1',
                [ci]
            );

            return users[0] || null;
            
        } catch (error) {
            logger.error('Error al buscar usuario por CI:', error);
            throw error;
        }
    }

    static async getAll(options = {}) {
        try {
            await db.initialize();
            
            const { page = 1, limit = 50, activeOnly = true } = options;
            const offset = (page - 1) * limit;
            
            let query = 'SELECT id, id_cliente, name, ci, confidence_score, created_at, updated_at, is_active FROM users';
            const params = [];
            
            if (activeOnly) {
                query += ' WHERE is_active = 1';
            }
            
            query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            const users = await db.query(query, params);
            return users;
            
        } catch (error) {
            logger.error('Error al obtener usuarios:', error);
            throw error;
        }
    }

    static async getActiveUsers() {
        try {
            await db.initialize();
            
            const users = await db.query(
                'SELECT id, id_cliente, name, ci, descriptor, confidence_score FROM users WHERE is_active = 1',
                []
            );

            return users;
            
        } catch (error) {
            logger.error('Error al obtener usuarios activos:', error);
            throw error;
        }
    }

    static async update(id, updateData) {
        try {
            await db.initialize();
            
            const fields = Object.keys(updateData);
            const values = Object.values(updateData);
            
            const setClause = fields.map(field => `${field} = ?`).join(', ');
            
            await db.run(
                `UPDATE users SET ${setClause} WHERE id = ?`,
                [...values, id]
            );

            return true;
            
        } catch (error) {
            logger.error('Error al actualizar usuario:', error);
            throw error;
        }
    }

    static async count(options = {}) {
        try {
            await db.initialize();
            
            const { activeOnly = true } = options;
            
            let query = 'SELECT COUNT(*) as count FROM users';
            
            if (activeOnly) {
                query += ' WHERE is_active = 1';
            }

            const result = await db.query(query, []);
            return result[0].count;
            
        } catch (error) {
            logger.error('Error al contar usuarios:', error);
            throw error;
        }
    }

    static async deleteById(id) {
        try {
            await db.initialize();
            
            await db.run('DELETE FROM users WHERE id = ?', [id]);
            return true;
            
        } catch (error) {
            logger.error('Error al eliminar usuario:', error);
            throw error;
        }
    }
}

module.exports = User;
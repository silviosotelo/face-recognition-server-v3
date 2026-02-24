/**
 * User Model — PostgreSQL
 *
 * Cambios respecto a la versión SQLite:
 * - Placeholders: ? → $1, $2, $3 ...
 * - INSERT retorna RETURNING id (sin necesidad de lastID)
 * - is_active comparado con TRUE (boolean nativo PG)
 * - LIMIT/OFFSET con $n numerados correctamente
 * - update() dinámico con numeración correcta de $n
 * - count() retorna parseInt() ya que PG devuelve BIGINT como string
 */

const db = require('../config/database');
const logger = require('../utils/logger');

class User {
    static async create(userData) {
        try {
            await db.initialize();

            const result = await db.run(
                `INSERT INTO users
                    (id_cliente, name, ci, descriptor, confidence_score, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                 RETURNING id`,
                [
                    userData.id_cliente,
                    userData.name,
                    userData.ci,
                    userData.descriptor,
                    userData.confidence_score
                ]
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
                'SELECT * FROM users WHERE id = $1 AND is_active = TRUE',
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
                'SELECT * FROM users WHERE ci = $1 AND is_active = TRUE',
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

            const { page = 1, limit = 50, activeOnly = true, active_only } = options;
            // Soportar tanto activeOnly como active_only (snake_case del controller)
            const filterActive = activeOnly || active_only;
            const offset = (page - 1) * limit;

            let query = `SELECT id, id_cliente, name, ci, confidence_score,
                                created_at, updated_at, is_active
                         FROM users`;
            const params = [];

            if (filterActive) {
                query += ' WHERE is_active = TRUE';
            }

            // $1, $2 si no hay WHERE, $1, $2 si sí (params está vacío o tiene 0 elementos)
            const limitN  = params.length + 1;
            const offsetN = params.length + 2;
            query += ` ORDER BY created_at DESC LIMIT $${limitN} OFFSET $${offsetN}`;
            params.push(limit, offset);

            return await db.query(query, params);

        } catch (error) {
            logger.error('Error al obtener usuarios:', error);
            throw error;
        }
    }

    /**
     * Obtiene todos los usuarios activos con su descriptor.
     * Usada para cargar descriptores en memoria / reconstruir índice HNSW.
     */
    static async getActiveUsers() {
        try {
            await db.initialize();

            return await db.query(
                `SELECT id, id_cliente, name, ci, descriptor, confidence_score
                 FROM users
                 WHERE is_active = TRUE
                 ORDER BY id`,
                []
            );

        } catch (error) {
            logger.error('Error al obtener usuarios activos:', error);
            throw error;
        }
    }

    /**
     * Actualización dinámica: los campos vienen del controller (no del usuario final).
     * Genera $1, $2, ... $n para SET y $n+1 para el WHERE id.
     */
    static async update(id, updateData) {
        try {
            await db.initialize();

            const fields = Object.keys(updateData);
            const values = Object.values(updateData);

            if (fields.length === 0) return true;

            const setClause = fields
                .map((field, i) => `${field} = $${i + 1}`)
                .join(', ');

            await db.run(
                `UPDATE users SET ${setClause} WHERE id = $${fields.length + 1}`,
                [...values, id]
            );

            return true;

        } catch (error) {
            logger.error('Error al actualizar usuario:', error);
            throw error;
        }
    }

    /**
     * COUNT(*) en PG devuelve BIGINT → string en node-pg → parseInt() necesario.
     */
    static async count(options = {}) {
        try {
            await db.initialize();

            const { activeOnly = true, active_only } = options;
            const filterActive = activeOnly || active_only;

            let query = 'SELECT COUNT(*) AS count FROM users';
            if (filterActive) {
                query += ' WHERE is_active = TRUE';
            }

            const result = await db.query(query, []);
            return parseInt(result[0].count, 10);

        } catch (error) {
            logger.error('Error al contar usuarios:', error);
            throw error;
        }
    }

    /** Soft-delete: marca el usuario como inactivo. */
    static async softDelete(id) {
        try {
            await db.initialize();

            await db.run(
                `UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
                [id]
            );

            return true;

        } catch (error) {
            logger.error('Error al desactivar usuario:', error);
            throw error;
        }
    }

    /** Hard-delete: elimina físicamente el registro. */
    static async deleteById(id) {
        try {
            await db.initialize();

            await db.run('DELETE FROM users WHERE id = $1', [id]);
            return true;

        } catch (error) {
            logger.error('Error al eliminar usuario:', error);
            throw error;
        }
    }
}

module.exports = User;

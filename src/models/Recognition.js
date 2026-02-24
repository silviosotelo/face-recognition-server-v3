/**
 * Recognition Model — PostgreSQL
 *
 * Cambios respecto a la versión SQLite:
 * - Placeholders ? → $1, $2, ...
 * - BOOLEAN nativo: !!success en lugar de success ? 1 : 0
 * - Fecha: NOW() - $1 * INTERVAL '1 day'  (parametrizado, sin interpolación)
 * - COUNT(*) FILTER (WHERE success = TRUE) en lugar de SUM(CASE WHEN ...)
 * - LIMIT $1 en getRecentLogs
 * - parseInt() sobre resultados COUNT (PG retorna BIGINT como string)
 */

const db = require('../config/database');
const logger = require('../utils/logger');

class Recognition {
    /**
     * Registra un evento de reconocimiento/registro.
     * Los errores se logean pero NO se propagan para no interrumpir el flujo principal.
     */
    static async logEvent(eventData) {
        try {
            await db.initialize();

            await db.run(
                `INSERT INTO recognition_logs
                    (user_id, recognition_type, confidence_score, processing_time_ms,
                     success, error_message, ip_address, user_agent, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
                [
                    eventData.user_id        || null,
                    eventData.recognition_type,
                    eventData.confidence_score != null ? eventData.confidence_score : null,
                    eventData.processing_time_ms,
                    !!eventData.success,                   // boolean nativo PostgreSQL
                    eventData.error_message  || null,
                    eventData.ip_address     || null,
                    eventData.user_agent     || null
                ]
            );

        } catch (error) {
            logger.error('Error al registrar evento de reconocimiento:', error.message);
            // Silencioso: el fallo de log no debe romper el reconocimiento
        }
    }

    /**
     * Estadísticas agregadas por tipo de operación para los últimos `days` días.
     *
     * Optimizaciones PostgreSQL:
     * - Parámetro `days` vinculado con $1 (evita inyección, plan cacheado)
     * - COUNT(*) FILTER más eficiente que SUM(CASE WHEN ...)
     * - Índice idx_logs_type_created cubre esta query (no seq scan)
     */
    static async getStats(days = 30) {
        try {
            await db.initialize();

            const stats = await db.query(
                `SELECT
                    recognition_type,
                    COUNT(*)                                        AS total_attempts,
                    COUNT(*) FILTER (WHERE success = TRUE)         AS successful_attempts,
                    ROUND(AVG(processing_time_ms)::NUMERIC, 2)    AS avg_processing_time,
                    ROUND(AVG(confidence_score)::NUMERIC, 4)       AS avg_confidence
                 FROM recognition_logs
                 WHERE created_at >= NOW() - ($1 * INTERVAL '1 day')
                 GROUP BY recognition_type
                 ORDER BY recognition_type`,
                [days]
            );

            const totalStats = await db.query(
                `SELECT
                    COUNT(*)                           AS total_logs,
                    COUNT(DISTINCT user_id)            AS unique_users,
                    ROUND(AVG(processing_time_ms)::NUMERIC, 2) AS overall_avg_time,
                    COUNT(*) FILTER (WHERE success = TRUE)     AS total_successful,
                    COUNT(*) FILTER (WHERE success = FALSE)    AS total_failed
                 FROM recognition_logs
                 WHERE created_at >= NOW() - ($1 * INTERVAL '1 day')`,
                [days]
            );

            // PG retorna BIGINT como string → convertir a número
            const overall = totalStats[0] || {};
            return {
                period_days: days,
                by_type: stats.map(row => ({
                    ...row,
                    total_attempts:       parseInt(row.total_attempts, 10),
                    successful_attempts:  parseInt(row.successful_attempts, 10),
                    avg_processing_time:  parseFloat(row.avg_processing_time),
                    avg_confidence:       parseFloat(row.avg_confidence)
                })),
                overall: {
                    total_logs:       parseInt(overall.total_logs, 10),
                    unique_users:     parseInt(overall.unique_users, 10),
                    overall_avg_time: parseFloat(overall.overall_avg_time),
                    total_successful: parseInt(overall.total_successful, 10),
                    total_failed:     parseInt(overall.total_failed, 10)
                }
            };

        } catch (error) {
            logger.error('Error al obtener estadísticas:', error);
            throw error;
        }
    }

    /**
     * Logs de reconocimiento más recientes con JOIN a usuarios.
     */
    static async getRecentLogs(limit = 100) {
        try {
            await db.initialize();

            const logs = await db.query(
                `SELECT
                    rl.id,
                    rl.user_id,
                    rl.recognition_type,
                    rl.confidence_score,
                    rl.processing_time_ms,
                    rl.success,
                    rl.error_message,
                    rl.ip_address,
                    rl.created_at,
                    u.name AS user_name,
                    u.ci   AS user_ci
                 FROM recognition_logs rl
                 LEFT JOIN users u ON rl.user_id = u.id
                 ORDER BY rl.created_at DESC
                 LIMIT $1`,
                [limit]
            );

            return logs;

        } catch (error) {
            logger.error('Error al obtener logs recientes:', error);
            throw error;
        }
    }

    /**
     * Limpia logs más antiguos que `days` días.
     * Útil para mantenimiento / reducir tamaño de tabla.
     */
    static async purgeOldLogs(days = 90) {
        try {
            await db.initialize();

            const result = await db.run(
                `DELETE FROM recognition_logs
                 WHERE created_at < NOW() - ($1 * INTERVAL '1 day')`,
                [days]
            );

            logger.info(`🧹 ${result.changes} logs eliminados (> ${days} días)`);
            return result.changes;

        } catch (error) {
            logger.error('Error al purgar logs:', error);
            throw error;
        }
    }
}

module.exports = Recognition;

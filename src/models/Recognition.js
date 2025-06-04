const db = require('../config/database');
const logger = require('../utils/logger');

class Recognition {
    static async logEvent(eventData) {
        try {
            await db.initialize();
            
            await db.run(
                `INSERT INTO recognition_logs 
                (user_id, recognition_type, confidence_score, processing_time_ms, success, error_message, ip_address, user_agent, created_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [
                    eventData.user_id || null,
                    eventData.recognition_type,
                    eventData.confidence_score || null,
                    eventData.processing_time_ms,
                    eventData.success ? 1 : 0,
                    eventData.error_message || null,
                    eventData.ip_address || null,
                    eventData.user_agent || null
                ]
            );

        } catch (error) {
            logger.error('Error al registrar evento de reconocimiento:', error);
            // No lanzar error para no interrumpir el flujo principal
        }
    }

    static async getStats(days = 30) {
        try {
            await db.initialize();
            
            const stats = await db.query(`
                SELECT 
                    recognition_type,
                    COUNT(*) as total_attempts,
                    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_attempts,
                    AVG(processing_time_ms) as avg_processing_time,
                    AVG(confidence_score) as avg_confidence
                FROM recognition_logs 
                WHERE created_at >= datetime('now', '-${days} days')
                GROUP BY recognition_type
            `);

            const totalStats = await db.query(`
                SELECT 
                    COUNT(*) as total_logs,
                    COUNT(DISTINCT user_id) as unique_users,
                    AVG(processing_time_ms) as overall_avg_time
                FROM recognition_logs 
                WHERE created_at >= datetime('now', '-${days} days')
            `);

            return {
                period_days: days,
                by_type: stats,
                overall: totalStats[0] || {}
            };
            
        } catch (error) {
            logger.error('Error al obtener estadísticas:', error);
            throw error;
        }
    }

    static async getRecentLogs(limit = 100) {
        try {
            await db.initialize();
            
            const logs = await db.query(`
                SELECT 
                    rl.*,
                    u.name as user_name,
                    u.ci as user_ci
                FROM recognition_logs rl
                LEFT JOIN users u ON rl.user_id = u.id
                ORDER BY rl.created_at DESC
                LIMIT ?
            `, [limit]);

            return logs;
            
        } catch (error) {
            logger.error('Error al obtener logs recientes:', error);
            throw error;
        }
    }
}

module.exports = Recognition;
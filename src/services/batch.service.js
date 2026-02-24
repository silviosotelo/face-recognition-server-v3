/**
 * Servicio de Procesamiento Batch
 * Procesa múltiples imágenes en paralelo con control de concurrencia
 * Soporta reconocimiento masivo con seguimiento de progreso
 */

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const metricsService = require('./metrics.service');

// Máximo de imágenes por lote
const MAX_BATCH_SIZE = parseInt(process.env.BATCH_MAX_SIZE) || 50;
// Concurrencia máxima (imágenes procesadas en paralelo)
const MAX_CONCURRENCY = parseInt(process.env.BATCH_CONCURRENCY) || 4;
// Tiempo máximo de un job en memoria (ms) antes de limpieza
const JOB_TTL_MS = parseInt(process.env.BATCH_JOB_TTL_MS) || 3_600_000; // 1 hora

class BatchService {
    constructor() {
        // Almacén en memoria de jobs activos y completados
        this.jobs = new Map();
        // Limpieza periódica de jobs expirados
        this._startCleanupInterval();
        logger.info('✅ Batch Service inicializado');
    }

    /**
     * Crea y encola un nuevo job de reconocimiento batch
     *
     * @param {Array<{id: string, image: string}>} images - Array de imágenes base64 con IDs
     * @param {Object} options - Opciones de procesamiento
     * @returns {Object} - Job creado con ID y estado inicial
     */
    async createRecognitionJob(images, options = {}) {
        if (!Array.isArray(images) || images.length === 0) {
            throw new Error('Se requiere un array de imágenes no vacío');
        }

        if (images.length > MAX_BATCH_SIZE) {
            throw new Error(`Máximo ${MAX_BATCH_SIZE} imágenes por lote. Recibidas: ${images.length}`);
        }

        const jobId = uuidv4();
        const job = {
            id: jobId,
            status: 'pending',         // pending | processing | completed | failed
            totalImages: images.length,
            processedImages: 0,
            results: [],
            errors: [],
            createdAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null,
            options
        };

        this.jobs.set(jobId, job);

        // Procesar en background sin bloquear la respuesta HTTP
        this._processJobAsync(jobId, images, options);

        logger.info(`📦 Batch job creado: ${jobId} (${images.length} imágenes)`);

        return {
            jobId,
            status: job.status,
            totalImages: job.totalImages,
            message: 'Job encolado para procesamiento'
        };
    }

    /**
     * Obtiene el estado y resultados de un job batch
     */
    getJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) return null;

        return {
            id: job.id,
            status: job.status,
            totalImages: job.totalImages,
            processedImages: job.processedImages,
            progress: Math.round((job.processedImages / job.totalImages) * 100),
            results: job.results,
            errors: job.errors,
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            processingTimeMs: job.completedAt ?
                new Date(job.completedAt) - new Date(job.startedAt) : null
        };
    }

    /**
     * Procesa el job de forma asincrónica con control de concurrencia
     */
    async _processJobAsync(jobId, images, options) {
        const job = this.jobs.get(jobId);
        if (!job) return;

        job.status = 'processing';
        job.startedAt = new Date().toISOString();

        logger.info(`⚙️ Procesando batch job ${jobId}: ${images.length} imágenes`);

        try {
            // Importar servicio de reconocimiento aquí para evitar ciclo circular
            const faceRecognitionService = require('./face-recognition.service');
            const User = require('../models/User');

            // Cargar usuarios activos una sola vez para todo el lote
            const activeUsers = await User.getActiveUsers();

            // Procesar imágenes con concurrencia controlada
            await this._processWithConcurrency(
                images,
                async (imageItem) => {
                    const itemId = imageItem.id || `item_${images.indexOf(imageItem)}`;
                    const startTime = Date.now();

                    try {
                        const imageBuffer = Buffer.from(imageItem.image, 'base64');

                        const recognition = await faceRecognitionService.recognizeFace(
                            imageBuffer,
                            activeUsers,
                            { enableCache: true, ...options }
                        );

                        const result = {
                            id: itemId,
                            success: true,
                            match: recognition.match ? {
                                userId: recognition.match.id,
                                ci: recognition.match.ci,
                                name: recognition.match.name,
                                id_cliente: recognition.match.id_cliente,
                                confidence: recognition.confidence,
                                similarity: recognition.match.similarity
                            } : null,
                            processingTimeMs: Date.now() - startTime
                        };

                        job.results.push(result);
                        metricsService.recordBatchImages(1, 'success');

                    } catch (error) {
                        job.errors.push({
                            id: itemId,
                            error: error.message,
                            processingTimeMs: Date.now() - startTime
                        });
                        metricsService.recordBatchImages(1, 'error');
                    }

                    job.processedImages++;
                },
                MAX_CONCURRENCY
            );

            job.status = 'completed';
            job.completedAt = new Date().toISOString();

            const processingTime = new Date(job.completedAt) - new Date(job.startedAt);
            metricsService.recordBatchJob('success');
            logger.info(`✅ Batch job ${jobId} completado en ${processingTime}ms. ` +
                `Éxitos: ${job.results.length}, Errores: ${job.errors.length}`);

        } catch (error) {
            job.status = 'failed';
            job.completedAt = new Date().toISOString();
            job.globalError = error.message;
            metricsService.recordBatchJob('error');
            logger.error(`❌ Batch job ${jobId} fallido:`, error);
        }
    }

    /**
     * Procesa un array de items con concurrencia limitada
     * Evita saturar GPU/CPU procesando demasiadas imágenes al mismo tiempo
     */
    async _processWithConcurrency(items, processor, concurrency) {
        const results = [];
        let index = 0;

        const workers = Array(Math.min(concurrency, items.length)).fill(null).map(async () => {
            while (index < items.length) {
                const currentIndex = index++;
                if (currentIndex < items.length) {
                    await processor(items[currentIndex]);
                }
            }
        });

        await Promise.all(workers);
        return results;
    }

    /**
     * Lista todos los jobs con su estado (últimos N)
     */
    listJobs(limit = 20) {
        const jobs = Array.from(this.jobs.values())
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, limit)
            .map(job => ({
                id: job.id,
                status: job.status,
                totalImages: job.totalImages,
                processedImages: job.processedImages,
                progress: Math.round((job.processedImages / job.totalImages) * 100),
                createdAt: job.createdAt,
                completedAt: job.completedAt
            }));

        return jobs;
    }

    /**
     * Limpia jobs expirados periódicamente
     */
    _startCleanupInterval() {
        setInterval(() => {
            const now = Date.now();
            let cleaned = 0;

            for (const [jobId, job] of this.jobs.entries()) {
                const age = now - new Date(job.createdAt).getTime();
                if (age > JOB_TTL_MS && (job.status === 'completed' || job.status === 'failed')) {
                    this.jobs.delete(jobId);
                    cleaned++;
                }
            }

            if (cleaned > 0) {
                logger.debug(`🧹 Batch service: ${cleaned} jobs expirados eliminados`);
            }
        }, 15 * 60 * 1000); // Cada 15 minutos
    }

    getStats() {
        const jobArray = Array.from(this.jobs.values());
        return {
            totalJobs: jobArray.length,
            pendingJobs: jobArray.filter(j => j.status === 'pending').length,
            processingJobs: jobArray.filter(j => j.status === 'processing').length,
            completedJobs: jobArray.filter(j => j.status === 'completed').length,
            failedJobs: jobArray.filter(j => j.status === 'failed').length,
            maxBatchSize: MAX_BATCH_SIZE,
            maxConcurrency: MAX_CONCURRENCY
        };
    }
}

module.exports = new BatchService();

/**
 * Servicio de Métricas Prometheus
 * Expone métricas de performance para monitoreo con Grafana/Prometheus
 *
 * Métricas disponibles en GET /metrics:
 * - Latencia de reconocimiento (histograma)
 * - Tasa de éxito/error
 * - Cache hit rate
 * - GPU memoria utilizada
 * - Tamaño del índice HNSW
 * - Usuarios activos
 */

const promClient = require('prom-client');
const logger = require('../utils/logger');

class MetricsService {
    constructor() {
        // Registrador global de Prometheus
        this.register = new promClient.Registry();

        // Colectar métricas por defecto de Node.js (RAM, CPU, GC, event loop)
        promClient.collectDefaultMetrics({
            register: this.register,
            prefix: 'facerecog_',
            gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5]
        });

        this._defineMetrics();
        logger.info('✅ Métricas Prometheus inicializadas');
    }

    _defineMetrics() {
        // ── Reconocimiento ──────────────────────────────────────────
        this.recognitionDuration = new promClient.Histogram({
            name: 'facerecog_recognition_duration_seconds',
            help: 'Latencia del proceso de reconocimiento facial',
            labelNames: ['status', 'mode'],
            buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5],
            registers: [this.register]
        });

        this.recognitionTotal = new promClient.Counter({
            name: 'facerecog_recognition_total',
            help: 'Total de reconocimientos realizados',
            labelNames: ['status', 'mode'],
            registers: [this.register]
        });

        this.registrationDuration = new promClient.Histogram({
            name: 'facerecog_registration_duration_seconds',
            help: 'Latencia del proceso de registro facial',
            labelNames: ['status'],
            buckets: [0.1, 0.3, 0.5, 1, 2, 5],
            registers: [this.register]
        });

        this.registrationTotal = new promClient.Counter({
            name: 'facerecog_registration_total',
            help: 'Total de registros realizados',
            labelNames: ['status'],
            registers: [this.register]
        });

        // ── Cache ────────────────────────────────────────────────────
        this.cacheHits = new promClient.Counter({
            name: 'facerecog_cache_hits_total',
            help: 'Total de aciertos en caché',
            registers: [this.register]
        });

        this.cacheMisses = new promClient.Counter({
            name: 'facerecog_cache_misses_total',
            help: 'Total de fallos en caché',
            registers: [this.register]
        });

        // ── HNSW Index ───────────────────────────────────────────────
        this.hnswIndexSize = new promClient.Gauge({
            name: 'facerecog_hnsw_index_size',
            help: 'Número de vectores en el índice HNSW',
            registers: [this.register]
        });

        this.hnswSearchDuration = new promClient.Histogram({
            name: 'facerecog_hnsw_search_duration_seconds',
            help: 'Latencia de búsqueda en el índice HNSW',
            buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
            registers: [this.register]
        });

        // ── GPU ──────────────────────────────────────────────────────
        this.gpuMemoryUsed = new promClient.Gauge({
            name: 'facerecog_gpu_memory_used_bytes',
            help: 'Memoria GPU utilizada por TensorFlow (bytes)',
            registers: [this.register]
        });

        this.gpuMemoryTotal = new promClient.Gauge({
            name: 'facerecog_gpu_memory_total_bytes',
            help: 'Memoria GPU total disponible (bytes)',
            registers: [this.register]
        });

        this.tensorflowBackend = new promClient.Gauge({
            name: 'facerecog_tensorflow_gpu_active',
            help: '1 si TensorFlow usa GPU, 0 si usa CPU',
            registers: [this.register]
        });

        // ── Base de Datos ────────────────────────────────────────────
        this.activeUsers = new promClient.Gauge({
            name: 'facerecog_active_users',
            help: 'Número de usuarios activos registrados',
            registers: [this.register]
        });

        this.dbQueryDuration = new promClient.Histogram({
            name: 'facerecog_db_query_duration_seconds',
            help: 'Latencia de consultas a la base de datos',
            labelNames: ['operation'],
            buckets: [0.001, 0.01, 0.05, 0.1, 0.5],
            registers: [this.register]
        });

        // ── Batch Processing ─────────────────────────────────────────
        this.batchJobsTotal = new promClient.Counter({
            name: 'facerecog_batch_jobs_total',
            help: 'Total de trabajos batch procesados',
            labelNames: ['status'],
            registers: [this.register]
        });

        this.batchImagesProcessed = new promClient.Counter({
            name: 'facerecog_batch_images_total',
            help: 'Total de imágenes procesadas en lotes batch',
            labelNames: ['status'],
            registers: [this.register]
        });

        // ── HTTP ─────────────────────────────────────────────────────
        this.httpRequestDuration = new promClient.Histogram({
            name: 'facerecog_http_request_duration_seconds',
            help: 'Latencia de peticiones HTTP',
            labelNames: ['method', 'route', 'status_code'],
            buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
            registers: [this.register]
        });

        this.httpRequestsTotal = new promClient.Counter({
            name: 'facerecog_http_requests_total',
            help: 'Total de peticiones HTTP recibidas',
            labelNames: ['method', 'route', 'status_code'],
            registers: [this.register]
        });
    }

    // ── Métodos de registro ─────────────────────────────────────────

    recordRecognition(durationMs, status = 'success', mode = 'recognize') {
        this.recognitionDuration.labels(status, mode).observe(durationMs / 1000);
        this.recognitionTotal.labels(status, mode).inc();
    }

    recordRegistration(durationMs, status = 'success') {
        this.registrationDuration.labels(status).observe(durationMs / 1000);
        this.registrationTotal.labels(status).inc();
    }

    recordCacheHit() {
        this.cacheHits.inc();
    }

    recordCacheMiss() {
        this.cacheMisses.inc();
    }

    recordHnswSearch(durationMs) {
        this.hnswSearchDuration.observe(durationMs / 1000);
    }

    updateHnswIndexSize(size) {
        this.hnswIndexSize.set(size);
    }

    updateActiveUsers(count) {
        this.activeUsers.set(count);
    }

    recordDbQuery(operation, durationMs) {
        this.dbQueryDuration.labels(operation).observe(durationMs / 1000);
    }

    recordBatchJob(status = 'success') {
        this.batchJobsTotal.labels(status).inc();
    }

    recordBatchImages(count, status = 'success') {
        this.batchImagesProcessed.labels(status).inc(count);
    }

    recordHttpRequest(method, route, statusCode, durationMs) {
        this.httpRequestDuration.labels(method, route, statusCode).observe(durationMs / 1000);
        this.httpRequestsTotal.labels(method, route, statusCode).inc();
    }

    /**
     * Actualiza métricas de GPU desde TensorFlow
     * Llama periódicamente para mantener métricas actualizadas
     */
    async updateGpuMetrics() {
        try {
            // Reutilizar la instancia de TF ya cargada por face-recognition config
            // (evita un require() separado que causaría conflicto de backends)
            const tf = require('../config/face-recognition').tf;
            if (!tf) {
                this.tensorflowBackend.set(0);
                return;
            }
            const backend = tf.getBackend();
            const isGpu = backend === 'tensorflow' || backend === 'cuda';
            this.tensorflowBackend.set(isGpu ? 1 : 0);

            if (isGpu && tf.engine) {
                const memInfo = tf.memory();
                this.gpuMemoryUsed.set(memInfo.numBytesInGPU || 0);
            }
        } catch (e) {
            this.tensorflowBackend.set(0);
        }
    }

    /**
     * Middleware Express para métricas HTTP automáticas
     */
    httpMiddleware() {
        return (req, res, next) => {
            const startTime = Date.now();

            res.on('finish', () => {
                const duration = Date.now() - startTime;
                // Normalizar rutas para evitar cardinalidad alta
                const route = this._normalizeRoute(req.path);
                this.recordHttpRequest(req.method, route, res.statusCode, duration);
            });

            next();
        };
    }

    _normalizeRoute(path) {
        // Reemplazar IDs numéricos y CIs en paths
        return path
            .replace(/\/\d+/g, '/:id')
            .replace(/\/[A-Z0-9]{6,20}/g, '/:ci')
            .replace(/\/[a-f0-9-]{36}/g, '/:uuid');
    }

    /**
     * Retorna el contenido de métricas en formato Prometheus
     */
    async getMetrics() {
        await this.updateGpuMetrics();
        return this.register.metrics();
    }

    /**
     * Content-Type requerido por Prometheus
     */
    get contentType() {
        return this.register.contentType;
    }
}

module.exports = new MetricsService();

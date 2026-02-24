/**
 * PM2 Ecosystem Config - Face Recognition Server v4.0
 *
 * Modo cluster: utiliza todos los cores del CPU disponibles.
 * El índice HNSW se carga desde disco por cada worker (compartido en RAM via OS).
 * Redis centraliza la caché entre todos los workers.
 *
 * Uso:
 *   pm2 start ecosystem.config.js         # Iniciar en cluster
 *   pm2 reload face-recognition           # Reload sin downtime
 *   pm2 stop face-recognition             # Detener
 *   pm2 monit                             # Monitor en tiempo real
 *   pm2 logs face-recognition             # Ver logs
 */

const os = require('os');
const cpuCount = os.cpus().length;

// Para face recognition con GPU, limitar workers para no saturar GPU
// GPU: 2-4 workers (comparten GPU con cola interna de CUDA)
// CPU: todos los cores disponibles
const GPU_MODE = process.env.TF_GPU_THREAD_MODE !== undefined ||
    process.env.CUDA_VISIBLE_DEVICES !== undefined;
const MAX_WORKERS = GPU_MODE ? Math.min(cpuCount, 4) : cpuCount;

module.exports = {
    apps: [{
        name: 'face-recognition',
        script: 'app.js',

        // ── Cluster mode ──────────────────────────────────────────
        // 'max' usa todos los CPUs, número específico limita workers
        instances: process.env.PM2_INSTANCES || MAX_WORKERS,
        exec_mode: 'cluster',

        // ── Variables de entorno ──────────────────────────────────
        env: {
            NODE_ENV: 'production',
            TF_FORCE_GPU_ALLOW_GROWTH: 'true',
            TF_CPP_MIN_LOG_LEVEL: '2',       // Reducir logs verbosos de TF
            UV_THREADPOOL_SIZE: '16'          // Pool de threads para I/O async
        },
        env_development: {
            NODE_ENV: 'development',
            TF_CPP_MIN_LOG_LEVEL: '1',
            LOG_LEVEL: 'debug'
        },

        // ── Restart y estabilidad ─────────────────────────────────
        watch: false,                         // No watchear en producción
        max_memory_restart: '4G',            // Reiniciar si supera 4GB RAM
        min_uptime: '30s',                   // Mínimo uptime para considerar estable
        max_restarts: 10,                    // Máximo reinicios antes de parar
        restart_delay: 3000,                 // Espera 3s entre reinicios

        // ── Logs ──────────────────────────────────────────────────
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
        error_file: './logs/pm2-error.log',
        out_file: './logs/pm2-out.log',
        merge_logs: true,                    // Un solo log para todos los workers
        log_type: 'json',

        // ── Graceful shutdown ─────────────────────────────────────
        kill_timeout: 10000,                 // Espera 10s para cierre limpio
        listen_timeout: 30000,              // Timeout para considerar el proceso como listo
        shutdown_with_message: true,

        // ── Optimizaciones Node.js ────────────────────────────────
        node_args: [
            '--max-old-space-size=4096',     // Heap máximo 4GB
            '--expose-gc',                   // Permite GC manual si necesario
            '--max-semi-space-size=64'       // Optimizar para throughput
        ],

        // ── Cron para tareas periódicas ───────────────────────────
        // Reconectar a Redis, guardar índice HNSW, etc.
        // (se implementan internamente en los servicios con setInterval)
    }],

    // ── Deploy config (opcional) ──────────────────────────────────
    deploy: {
        production: {
            user: process.env.DEPLOY_USER || 'ubuntu',
            host: process.env.DEPLOY_HOST || 'your-server.com',
            ref: 'origin/main',
            repo: 'git@github.com:silviosotelo/face-recognition-server-v3.git',
            path: '/opt/face-recognition',
            'post-deploy': 'npm install && npm run build:index && pm2 reload ecosystem.config.js --env production'
        }
    }
};

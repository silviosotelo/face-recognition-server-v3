/**
 * Servicio de Caché con soporte Redis + fallback en memoria
 *
 * Estrategia:
 * 1. Intenta usar Redis (distribuido, persistente, compartido entre procesos PM2)
 * 2. Si Redis no está disponible, usa node-cache en memoria como fallback
 * 3. Todos los errores son silenciosos - la app funciona sin caché si es necesario
 *
 * Con PM2 Cluster: Redis comparte caché entre todos los workers
 * Sin Redis: cada proceso tiene su propia caché en memoria
 */

const NodeCache = require('node-cache');
const logger = require('../utils/logger');
const config = require('../config/server');

class CacheService {
    constructor() {
        this.enabled = config.CACHE.ENABLED;
        this.redisClient = null;
        this.memoryCache = null;
        this.usingRedis = false;
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0
        };

        if (this.enabled) {
            this._initialize();
        } else {
            logger.info('⚠️ Cache service deshabilitado');
        }
    }

    async _initialize() {
        // Intentar conectar a Redis primero
        await this._initRedis();

        // Si Redis falla, usar memoria como fallback
        if (!this.usingRedis) {
            this._initMemoryCache();
        }
    }

    async _initRedis() {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
            logger.info('ℹ️ REDIS_URL no configurada, usando caché en memoria');
            return;
        }

        try {
            const Redis = require('ioredis');
            this.redisClient = new Redis(redisUrl, {
                password: process.env.REDIS_PASSWORD || undefined,
                maxRetriesPerRequest: 3,
                connectTimeout: 5000,
                lazyConnect: true,
                enableReadyCheck: true,
                retryStrategy: (times) => {
                    if (times > 3) {
                        logger.warn('Redis no disponible después de 3 intentos, usando caché en memoria');
                        this._initMemoryCache();
                        return null; // Dejar de reintentar
                    }
                    return Math.min(times * 200, 1000);
                }
            });

            await this.redisClient.connect();

            this.redisClient.on('connect', () => {
                this.usingRedis = true;
                logger.info('✅ Redis conectado - caché distribuida activa');
            });

            this.redisClient.on('error', (err) => {
                if (this.usingRedis) {
                    logger.warn('⚠️ Error de Redis, manteniendo caché en memoria:', err.message);
                }
            });

            this.redisClient.on('close', () => {
                if (this.usingRedis) {
                    logger.warn('⚠️ Redis desconectado, usando caché en memoria como fallback');
                    this.usingRedis = false;
                    if (!this.memoryCache) this._initMemoryCache();
                }
            });

            // Test de conexión
            await this.redisClient.ping();
            this.usingRedis = true;
            logger.info('✅ Cache Redis inicializado correctamente');

        } catch (error) {
            logger.warn(`⚠️ Redis no disponible (${error.message}), usando caché en memoria`);
            this.usingRedis = false;
            if (this.redisClient) {
                try { this.redisClient.disconnect(); } catch {}
                this.redisClient = null;
            }
        }
    }

    _initMemoryCache() {
        if (this.memoryCache) return; // Ya inicializado

        this.memoryCache = new NodeCache({
            stdTTL: config.CACHE.TTL,
            maxKeys: config.CACHE.MAX_SIZE,
            useClones: false,
            deleteOnExpire: true
        });

        this.memoryCache.on('del', (key) => {
            logger.debug(`Memory Cache DEL: ${key}`);
        });

        logger.info('✅ Caché en memoria (node-cache) inicializada como fallback');
    }

    async get(key) {
        if (!this.enabled) return null;

        try {
            let value = null;

            if (this.usingRedis && this.redisClient) {
                const raw = await this.redisClient.get(key);
                if (raw !== null) {
                    value = JSON.parse(raw);
                }
            } else if (this.memoryCache) {
                value = this.memoryCache.get(key);
            }

            if (value !== null && value !== undefined) {
                this.stats.hits++;
                logger.debug(`Cache HIT: ${key}`);
                return value;
            }

            this.stats.misses++;
            logger.debug(`Cache MISS: ${key}`);
            return null;

        } catch (error) {
            logger.debug('Error en cache get:', error.message);
            return null;
        }
    }

    async set(key, value, ttl = null) {
        if (!this.enabled) return false;

        try {
            const effectiveTtl = ttl || config.CACHE.TTL;

            if (this.usingRedis && this.redisClient) {
                await this.redisClient.setex(key, effectiveTtl, JSON.stringify(value));
            } else if (this.memoryCache) {
                ttl ? this.memoryCache.set(key, value, effectiveTtl) : this.memoryCache.set(key, value);
            }

            this.stats.sets++;
            logger.debug(`Cache SET: ${key} (TTL: ${effectiveTtl}s)`);
            return true;

        } catch (error) {
            logger.debug('Error en cache set:', error.message);
            return false;
        }
    }

    async del(key) {
        if (!this.enabled) return false;

        try {
            if (this.usingRedis && this.redisClient) {
                await this.redisClient.del(key);
            } else if (this.memoryCache) {
                this.memoryCache.del(key);
            }

            this.stats.deletes++;
            logger.debug(`Cache DEL: ${key}`);
            return true;

        } catch (error) {
            logger.debug('Error en cache del:', error.message);
            return false;
        }
    }

    async flush() {
        if (!this.enabled) return false;

        try {
            if (this.usingRedis && this.redisClient) {
                await this.redisClient.flushdb();
            } else if (this.memoryCache) {
                this.memoryCache.flushAll();
            }

            logger.info('🧹 Cache completamente limpiado');
            return true;

        } catch (error) {
            logger.error('Error al limpiar cache:', error);
            return false;
        }
    }

    /**
     * Invalida todas las claves que coincidan con un patrón
     * Solo funciona con Redis (en memoria solo puede limpiar todo)
     */
    async invalidatePattern(pattern) {
        if (!this.enabled) return 0;

        try {
            if (this.usingRedis && this.redisClient) {
                const keys = await this.redisClient.keys(pattern);
                if (keys.length > 0) {
                    await this.redisClient.del(...keys);
                    logger.debug(`Cache: ${keys.length} claves eliminadas con patrón ${pattern}`);
                    return keys.length;
                }
                return 0;
            }
        } catch (error) {
            logger.debug('Error en cache invalidatePattern:', error.message);
        }
        return 0;
    }

    async disconnect() {
        if (this.redisClient) {
            try {
                await this.redisClient.disconnect();
                logger.info('Redis desconectado correctamente');
            } catch {}
        }
    }

    getStats() {
        if (!this.enabled) return { enabled: false };

        const baseStats = {
            enabled: true,
            backend: this.usingRedis ? 'redis' : 'memory',
            hits: this.stats.hits,
            misses: this.stats.misses,
            sets: this.stats.sets,
            deletes: this.stats.deletes,
            hitRate: this.stats.hits + this.stats.misses > 0
                ? ((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100).toFixed(1) + '%'
                : '0%'
        };

        if (!this.usingRedis && this.memoryCache) {
            const memStats = this.memoryCache.getStats();
            baseStats.keys = this.memoryCache.keys().length;
            baseStats.memoryHits = memStats.hits;
            baseStats.memoryMisses = memStats.misses;
        }

        return baseStats;
    }
}

module.exports = new CacheService();

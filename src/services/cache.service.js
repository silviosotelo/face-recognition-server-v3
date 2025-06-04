const NodeCache = require('node-cache');
const logger = require('../utils/logger');
const config = require('../config/server');

class CacheService {
    constructor() {
        this.enabled = config.CACHE.ENABLED;
        
        if (this.enabled) {
            this.cache = new NodeCache({
                stdTTL: config.CACHE.TTL,
                maxKeys: config.CACHE.MAX_SIZE,
                useClones: false,
                deleteOnExpire: true
            });
            
            // Event listeners para logging
            this.cache.on('set', (key, value) => {
                logger.debug(`Cache SET: ${key}`);
            });
            
            this.cache.on('del', (key, value) => {
                logger.debug(`Cache DEL: ${key}`);
            });
            
            this.cache.on('expired', (key, value) => {
                logger.debug(`Cache EXPIRED: ${key}`);
            });
            
            logger.info('✅ Cache service inicializado');
        } else {
            logger.info('⚠️ Cache service deshabilitado');
        }
    }

    async get(key) {
        if (!this.enabled) return null;
        
        try {
            const value = this.cache.get(key);
            if (value) {
                logger.debug(`Cache HIT: ${key}`);
            } else {
                logger.debug(`Cache MISS: ${key}`);
            }
            return value;
        } catch (error) {
            logger.error('Error al obtener del cache:', error);
            return null;
        }
    }

    async set(key, value, ttl = null) {
        if (!this.enabled) return false;
        
        try {
            const result = ttl ? 
                this.cache.set(key, value, ttl) : 
                this.cache.set(key, value);
                
            logger.debug(`Cache SET: ${key} (TTL: ${ttl || 'default'})`);
            return result;
        } catch (error) {
            logger.error('Error al guardar en cache:', error);
            return false;
        }
    }

    async del(key) {
        if (!this.enabled) return false;
        
        try {
            const result = this.cache.del(key);
            logger.debug(`Cache DEL: ${key}`);
            return result;
        } catch (error) {
            logger.error('Error al eliminar del cache:', error);
            return false;
        }
    }

    async flush() {
        if (!this.enabled) return false;
        
        try {
            this.cache.flushAll();
            logger.info('Cache completamente limpiado');
            return true;
        } catch (error) {
            logger.error('Error al limpiar cache:', error);
            return false;
        }
    }

    getStats() {
        if (!this.enabled) {
            return { enabled: false };
        }
        
        return {
            enabled: true,
            keys: this.cache.keys().length,
            hits: this.cache.getStats().hits,
            misses: this.cache.getStats().misses,
            deletes: this.cache.getStats().deletes,
            expires: this.cache.getStats().expires
        };
    }
}

module.exports = new CacheService();
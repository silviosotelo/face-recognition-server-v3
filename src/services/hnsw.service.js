/**
 * Servicio HNSW (Hierarchical Navigable Small World)
 * Búsqueda de vectores aproximada O(log n) para 1M+ descriptores faciales
 *
 * Ventajas vs búsqueda lineal O(n):
 * - 100K caras: ~100x más rápido
 * - 1M caras: ~1000x más rápido
 * - Precisión >99% vs búsqueda exacta
 */

const { HierarchicalNSW } = require('hnswlib-node');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

// Dimensión de los descriptores face-api.js (128D)
const DESCRIPTOR_DIM = 128;
// Parámetros HNSW para balance velocidad/precisión
const HNSW_M = 16;           // Conexiones por nodo (16-64 recomendado)
const HNSW_EF_CONSTRUCTION = 200; // Calidad de construcción (>=2*M)
const HNSW_EF_SEARCH = 100;  // Calidad de búsqueda (>=k)
const MAX_ELEMENTS = 1_100_000; // Capacidad máxima del índice

class HNSWService {
    constructor() {
        this.index = null;
        this.idMap = new Map();       // hnsw_label -> { userId, ci, name, id_cliente }
        this.reverseIdMap = new Map(); // userId -> hnsw_label
        this.nextLabel = 0;
        this.isInitialized = false;
        this.indexPath = path.resolve(process.env.HNSW_INDEX_PATH || './data/hnsw.index');
        this.metaPath = path.resolve(process.env.HNSW_META_PATH || './data/hnsw.meta.json');
        this.stats = {
            totalVectors: 0,
            totalSearches: 0,
            avgSearchTimeMs: 0,
            lastRebuildAt: null
        };
    }

    /**
     * Inicializa el índice HNSW
     * Intenta cargar desde disco, si no existe crea uno vacío
     */
    async initialize() {
        try {
            // Crear directorio si no existe
            const dataDir = path.dirname(this.indexPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            if (fs.existsSync(this.indexPath) && fs.existsSync(this.metaPath)) {
                await this.loadIndex();
            } else {
                await this.createIndex();
            }

            this.isInitialized = true;
            logger.info(`✅ HNSW Index inicializado: ${this.stats.totalVectors} vectores`);

        } catch (error) {
            logger.error('❌ Error inicializando HNSW Index:', error);
            // En caso de error, crear índice vacío para no bloquear el servicio
            await this.createIndex();
            this.isInitialized = true;
        }
    }

    /**
     * Crea un nuevo índice HNSW vacío
     */
    async createIndex() {
        this.index = new HierarchicalNSW('l2', DESCRIPTOR_DIM);
        this.index.initIndex(MAX_ELEMENTS, HNSW_M, HNSW_EF_CONSTRUCTION);
        this.index.setEf(HNSW_EF_SEARCH);
        this.idMap.clear();
        this.reverseIdMap.clear();
        this.nextLabel = 0;
        this.stats.totalVectors = 0;
        logger.info('🔨 Nuevo índice HNSW creado (vacío)');
    }

    /**
     * Carga el índice HNSW desde disco
     */
    async loadIndex() {
        try {
            this.index = new HierarchicalNSW('l2', DESCRIPTOR_DIM);
            await this.index.readIndex(this.indexPath, false);
            this.index.setEf(HNSW_EF_SEARCH);

            // Cargar metadatos (mapeo id -> label)
            const meta = JSON.parse(fs.readFileSync(this.metaPath, 'utf-8'));
            this.idMap = new Map(meta.idMap.map(([k, v]) => [parseInt(k), v]));
            this.reverseIdMap = new Map(meta.reverseIdMap.map(([k, v]) => [parseInt(k), parseInt(v)]));
            this.nextLabel = meta.nextLabel;
            this.stats.totalVectors = this.idMap.size;
            this.stats.lastRebuildAt = meta.lastRebuildAt;

            logger.info(`📂 HNSW Index cargado desde disco: ${this.stats.totalVectors} vectores`);
        } catch (error) {
            logger.warn('⚠️ No se pudo cargar índice HNSW, creando nuevo:', error.message);
            await this.createIndex();
        }
    }

    /**
     * Guarda el índice HNSW en disco
     */
    async saveIndex() {
        if (!this.index) return;

        try {
            this.index.writeIndex(this.indexPath);

            const meta = {
                nextLabel: this.nextLabel,
                lastRebuildAt: new Date().toISOString(),
                idMap: Array.from(this.idMap.entries()),
                reverseIdMap: Array.from(this.reverseIdMap.entries())
            };
            fs.writeFileSync(this.metaPath, JSON.stringify(meta));

            logger.debug(`💾 HNSW Index guardado: ${this.stats.totalVectors} vectores`);
        } catch (error) {
            logger.error('Error guardando índice HNSW:', error);
        }
    }

    /**
     * Agrega un usuario al índice HNSW
     * @param {number} userId - ID del usuario en DB
     * @param {number[]} descriptor - Descriptor facial de 128 dimensiones
     * @param {Object} userMeta - Metadata del usuario (ci, name, id_cliente)
     */
    async addUser(userId, descriptor, userMeta = {}) {
        if (!this.isInitialized) {
            throw new Error('HNSW Index no inicializado');
        }

        // Si el usuario ya existe, actualizar descriptor
        if (this.reverseIdMap.has(userId)) {
            await this.updateUser(userId, descriptor, userMeta);
            return;
        }

        const label = this.nextLabel++;
        const vector = descriptor instanceof Float32Array ? Array.from(descriptor) : descriptor;

        this.index.addPoint(vector, label);
        this.idMap.set(label, { userId, ...userMeta });
        this.reverseIdMap.set(userId, label);
        this.stats.totalVectors++;

        // Guardar periódicamente (cada 100 adiciones)
        if (this.stats.totalVectors % 100 === 0) {
            await this.saveIndex();
        }

        logger.debug(`HNSW: Usuario ${userId} agregado (label: ${label})`);
    }

    /**
     * Actualiza el descriptor de un usuario existente
     */
    async updateUser(userId, descriptor, userMeta = {}) {
        if (!this.reverseIdMap.has(userId)) {
            await this.addUser(userId, descriptor, userMeta);
            return;
        }

        const label = this.reverseIdMap.get(userId);
        const vector = descriptor instanceof Float32Array ? Array.from(descriptor) : descriptor;

        // HNSW no soporta update directo - marcar como eliminado y agregar nuevo
        this.index.markDelete(label);

        const newLabel = this.nextLabel++;
        this.index.addPoint(vector, newLabel);
        this.idMap.delete(label);
        this.idMap.set(newLabel, { userId, ...userMeta });
        this.reverseIdMap.set(userId, newLabel);

        logger.debug(`HNSW: Usuario ${userId} actualizado (nuevo label: ${newLabel})`);
    }

    /**
     * Elimina un usuario del índice HNSW
     */
    async removeUser(userId) {
        if (!this.reverseIdMap.has(userId)) return;

        const label = this.reverseIdMap.get(userId);
        this.index.markDelete(label);
        this.idMap.delete(label);
        this.reverseIdMap.delete(userId);
        this.stats.totalVectors = Math.max(0, this.stats.totalVectors - 1);

        logger.debug(`HNSW: Usuario ${userId} eliminado (label: ${label})`);
    }

    /**
     * Busca los k vecinos más cercanos al descriptor dado
     * O(log n) complejidad - escala eficientemente a 1M+ vectores
     *
     * @param {Float32Array|number[]} queryDescriptor - Descriptor de la cara a buscar
     * @param {number} k - Número de candidatos a retornar (default: 5)
     * @param {number} threshold - Umbral de distancia L2 máxima
     * @returns {Array} Resultados ordenados por distancia ascendente
     */
    async search(queryDescriptor, k = 5, threshold = 0.6) {
        if (!this.isInitialized || !this.index || this.stats.totalVectors === 0) {
            return [];
        }

        const startTime = Date.now();

        try {
            const vector = queryDescriptor instanceof Float32Array ? Array.from(queryDescriptor) : queryDescriptor;
            const numNeighbors = Math.min(k, this.stats.totalVectors);

            const { neighbors, distances } = this.index.searchKnn(vector, numNeighbors);

            const results = [];
            for (let i = 0; i < neighbors.length; i++) {
                const label = neighbors[i];
                const distance = distances[i];

                // Filtrar por umbral de distancia
                if (distance > threshold * threshold) continue; // L2 distance es el cuadrado

                const userMeta = this.idMap.get(label);
                if (userMeta) {
                    results.push({
                        ...userMeta,
                        distance: Math.sqrt(distance), // Convertir a distancia euclidiana real
                        similarity: Math.round((1 - Math.sqrt(distance)) * 100)
                    });
                }
            }

            // Actualizar estadísticas
            const searchTime = Date.now() - startTime;
            this.stats.totalSearches++;
            this.stats.avgSearchTimeMs = (
                (this.stats.avgSearchTimeMs * (this.stats.totalSearches - 1) + searchTime) /
                this.stats.totalSearches
            );

            return results.sort((a, b) => a.distance - b.distance);

        } catch (error) {
            logger.error('Error en búsqueda HNSW:', error);
            return [];
        }
    }

    /**
     * Reconstruye el índice completo desde los descriptores dados
     * Usar cuando hay muchos usuarios eliminados o después de importación masiva
     *
     * @param {Array} users - Array de usuarios con { id, descriptor, ci, name, id_cliente }
     */
    async rebuildIndex(users) {
        logger.info(`🔨 Reconstruyendo índice HNSW con ${users.length} usuarios...`);
        const startTime = Date.now();

        await this.createIndex();

        let added = 0;
        let errors = 0;

        for (const user of users) {
            try {
                const descriptor = JSON.parse(user.descriptor);
                await this.addUser(
                    user.id,
                    descriptor,
                    { ci: user.ci, name: user.name, id_cliente: user.id_cliente }
                );
                added++;
            } catch (error) {
                logger.error(`Error agregando usuario ${user.id} al índice: ${error.message}`);
                errors++;
            }
        }

        this.stats.lastRebuildAt = new Date().toISOString();
        await this.saveIndex();

        const elapsed = Date.now() - startTime;
        logger.info(`✅ Índice HNSW reconstruido: ${added} usuarios en ${elapsed}ms (${errors} errores)`);

        return { added, errors, timeMs: elapsed };
    }

    /**
     * Retorna estadísticas del índice
     */
    getStats() {
        return {
            ...this.stats,
            isInitialized: this.isInitialized,
            dimension: DESCRIPTOR_DIM,
            maxElements: MAX_ELEMENTS,
            hnswM: HNSW_M,
            hnswEfConstruction: HNSW_EF_CONSTRUCTION,
            hnswEfSearch: HNSW_EF_SEARCH,
            indexPath: this.indexPath
        };
    }

    /**
     * Verifica si un usuario está en el índice
     */
    hasUser(userId) {
        return this.reverseIdMap.has(userId);
    }

    /**
     * Retorna el tamaño actual del índice
     */
    size() {
        return this.stats.totalVectors;
    }
}

module.exports = new HNSWService();

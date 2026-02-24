-- Script de inicialización de PostgreSQL
-- Ejecutado automáticamente por Docker en el primer arranque
-- (/docker-entrypoint-initdb.d/)

-- El schema real se crea desde Node.js via database.js:_createSchema()
-- Este script solo configura opciones de rendimiento a nivel de base de datos.

-- Activar extensión para estadísticas de queries (opcional pero útil para EXPLAIN ANALYZE)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Comentario de documentación
COMMENT ON DATABASE face_recognition IS
    'Base de datos del sistema de reconocimiento facial v4.1 - GPU/CUDA + HNSW + Redis';

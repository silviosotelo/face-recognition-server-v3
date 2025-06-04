# 🚀 Sistema de Reconocimiento Facial v3.0 - Optimizado

Sistema de reconocimiento facial de clase empresarial con arquitectura modular, optimizaciones de rendimiento y alta precisión.

## ✨ Características Principales

### 🎯 **Reconocimiento de Alta Precisión**
- Algoritmos optimizados con face-api.js
- Múltiples modelos de detección (TinyFaceDetector, SsdMobilenetv1)
- Umbral de confianza configurable (0.38 por defecto)
- Validación de calidad de imagen automática

### ⚡ **Rendimiento Optimizado**
- Caché inteligente con Node-Cache
- Procesamiento de imágenes con Sharp
- Base de datos SQLite optimizada con WAL mode
- Rate limiting y validaciones de entrada

### 🏗️ **Arquitectura Modular**
- Separación clara de responsabilidades
- Controladores, servicios y modelos independientes
- Middleware reutilizable
- Configuración centralizada

### 🛡️ **Seguridad y Robustez**
- Validación exhaustiva de entrada
- Rate limiting por IP
- Logging completo con Winston
- Manejo de errores centralizado
- Helmet para headers de seguridad

### 📊 **Monitoreo y Estadísticas**
- Logs detallados de reconocimientos
- Estadísticas de rendimiento en tiempo real
- Métricas de precisión y velocidad
- Health checks

## 🚀 Instalación Rápida

```bash
# Clonar el repositorio
git clone https://github.com/silviosotelo/face-recognition-backend-v3
cd face-recognition-backend-v3

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus configuraciones

# Crear directorios necesarios
mkdir -p public/models public/uploads logs

# Ejecutar migraciones
npm run migrate

# Opcional: Agregar datos de prueba
npm run seed

# Iniciar servidor
npm run dev
```

## 📁 Estructura del Proyecto

```
face-recognition-backend-v3/
├── src/
│   ├── config/           # Configuraciones
│   ├── controllers/      # Controladores de rutas
│   ├── middleware/       # Middleware personalizado
│   ├── models/          # Modelos de datos
│   ├── services/        # Lógica de negocio
│   ├── utils/           # Utilidades
│   └── routes/          # Definición de rutas
├── public/
│   ├── models/          # Modelos de face-api.js
│   └── uploads/         # Archivos subidos
├── tests/               # Pruebas automatizadas
├── scripts/             # Scripts de migración/seed
└── logs/                # Archivos de log
```

## 🔧 API Endpoints

### Reconocimiento Facial

```http
POST /api/recognition/register
Content-Type: application/json

{
  "ci": "12345678",
  "name": "Juan Pérez",
  "id_cliente": "CLI001",
  "image": "base64-encoded-image"
}
```

```http
POST /api/recognition/recognize
Content-Type: application/json

{
  "image": "base64-encoded-image"
}
```

```http
PUT /api/recognition/update
Content-Type: application/json

{
  "ci": "12345678",
  "image": "base64-encoded-image"
}
```

### Usuarios

```http
GET /api/users?page=1&limit=50&active_only=true
GET /api/users/:id
GET /api/users/ci/:ci
DELETE /api/users/:id
PUT /api/users/:id/activate
```

### Estadísticas

```http
GET /api/recognition/stats
GET /health
```

## ⚙️ Configuración

### Variables de Entorno

| Variable | Descripción | Valor por Defecto |
|----------|-------------|-------------------|
| `PORT` | Puerto del servidor | `4300` |
| `NODE_ENV` | Entorno de ejecución | `development` |
| `DB_PATH` | Ruta de la base de datos | `./database.sqlite` |
| `CACHE_ENABLED` | Habilitar caché | `true` |
| `CACHE_TTL` | Tiempo de vida del caché (segundos) | `3600` |
| `MAX_FILE_SIZE` | Tamaño máximo de archivo | `50mb` |
| `LOG_LEVEL` | Nivel de logging | `info` |

### Modelos de Face-API

Descargar los modelos necesarios en `public/models/`:
- `tiny_face_detector_model-weights_manifest.json`
- `tiny_face_detector_model-shard1`
- `ssd_mobilenetv1_model-weights_manifest.json`
- `ssd_mobilenetv1_model-shard1`
- `face_recognition_model-weights_manifest.json`
- `face_recognition_model-shard1`
- `face_landmark_68_model-weights_manifest.json`
- `face_landmark_68_model-shard1`

## 🧪 Pruebas

```bash
# Ejecutar todas las pruebas
npm test

# Pruebas en modo watch
npm run test:watch

# Cobertura de código
npm run test:coverage
```

## 📊 Métricas de Rendimiento

El sistema incluye métricas detalladas:

- **Tiempo de procesamiento promedio**: ~500-800ms
- **Precisión de reconocimiento**: >95% en condiciones óptimas
- **Throughput**: 30-50 reconocimientos/minuto por instancia
- **Uso de memoria**: ~200-400MB dependiendo del caché

## 🔍 Optimizaciones Implementadas

### Base de Datos
- Índices optimizados para consultas frecuentes
- WAL mode para mejor concurrencia
- Connection pooling
- Soft deletes

### Procesamiento de Imágenes
- Redimensionamiento inteligente con Sharp
- Normalización de histograma
- Mejora de nitidez automática
- Optimización de calidad JPEG

### Cache
- Cache en memoria con TTL configurable
- Cache hits/misses tracking
- Invalidación automática
- Compresión de datos

### Seguridad
- Rate limiting por endpoint
- Validación exhaustiva de entrada
- Sanitización de datos
- Headers de seguridad con Helmet

## 🚀 Deployment

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 4300
CMD ["node", "app.js"]
```

### PM2

```bash
pm2 start app.js --name "face-recognition-v2" --instances 2
```

## 📈 Monitoreo

El sistema incluye logging detallado y métricas:

```bash
# Ver logs en tiempo real
tail -f logs/app.log

# Estadísticas del sistema
curl http://localhost:4300/api/recognition/stats

# Health check
curl http://localhost:4300/health
```

## 🤝 Contribución

1. Fork el proyecto
2. Crear rama feature (`git checkout -b feature/amazing-feature`)
3. Commit cambios (`git commit -m 'Add amazing feature'`)
4. Push a la rama (`git push origin feature/amazing-feature`)
5. Abrir Pull Request

## 📄 Licencia

MIT License - ver `LICENSE` file para detalles.

## 🆘 Soporte

Para soporte técnico:
- Crear issue en GitHub
- Revisar logs en `logs/app.log`
- Verificar configuración en `.env`

---

**Desarrollado con ❤️ para máximo rendimiento y precisión en reconocimiento facial**

const sharp = require('sharp');
const logger = require('../utils/logger');

class ImageProcessingService {
    constructor() {
        this.supportedFormats = ['jpeg', 'jpg', 'png', 'webp'];
        this.maxWidth = 1920;
        this.maxHeight = 1920;
        this.quality = 90;
    }

    async optimizeForRecognition(imageBuffer) {
        try {
            const image = sharp(imageBuffer);
            const metadata = await image.metadata();
            
            logger.info(`Procesando imagen: ${metadata.width}x${metadata.height}, formato: ${metadata.format}`);
            
            // Validar formato
            if (!this.supportedFormats.includes(metadata.format)) {
                throw new Error(`Formato no soportado: ${metadata.format}`);
            }

            let processedImage = image;

            // Redimensionar si es necesario
            if (metadata.width > this.maxWidth || metadata.height > this.maxHeight) {
                processedImage = processedImage.resize(this.maxWidth, this.maxHeight, {
                    fit: 'inside',
                    withoutEnlargement: true
                });
            }

            // Optimizar para reconocimiento facial
            const optimized = await processedImage
                .normalize() // Normalizar histograma
                .sharpen() // Mejorar nitidez
                .gamma(1.2) // Ajustar gamma para mejor contraste
                .jpeg({ 
                    quality: this.quality,
                    progressive: true,
                    mozjpeg: true
                })
                .toBuffer();

            logger.info(`Imagen optimizada: ${imageBuffer.length} -> ${optimized.length} bytes`);
            
            return optimized;
            
        } catch (error) {
            logger.error('Error en procesamiento de imagen:', error);
            throw new Error(`Error al procesar imagen: ${error.message}`);
        }
    }

    async extractFaceRegion(imageBuffer, faceBox, padding = 0.2) {
        try {
            const { x, y, width, height } = faceBox;
            
            // Calcular región ampliada con padding
            const paddingX = Math.round(width * padding);
            const paddingY = Math.round(height * padding);
            
            const extractX = Math.max(0, x - paddingX);
            const extractY = Math.max(0, y - paddingY);
            const extractWidth = width + (paddingX * 2);
            const extractHeight = height + (paddingY * 2);

            const extracted = await sharp(imageBuffer)
                .extract({
                    left: extractX,
                    top: extractY,
                    width: extractWidth,
                    height: extractHeight
                })
                .resize(512, 512, { fit: 'cover' })
                .normalize()
                .sharpen()
                .jpeg({ quality: 95 })
                .toBuffer();

            return extracted;
            
        } catch (error) {
            logger.error('Error al extraer región facial:', error);
            throw error;
        }
    }

    async generateThumbnail(imageBuffer, size = 150) {
        try {
            const thumbnail = await sharp(imageBuffer)
                .resize(size, size, { fit: 'cover' })
                .jpeg({ quality: 80 })
                .toBuffer();

            return thumbnail;
            
        } catch (error) {
            logger.error('Error al generar thumbnail:', error);
            throw error;
        }
    }

    async analyzeImageQuality(imageBuffer) {
        try {
            const image = sharp(imageBuffer);
            const metadata = await image.metadata();
            const stats = await image.stats();

            // Análisis básico de calidad
            const quality = {
                resolution: metadata.width * metadata.height,
                aspectRatio: metadata.width / metadata.height,
                hasAlpha: metadata.hasAlpha,
                channels: metadata.channels,
                brightness: stats.channels[0].mean,
                contrast: stats.channels[0].stdev,
                quality: 'good' // Simplificado
            };

            // Determinar calidad basada en métricas
            if (quality.resolution < 200000) quality.quality = 'low';
            else if (quality.resolution > 2000000) quality.quality = 'high';
            
            if (quality.contrast < 30) quality.quality = 'low';
            if (quality.brightness < 50 || quality.brightness > 200) quality.quality = 'poor';

            return quality;
            
        } catch (error) {
            logger.error('Error al analizar calidad de imagen:', error);
            return { quality: 'unknown' };
        }
    }
}

module.exports = new ImageProcessingService();
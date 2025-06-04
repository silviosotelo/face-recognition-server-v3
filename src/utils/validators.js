const validator = require('validator');

const validateBase64Image = (base64String) => {
    if (!base64String || typeof base64String !== 'string') {
        return false;
    }

    // Verificar formato base64
    if (!validator.isBase64(base64String)) {
        return false;
    }

    // Verificar que no esté vacío después de decodificar
    try {
        const buffer = Buffer.from(base64String, 'base64');
        return buffer.length > 0;
    } catch (error) {
        return false;
    }
};

const sanitizeInput = (input) => {
    if (typeof input !== 'string') {
        return input;
    }
    
    return validator.escape(validator.trim(input));
};

const isValidCI = (ci) => {
    if (!ci || typeof ci !== 'string') {
        return false;
    }
    
    // Permitir números, letras, guiones y puntos
    return /^[a-zA-Z0-9\-\.]{6,20}$/.test(ci);
};

const isValidName = (name) => {
    if (!name || typeof name !== 'string') {
        return false;
    }
    
    // Permitir letras, espacios y caracteres especiales del español
    return /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]{2,100}$/.test(name);
};

module.exports = {
    validateBase64Image,
    sanitizeInput,
    isValidCI,
    isValidName
};
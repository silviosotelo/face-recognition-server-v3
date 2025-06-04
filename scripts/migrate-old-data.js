// Script de migración (crear en scripts/migrate-old-data.js)
const oldDb = new sqlite3.Database('./old-database.sqlite');
const User = require('../src/models/User');

// Migrar usuarios existentes al nuevo formato
const migrateUsers = async () => {
    const oldUsers = await oldDb.all('SELECT * FROM users');
    for (const user of oldUsers) {
        await User.create({
            id_cliente: user.id_cliente ?? 1, // Asignar cliente por defecto si no existe
            name: user.name ?? '',
            ci: user.ci,
            descriptor: user.descriptor,
            confidence_score: 0.8 // Score default para migrados
        });
    }
};
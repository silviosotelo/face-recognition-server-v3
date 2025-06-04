const request = require('supertest');
const app = require('../app');

describe('Recognition API', () => {
    describe('POST /api/recognition/register', () => {
        it('debería registrar un nuevo usuario exitosamente', async () => {
            const userData = {
                ci: '12345678',
                name: 'Test User',
                image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' // 1x1 PNG
            };

            const response = await request(app)
                .post('/api/recognition/register')
                .send(userData)
                .expect(201);

            expect(response.body.success).toBe(true);
            expect(response.body.data.ci).toBe(userData.ci);
        });

        it('debería fallar con imagen inválida', async () => {
            const userData = {
                ci: '12345678',
                name: 'Test User',
                image: 'invalid-base64'
            };

            const response = await request(app)
                .post('/api/recognition/register')
                .send(userData)
                .expect(400);

            expect(response.body.error).toContain('imagen');
        });
    });

    describe('POST /api/recognition/recognize', () => {
        it('debería reconocer un usuario existente', async () => {
            // Primero registrar un usuario
            const userData = {
                ci: '87654321',
                name: 'Test User 2',
                image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
            };

            await request(app)
                .post('/api/recognition/register')
                .send(userData);

            // Luego intentar reconocerlo
            const response = await request(app)
                .post('/api/recognition/recognize')
                .send({ image: userData.image })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.ci).toBe(userData.ci);
        });
    });

    describe('GET /api/recognition/stats', () => {
        it('debería retornar estadísticas del sistema', async () => {
            const response = await request(app)
                .get('/api/recognition/stats')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data).toHaveProperty('face_recognition');
            expect(response.body.data).toHaveProperty('database');
        });
    });
});
const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');

// Rutas de usuarios
router.get('/', userController.getAll);
router.get('/:id', userController.getById);
router.get('/ci/:ci', userController.getByCI);
router.delete('/:id', userController.delete);
router.put('/:id/activate', userController.activate);

module.exports = router;
const express = require('express');
const { catchAsync } = require('../../middlewares/catch-async');
const {
  listPackages,
  getPackage,
} = require('./package.controller');

const router = express.Router();

// Listado público de paquetes activos y visibles (cliente).
router.get('/', catchAsync(listPackages));
// Detalle de un paquete.
router.get('/:id', catchAsync(getPackage));

module.exports = router;

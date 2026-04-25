const express = require('express');
const healthRoutes = require('./health.routes');
const filesRoutes = require('./files.routes');
const categoriesRoutes = require('./categories.routes');

const router = express.Router();

healthRoutes.register(router);
filesRoutes.register(router);
categoriesRoutes.register(router);

module.exports = router;

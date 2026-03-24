const express = require('express');
const healthRoutes = require('./health.routes');
const authRoutes = require('./auth.routes');
const accessRoutes = require('./access.routes');
const adminUsersRoutes = require('./adminUsers.routes');
const usersRoutes = require('./users.routes');
const accountRoutes = require('./account.routes');

const router = express.Router();

healthRoutes.register(router);
authRoutes.register(router);
accessRoutes.register(router);
adminUsersRoutes.register(router);
usersRoutes.register(router);
accountRoutes.register(router);

module.exports = router;

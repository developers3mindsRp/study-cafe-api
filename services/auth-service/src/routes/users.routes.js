const express = require('express');
const usersController = require('../controllers/users.controller');
const { internalAuth } = require('../middleware');

const router = express.Router();

router.post('/', usersController.create);
router.get('/', usersController.list);
// Must be registered before /:id so the literal path is not captured as a param
router.get('/distinct-states', internalAuth, usersController.distinctStates);
router.get('/internal/count', internalAuth, usersController.countUsers);
router.get('/:id', usersController.getOne);
router.put('/:id', usersController.update);
router.delete('/:id', usersController.remove);
router.post('/:id/restore', usersController.restore);
router.post('/internal/list-by-ids', internalAuth, usersController.listByIds);

const register = (rootRouter) => {
    rootRouter.use('/users', router);
};

module.exports = { register };

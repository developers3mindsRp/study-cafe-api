const accountController = require('../controllers/account.controller');
const { requireAuth } = require('../middleware/requireAuth');
const { uploadAvatar: uploadAvatarMw } = require('../middleware/avatarUpload');

function register(router) {
  router.get('/user/profile', requireAuth, accountController.getProfile);
  router.patch('/user/profile', requireAuth, accountController.updateProfile);
  router.delete('/user/account', requireAuth, accountController.deleteAccount);
  router.get('/user/dashboard/stats', requireAuth, accountController.dashboardStats);
  router.get('/user/courses', requireAuth, accountController.myCourses);
  router.post('/user/avatar', requireAuth, uploadAvatarMw.single('avatar'), accountController.uploadAvatar);
  router.get('/user/subscription', requireAuth, accountController.getSubscription);
  router.get('/user/membership-courses', requireAuth, accountController.getMembershipCourses);
}

module.exports = { register };

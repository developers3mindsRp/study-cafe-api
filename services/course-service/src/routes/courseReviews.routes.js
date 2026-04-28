const controller = require('../controllers/courseReviews.controller');
const { internalAuth } = require('../middleware');
const schemas = require('../validations/schemas');
const { validate } = require('../../../../shared');

function register(router) {
  /** Public catalogue: reviews for one course */
  router.get(
    '/courses/:courseId/reviews',
    validate(schemas.courseIdParamCourseReviews),
    controller.listPublicByCourse
  );

  /** Signed-in learner: submit/update own review (requires JWT + gateway x-user-id) */
  router.post('/reviews', validate(schemas.submitCourseReviewBody), controller.submitReview);
  router.get(
    '/reviews/me/course/:courseId',
    validate(schemas.courseIdParamCourseReviews),
    controller.getMineForCourse
  );

  router.get('/internal/course-reviews', internalAuth, validate(schemas.listCourseReviewsQuery), controller.listInternal);
  router.get('/internal/course-reviews/:id', internalAuth, validate(schemas.idParam), controller.getInternal);
  router.patch('/internal/course-reviews/:id', internalAuth, validate(schemas.updateCourseReview), controller.patchInternal);
  router.delete('/internal/course-reviews/:id', internalAuth, validate(schemas.idParam), controller.deleteInternal);
}

module.exports = { register };

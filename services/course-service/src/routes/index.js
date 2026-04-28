const express = require('express');
const healthRoutes = require('./health.routes');
const coursesRoutes = require('./courses.routes');
const affiliateRoutes = require('./affiliate.routes');
const progressRoutes = require('./progress.routes');
const courseReviewsRoutes = require('./courseReviews.routes');

const router = express.Router();

healthRoutes.register(router);
coursesRoutes.register(router);
affiliateRoutes.register(router);
progressRoutes.register(router);
courseReviewsRoutes.register(router);

module.exports = router;

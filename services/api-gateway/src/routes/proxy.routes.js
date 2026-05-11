const { createProxyMiddleware } = require('http-proxy-middleware');
const config = require('../config');
const { validateJWT, optionalJWT, requireCourseAccess } = require('../middleware');

function register(app) {
  const authProxy = createProxyMiddleware({
    target: config.authServiceUrl,
    changeOrigin: true,
    pathRewrite: { '^/api/auth': '/auth', '^/api/access': '/access' },
  });
  const courseProxy = createProxyMiddleware({
    target: config.courseServiceUrl,
    changeOrigin: true,
    pathRewrite: {
      '^/api/courses': '/courses',
      '^/api/course-cats': '/course-cats',
    },
    /** Avoid 504 when MySQL is slow to answer (default proxy timeouts are short). */
    timeout: 120000,
    proxyTimeout: 120000,
    onError(err, req, res) {
      const code = err?.code || err?.errno;
      const msg = err?.message || String(err);
      console.error('[api-gateway] course proxy error:', code || msg, '→', config.courseServiceUrl, req.url);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error: `Course service unreachable: ${code || msg}. Target: ${config.courseServiceUrl}. Is course-service running? Check COURSE_SERVICE_URL and MySQL connectivity.`,
          }),
        );
      }
    },
  });
  const orderProxy = createProxyMiddleware({
    target: config.orderServiceUrl,
    changeOrigin: true,
    pathRewrite: {
      '^/api/coupons': '/coupons',
      '^/api/orders': '/orders',
      '^/api/order': '/order',
    },
  });
  const adminProxy = createProxyMiddleware({
    target: config.adminServiceUrl,
    changeOrigin: true,
    pathRewrite: { '^/api/admin': '/admin' },
  });
  const platformProxy = createProxyMiddleware({
    target: config.platformServiceUrl,
    changeOrigin: true,
    pathRewrite: { '^/api/platform': '/platform' },
  });
  const uploadsProxy = createProxyMiddleware({
    target: config.platformServiceUrl,
    changeOrigin: true,
    pathRewrite: { '^/api/uploads': '/platform/uploads' },
  });

  const adminPaymentLinksPlatformProxy = createProxyMiddleware({
    target: config.adminServiceUrl,
    changeOrigin: true,
    pathRewrite: { '^/api/platform/payment-links': '/platform/payment-links' },
  });

  const usersProxy = createProxyMiddleware({
    target: config.authServiceUrl,
    changeOrigin: true,
    pathRewrite: { '^/api/users': '/users' },
  });

  /** Profile, dashboard stats, avatar, my courses (auth-service) */
  const userAccountProxy = createProxyMiddleware({
    target: config.authServiceUrl,
    changeOrigin: true,
    pathRewrite: { '^/api/user': '/user' },
  });

  /** Static avatar files saved by auth-service */
  const userUploadsProxy = createProxyMiddleware({
    target: config.authServiceUrl,
    changeOrigin: true,
    pathRewrite: { '^/api/user-uploads': '/user-uploads' },
  });

  const affiliateProxy = createProxyMiddleware({
    target: config.courseServiceUrl,
    changeOrigin: true,
    pathRewrite: { '^/api/affiliate': '/affiliate' },
  });

  const progressProxy = createProxyMiddleware({
    target: config.courseServiceUrl,
    changeOrigin: true,
    pathRewrite: { '^/api/progress': '/progress' },
  });
  const certificateProxy = createProxyMiddleware({
    target: config.courseServiceUrl,
    changeOrigin: true,
    pathRewrite: { '^/api/certificates': '/certificates' },
  });
  /** Learner course reviews (POST /reviews, GET /reviews/me/course/:courseId) */
  const courseReviewsUserProxy = createProxyMiddleware({
    target: config.courseServiceUrl,
    changeOrigin: true,
    pathRewrite: { '^/api/reviews': '/reviews' },
  });

  const injectUserId = (req, _res, next) => {
    const uid = req.user?.userId ?? req.user?.id;
    if (uid != null && uid !== '') req.headers['x-user-id'] = String(uid);
    next();
  };

  app.use('/api/auth', authProxy);
  app.use('/api/access', validateJWT, authProxy);
  app.use('/api/users', validateJWT, usersProxy);
  app.use('/api/user', validateJWT, userAccountProxy);
  app.use('/api/user-uploads', userUploadsProxy);
  // Propagate the resolved user id to downstream services when optionalJWT succeeded.
  // Needed so the course-service can scope recordings to a specific batch purchase.
  const injectOptionalUserId = (req, _res, next) => {
    const uid = req.user?.userId ?? req.user?.id;
    if (uid != null && uid !== '') req.headers['x-user-id'] = String(uid);
    next();
  };

  app.get('/api/course-cats', courseProxy);
  app.get('/api/courses/by-category', courseProxy);
  app.get('/api/courses/slug/:slug', optionalJWT, injectOptionalUserId, courseProxy);
  app.get('/api/courses/slug/:slug/sessions', optionalJWT, injectOptionalUserId, courseProxy);
  app.get('/api/courses', optionalJWT, injectOptionalUserId, courseProxy);
  app.get('/api/courses/:courseId/reviews', optionalJWT, injectOptionalUserId, courseProxy);
  app.get('/api/courses/:id', optionalJWT, injectOptionalUserId, courseProxy);
  app.get('/api/courses/:id/sessions', validateJWT, requireCourseAccess, courseProxy);
    app.get('/api/courses/:id/materials', validateJWT, requireCourseAccess, courseProxy);
  /** Certificate metadata for client-rendered certificates (courseTitle, studentName, completionDate). */
  app.get('/api/certificates/course/:courseId', validateJWT, injectUserId, certificateProxy);
  app.use('/api/progress', validateJWT, injectUserId, progressProxy);
  app.use('/api/reviews', validateJWT, injectUserId, courseReviewsUserProxy);
  app.post('/api/orders/webhook/razorpay', orderProxy);
  app.post('/api/orders/payment-link/create', optionalJWT, injectOptionalUserId, orderProxy);
  app.post('/api/orders/payment-link/verify', orderProxy);
  app.get('/api/coupons', orderProxy);
  const injectOrderUserId = (req, _res, next) => {
    const uid = req.user?.userId ?? req.user?.id;
    if (uid != null && uid !== '') req.headers['x-user-id'] = String(uid);
    next();
  };
  app.use('/api/orders', validateJWT, injectOrderUserId, orderProxy);
  app.use('/api/order', validateJWT, injectOrderUserId, orderProxy);
  app.use('/api/affiliate', validateJWT, (req, _res, next) => {
    const uid = req.user?.userId ?? req.user?.id;
    if (uid != null && uid !== '') req.headers['x-user-id'] = String(uid);
    if (req.user?.referral_code) req.headers['x-referral-code'] = req.user.referral_code;
    next();
  }, affiliateProxy);
  app.use('/api/admin', validateJWT, (req, _res, next) => {
    const uid = req.user?.userId ?? req.user?.id;
    if (uid != null && uid !== '') req.headers['x-user-id'] = String(uid);
    if (req.user?.role) req.headers['x-user-role'] = req.user.role;
    next();
  }, adminProxy);
  app.use('/api/platform/payment-links', adminPaymentLinksPlatformProxy);
  app.use('/api/platform', platformProxy);
  app.use('/api/uploads', uploadsProxy);

  const downloadsProxy = createProxyMiddleware({
    target: config.downloadsServiceUrl,
    changeOrigin: true,
  });
  app.use('/api/downloads', downloadsProxy);

  /** Admin panel → downloads-service internal APIs (JWT + server-side internal key). */
  const downloadsInternalProxy = createProxyMiddleware({
    target: config.downloadsServiceUrl,
    changeOrigin: true,
    pathRewrite: { '^/api/internal/downloads': '/internal/downloads' },
    onProxyReq: (proxyReq) => {
      if (config.internalApiKey) {
        proxyReq.setHeader('x-internal-api-key', config.internalApiKey);
      }
    },
  });
  app.use('/api/internal/downloads', validateJWT, (req, _res, next) => {
    const uid = req.user?.userId ?? req.user?.id;
    if (uid != null && uid !== '') req.headers['x-user-id'] = String(uid);
    if (req.user?.role) req.headers['x-user-role'] = req.user.role;
    next();
  }, downloadsInternalProxy);
}

module.exports = { register };

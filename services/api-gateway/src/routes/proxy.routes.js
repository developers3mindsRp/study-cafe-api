const { createProxyMiddleware } = require('http-proxy-middleware');
const config = require('../config');
const { validateJWT, validateJWTUnlessOptions, optionalJWT, requireCourseAccess } = require('../middleware');
const { logger } = require('../../../../shared');

function register(app) {
  const authProxy = createProxyMiddleware({
    target: config.authServiceUrl,
    changeOrigin: true,
    pathRewrite: { '^/api/auth': '/auth', '^/api/access': '/access' },
    /** Pass the caller's IP through so auth-service can throttle signup per client, not per gateway. */
    xfwd: true,
  });
  const courseProxy = createProxyMiddleware({
    target: config.courseServiceUrl,
    changeOrigin: true,
    pathRewrite: {
      '^/api/courses': '/courses',
      '^/api/course-cats': '/course-cats',
      '^/api/marketing-pages': '/marketing-pages',
      '^/api/course-page-settings': '/course-page-settings',
    },
    /** Avoid 504 when MySQL is slow to answer (default proxy timeouts are short). */
    timeout: 120000,
    proxyTimeout: 120000,
    onError(err, req, res) {
      const code = err?.code || err?.errno;
      const msg = err?.message || String(err);
      logger.error('[api-gateway] course proxy error', { code, message: msg, target: config.courseServiceUrl, url: req.url });
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
    timeout: 120000,
    proxyTimeout: 120000,
    onError(err, req, res) {
      const code = err?.code || err?.errno;
      const msg = err?.message || String(err);
      logger.error('[api-gateway] admin proxy error', { code, message: msg, target: config.adminServiceUrl, url: req.url });
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error: `Admin service unreachable: ${code || msg}. Is admin-service running on ${config.adminServiceUrl}?`,
          }),
        );
      }
    },
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
    timeout: 600000,
    proxyTimeout: 600000,
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
  /**
   * Public certificate download links (no JWT).
   *
   * xfwd: true is REQUIRED, not cosmetic. course-service throttles anonymous claims per client
   * IP; without the forwarded header it sees this gateway's address on every request and the
   * per-IP bucket becomes a platform-wide lockout after the first few claims.
   */
  const publicCertificateLinkProxy = createProxyMiddleware({
    target: config.courseServiceUrl,
    changeOrigin: true,
    pathRewrite: { '^/api/certificate-links': '/certificate-links' },
    xfwd: true,
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
    if (req.user?.email) req.headers['x-user-email'] = String(req.user.email);
    next();
  };

  app.use('/api/auth', authProxy);
  app.use('/api/access', validateJWT, authProxy);
  /** User export download requires JWT + one-time job token. */
  app.get('/api/users/export/:jobId/download', validateJWT, usersProxy);
  app.use('/api/users', validateJWT, usersProxy);
  app.use('/api/user', validateJWT, userAccountProxy);
  app.use('/api/user-uploads', userUploadsProxy);
  // Propagate the resolved user id to downstream services when optionalJWT succeeded.
  // Needed so the course-service can scope recordings to a specific batch purchase.
  const injectOptionalUserId = (req, _res, next) => {
    const uid = req.user?.userId ?? req.user?.id;
    if (uid != null && uid !== '') req.headers['x-user-id'] = String(uid);
    if (req.user?.email) req.headers['x-user-email'] = String(req.user.email);
    next();
  };

  app.get('/api/marketing-pages/slug/:slug', courseProxy);
  app.get('/api/course-page-settings/public', courseProxy);
  app.get('/api/course-cats/all', courseProxy);
  app.get('/api/course-cats', courseProxy);
  app.get('/api/courses/by-category', courseProxy);
  app.get('/api/courses/slug/:slug', optionalJWT, injectOptionalUserId, courseProxy);
  app.get('/api/courses/slug/:slug/sessions', optionalJWT, injectOptionalUserId, courseProxy);
  app.get('/api/courses', optionalJWT, injectOptionalUserId, courseProxy);
  app.get('/api/courses/:courseId/reviews', optionalJWT, injectOptionalUserId, courseProxy);
  app.get('/api/courses/:id', optionalJWT, injectOptionalUserId, courseProxy);
  app.get('/api/courses/:id/sessions', validateJWT, requireCourseAccess, courseProxy);
    app.get('/api/courses/:id/materials', validateJWT, requireCourseAccess, courseProxy);
  /**
   * Public certificate claim links. Explicit method+path on purpose — a prefix mount
   * (app.use('/api/certificate-links', ...)) would make the whole namespace world-readable, so
   * any route added under it in course-service later would silently become public.
   */
  app.get('/api/certificate-links/:token', publicCertificateLinkProxy);
  app.post('/api/certificate-links/:token/claim', publicCertificateLinkProxy);
  app.post('/api/certificate-links/:token/retrieve', publicCertificateLinkProxy);
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
    if (req.user?.email) req.headers['x-user-email'] = String(req.user.email);
    next();
  };
  app.use('/api/orders', validateJWT, injectOrderUserId, orderProxy);
  app.use('/api/order', validateJWT, injectOrderUserId, orderProxy);
  app.use('/api/affiliate', validateJWT, (req, _res, next) => {
    const uid = req.user?.userId ?? req.user?.id;
    if (uid != null && uid !== '') req.headers['x-user-id'] = String(uid);
    if (req.user?.email) req.headers['x-user-email'] = String(req.user.email);
    if (req.user?.referral_code) req.headers['x-referral-code'] = req.user.referral_code;
    next();
  }, affiliateProxy);
  app.use('/api/admin', validateJWTUnlessOptions, (req, _res, next) => {
    const uid = req.user?.userId ?? req.user?.id;
    if (uid != null && uid !== '') req.headers['x-user-id'] = String(uid);
    if (req.user?.email) req.headers['x-user-email'] = String(req.user.email);
    if (req.user?.role) req.headers['x-user-role'] = req.user.role;
    next();
  }, adminProxy);
  app.use('/api/platform/payment-links', adminPaymentLinksPlatformProxy);
  app.post('/api/platform/membership/upgrade-summary', validateJWT, injectUserId, platformProxy);
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
    if (req.user?.email) req.headers['x-user-email'] = String(req.user.email);
    if (req.user?.role) req.headers['x-user-role'] = req.user.role;
    next();
  }, downloadsInternalProxy);
}

module.exports = { register };

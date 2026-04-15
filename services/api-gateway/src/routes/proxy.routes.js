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
  });
  const orderProxy = createProxyMiddleware({
    target: config.orderServiceUrl,
    changeOrigin: true,
    pathRewrite: {
      '^/api/orders': '/orders',
      '^/api/order': '/order',
    },
    on: {
      proxyReq: (proxyReq, req) => {
        // Order-service only trusts X-User-Id (validateToken returns userId and id)
        const uid = req.user?.userId ?? req.user?.id;
        if (uid != null && uid !== '') {
          proxyReq.setHeader('X-User-Id', String(uid));
        }
      },
    },
  });
  const adminProxy = createProxyMiddleware({
    target: config.adminServiceUrl,
    changeOrigin: true,
    pathRewrite: { '^/api/admin': '/admin' },
    on: {
      proxyReq: (proxyReq, req) => {
        const uid = req.user?.userId ?? req.user?.id;
        if (uid != null && uid !== '') proxyReq.setHeader('X-User-Id', String(uid));
        if (req.user?.role) proxyReq.setHeader('X-User-Role', req.user.role);
      },
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

  app.use('/api/auth', authProxy);
  app.use('/api/access', validateJWT, authProxy);
  app.use('/api/users', validateJWT, usersProxy);
  app.use('/api/user', validateJWT, userAccountProxy);
  app.use('/api/user-uploads', userUploadsProxy);
  app.get('/api/course-cats', courseProxy);
  app.get('/api/courses/by-category', courseProxy);
  app.get('/api/courses/slug/:slug', optionalJWT, courseProxy);
  app.get('/api/courses/slug/:slug/sessions', optionalJWT, courseProxy);
  app.get('/api/courses', optionalJWT, courseProxy);
  app.get('/api/courses/:id', optionalJWT, courseProxy);
  app.get('/api/courses/:id/sessions', validateJWT, requireCourseAccess, courseProxy);
  app.get('/api/courses/:id/materials', validateJWT, requireCourseAccess, courseProxy);
  app.post('/api/orders/webhook/razorpay', orderProxy);
  app.use('/api/orders', validateJWT, orderProxy);
  app.use('/api/order', validateJWT, orderProxy);
  app.use('/api/admin', validateJWT, adminProxy);
  app.use('/api/platform', platformProxy);
  app.use('/api/uploads', uploadsProxy);
}

module.exports = { register };

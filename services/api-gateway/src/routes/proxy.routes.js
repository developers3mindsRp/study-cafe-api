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
    pathRewrite: { '^/api/orders': '/orders' },
    on: {
      proxyReq: (proxyReq, req) => {
        if (req.user?.userId) proxyReq.setHeader('X-User-Id', String(req.user.userId));
      },
    },
  });
  const adminProxy = createProxyMiddleware({
    target: config.adminServiceUrl,
    changeOrigin: true,
    pathRewrite: { '^/api/admin': '/admin' },
    on: {
      proxyReq: (proxyReq, req) => {
        if (req.user?.userId) proxyReq.setHeader('X-User-Id', String(req.user.userId));
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

  app.use('/api/auth', authProxy);
  app.use('/api/access', validateJWT, authProxy);
  app.use('/api/users', validateJWT, usersProxy);
  app.get('/api/course-cats', courseProxy);
  app.get('/api/courses/by-category', courseProxy);
  app.get('/api/courses/slug/:slug', optionalJWT, courseProxy);
  app.get('/api/courses/slug/:slug/sessions', optionalJWT, courseProxy);
  app.get('/api/courses', optionalJWT, courseProxy);
  app.get('/api/courses/:id', optionalJWT, courseProxy);
  app.get('/api/courses/:id/sessions', validateJWT, requireCourseAccess, courseProxy);
  app.get('/api/courses/:id/materials', validateJWT, requireCourseAccess, courseProxy);
  app.use('/api/orders', validateJWT, orderProxy);
  app.use('/api/admin', validateJWT, adminProxy);
  app.use('/api/platform', platformProxy);
  app.use('/api/uploads', uploadsProxy);
}

module.exports = { register };

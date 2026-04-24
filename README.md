Stack

Node.js

Express.js

MySQL (single instance, separate schema per service)

Redis

JWT Authentication

Razorpay (configurable from admin)

DB Outbox (no Kafka/RabbitMQ)

Architecture
Service	      Port	Schema	      Responsibility

api-gateway	   3000	—	            Entry point, JWT validation, routing
auth-service	4001	auth_schema	   Users, roles, JWT
course-service	4002	course_schema	Courses, batches, sessions, materials
order-service	4003	order_schema	Orders, payments, Razorpay, outbox
admin-service	4004	admin_schema	Admin panel, audit, payment config

Run the backend

### Prerequisites (development and production)

- **MySQL 8+** on `127.0.0.1` **port 3306**, with database `studycafe_db` (and schemas as created by your migrations/seed process).
- **Redis** on `127.0.0.1` **port 6379**.

### One-time: install dependencies

From the `studycafe-ms` root:

```bash
npm install
npm run install:all
```

The root `dev:*` and `start:*` scripts default to `MYSQL_USER=root` and `MYSQL_PASSWORD=rootpassword` for local use. In production, use a dedicated app user and strong passwords (see below).

### Development

1. **Start MySQL and Redis** on the machine (services must be listening before the next step).
2. From the repo root, run:

   ```bash
   npm run dev
   ```

   This will:

   - Wait until `3306` and `6379` are open (up to 60s).
   - Run **`dev:fix-db`**: apply `scripts/fix-mysql-localhost-users.sql` via `mysql2` (creates / grants `studycafe_user` as needed; requires **MySQL root** with the password the script uses—see `package.json` `dev:fix-db`).
   - Start **all six** processes in one terminal with **`node --watch`**: api-gateway (3000), auth (4001), course (4002), order (4003), admin (4004), platform (4005).

3. **API entry point** for clients: `http://localhost:3000` (api-gateway).
4. If you see “port already in use”, free the app ports and retry:

   ```bash
   npm run dev:kill-ports
   npm run dev
   ```

5. If MySQL/Redis are already up and you only want the same “wait → fix-db → all services” flow without changing anything, `npm run dev:up` is equivalent to the middle part of `dev`.

**After the stack is up — seed and admin (first time)**

- Create roles and a super admin (when auth DB/schema is ready):

  ```bash
  cd services/auth-service && npm run seed
  ```

  Default login: `admin@studycafe.in` / `SuperAdmin@123` (override with `SEED_SUPER_ADMIN_EMAIL` and `SEED_SUPER_ADMIN_PASSWORD`).

**Granting permissions to admin users (admin panel)**

- **Admin Users** → create or edit a user. **Role** sets base access; **Additional permissions** add extras on top.
- If you added this to an existing DB, run once from auth-service: `node scripts/add-permission-overrides-column.js` with the same env as the app.

### Production

1. On the **server**, install and run **MySQL (3306)** and **Redis (6379)**. Create the `studycafe_db` database and a least-privilege MySQL user (not necessarily root).
2. **Set environment variables** for real secrets; do not rely on the example passwords in `package.json`. At minimum, set (names match what the services read):

   - `JWT_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_API_KEY`
   - `MYSQL_HOST`, `MYSQL_PORT` (default `3306`), `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`
   - `REDIS_URL` (e.g. `redis://127.0.0.1:6379`)
   - Inter-service URLs if not all on one host: `AUTH_SERVICE_URL`, `COURSE_SERVICE_URL`, `ORDER_SERVICE_URL`, `ADMIN_SERVICE_URL`, `PLATFORM_SERVICE_URL`
   - **`NODE_ENV=production`** (set by the `start:*` scripts) so uploads use the **hardcoded** paths in `shared/persistentDataRoot.js` and `shared/mediaUrl.js` (platform and user media under `/var/www/html/study-cafe-media/uploads/YYYY/MM/`, public URLs on `https://assets.studycafe.in`) — see step 3.

   The **`start:*` scripts in `package.json`** embed `127.0.0.1` service URLs, `NODE_ENV=production`, and dev-style DB/JWT for a single-machine layout. For real production, use a **PM2 ecosystem file**, **systemd `EnvironmentFile`**, or a **wrapper** for secrets, not the embedded defaults in git.

3. **Persistent upload directory (required for production, once per server)**  
   With `NODE_ENV=production`, **images** (admin CMS uploads and user avatars) are stored under **`/var/www/html/study-cafe-media/uploads/YYYY/MM/`** (WordPress-style), served publicly as **`https://assets.studycafe.in/uploads/...`** (configurable with `ASSETS_BASE_URL`). **Certificates** remain under `/var/lib/studycafe-ms/certificates`. Create dirs and fix ownership (the app also `mkdir`s year/month on upload when it can write):

   ```bash
   sudo bash scripts/ensure-persistent-dirs.sh
   sudo chown -R mynodeuser: /var/lib/studycafe-ms /var/www/html/study-cafe-media
   ```

   To override storage paths, use `UPLOADS_DIR` or `USER_UPLOADS_DIR` in `.env` (see `.env.example`). For certificates only, you can set `CERTIFICATES_UPLOAD_DIR` or keep the default under `PERSISTENT_DATA_ROOT` in `shared/persistentDataRoot.js`. **Migrating** older flat files: copy into `uploads/YYYY/MM/` on the new tree or keep `UPLOADS_DIR` until URLs are updated.

4. **Deploy code** to the server, then from repo root:

   ```bash
   npm install
   npm run install:all
   ```

5. **Start the stack** (no file watching; the `start:*` scripts set `NODE_ENV=production` so the hardcoded data paths apply):

   ```bash
   npm start
   ```

   For a long-running process, use **PM2** with the repo **ecosystem** file (one process per service; set secrets in `.env` first):

   ```bash
   npm run pm2:start
   # pm2 status | npm run pm2:logs
   # npm run pm2:reload   # zero-downtime reload after deploy
   # npm run pm2:stop
   ```

6. Put your **reverse proxy** (e.g. nginx) and **TLS** in front of **port 3000** (api-gateway) for public traffic.

## API Endpoints

Use the following service base URLs for Postman testing:

- `http://localhost:3000` - api-gateway
- `http://localhost:4001` - auth-service
- `http://localhost:4002` - course-service
- `http://localhost:4003` - order-service
- `http://localhost:4004` - admin-service

For admin routes, use the admin-service base URL and pass a valid admin JWT in `Authorization: Bearer <token>`.

### Admin service API collection (localhost:4004)

#### Admin / system

- `GET /admin/me`
- `GET /internal/payment-config`
- `GET /admin/stats`
- `PUT /admin/payment-config`
- `GET /admin/logs`

#### Courses / catalog

- `GET /admin/courses`
- `GET /admin/courses/:id`
- `GET /admin/courses/:id/sessions`
- `POST /admin/courses`
- `PUT /admin/courses/:id`

#### Course batches / sessions / materials

- `POST /admin/courses/:id/batches`
- `PUT /admin/batches/:id`
- `POST /admin/batches/:id/sessions`
- `PUT /admin/sessions/:id`
- `POST /admin/sessions/:id/recordings`
- `PUT /admin/recordings/:id`
- `PUT /admin/recordings/:id/visibility`
- `DELETE /admin/recordings/:id`
- `DELETE /admin/sessions/:id`
- `DELETE /admin/batches/:id`
- `GET /admin/batches/:id/enrollments`
- `POST /admin/batches/:id/enrollments`
- `DELETE /admin/batch-enrollments/:id`
- `POST /admin/courses/:id/materials`

#### Course categories

- `GET /admin/course-cats`
- `POST /admin/course-cats`
- `PUT /admin/course-cats/:id`
- `DELETE /admin/course-cats/:id`

#### Course page settings

- `GET /admin/course-page-settings`
- `PUT /admin/course-page-settings/:key`

#### Orders

- `GET /admin/orders`
- `GET /admin/orders/:orderId`

#### Platform / CMS proxy

- `GET /admin/platform/home`
- `PUT /admin/platform/home`
- `GET /admin/platform/states`
- `POST /admin/platform/states`
- `PUT /admin/platform/states/:id`
- `GET /admin/platform/testimonials`
- `POST /admin/platform/testimonials`
- `PUT /admin/platform/testimonials/:id`
- `DELETE /admin/platform/testimonials/:id`
- `GET /admin/platform/faqs`
- `GET /admin/platform/faqs/:id`
- `POST /admin/platform/faqs`
- `PUT /admin/platform/faqs/:id`
- `DELETE /admin/platform/faqs/:id`
- `GET /admin/platform/seo-metadata`
- `GET /admin/platform/seo-metadata/:id`
- `GET /admin/platform/seo-metadata/slug/:slug`
- `POST /admin/platform/seo-metadata`
- `PUT /admin/platform/seo-metadata/:id`
- `DELETE /admin/platform/seo-metadata/:id`
- `GET /admin/platform/footer`
- `PUT /admin/platform/footer/:key`
- `GET /admin/platform/plans`
- `GET /admin/platform/plans/:id`
- `POST /admin/platform/plans`
- `PUT /admin/platform/plans/:id`
- `PUT /admin/platform/plans/:id/popular`
- `DELETE /admin/platform/plans/:id`
- `GET /admin/platform/articles`
- `GET /admin/platform/articles/:id`
- `POST /admin/platform/articles`
- `PUT /admin/platform/articles/:id`
- `DELETE /admin/platform/articles/:id`
- `GET /admin/platform/article-categories`
- `GET /admin/platform/article-categories/:id`
- `POST /admin/platform/article-categories`
- `PUT /admin/platform/article-categories/:id`
- `DELETE /admin/platform/article-categories/:id`
- `GET /admin/platform/tags`
- `GET /admin/platform/article-types`
- `GET /admin/platform/courts`
- `GET /admin/platform/cms-pages`
- `GET /admin/platform/cms-pages/:slug`
- `PUT /admin/platform/cms-pages/:slug`
- `POST /admin/upload`
- `GET /admin/platform/media-assets`
- `POST /admin/platform/media-assets`
- `DELETE /admin/platform/media-assets/:id`
- `GET /admin/platform/promo-codes`
- `GET /admin/platform/promo-codes/:id`
- `POST /admin/platform/promo-codes`
- `PUT /admin/platform/promo-codes/:id`
- `DELETE /admin/platform/promo-codes/:id`

Runs all services on ports 3000, 4001–4005.

Common Issues

**MySQL or Redis not reachable**

Ensure MySQL is listening on 127.0.0.1:3306 and Redis on 127.0.0.1:6379, then `npm run dev` (it waits for those ports). Adjust credentials in the npm `dev:*` / `start:*` scripts or export env vars in your process manager for production.

**Upload errors in production (`EACCES` on `/var/lib/studycafe-ms`)**

`NODE_ENV=production` writes uploads under the path in `shared/persistentDataRoot.js`. Create that directory and ensure the process user can write to it (see the production steps and `scripts/ensure-persistent-dirs.sh`).

Ports in use (EADDRINUSE)
Kill any process using ports 3000, 4001–4005, then start again:
npm run dev:kill-ports
npm run dev

MySQL “Access denied” for studycafe_user / app users
Apply the user grant once (as root): npm run dev:fix-db, then `npm run dev` again. Set `MYSQL_USER` / `MYSQL_PASSWORD` to match your server in production; do not use the dev password there.

Production deploy

Deploy updates code on the host and can restart the stack with PM2 if installed (see `.github/workflows/api.yml`). Configure stronger `JWT_SECRET`, DB passwords, and `INTERNAL_API_KEY` in the host environment, not the dev values embedded in the npm scripts.
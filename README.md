Stack

Node.js

Express.js

MySQL (single instance, separate schema per service)

Redis

Docker + Docker Compose

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

Quick Start

setup .env
run -> docker compose up -d

Development
Start Infrastructure
docker compose up -d mysql redis

Install Dependencies
npm install
npm run install:all

Seed super admin (auth-service)
After MySQL and auth-service DB/schema are ready, create roles and a super_admin user for the admin panel:
cd services/auth-service && npm run seed
Default login: admin@studycafe.in / SuperAdmin@123 (override with SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD).

Granting permissions to admin users (admin panel)
- In the admin app go to **Admin Users** → create or edit a user.
- **Role** sets base permissions (Super Admin / Admin = full access; Editor / Viewer = limited).
- Use **Additional permissions** to grant specific permissions on top of the role (e.g. give an Editor one extra permission).
If you added this feature to an existing DB, run once from auth-service: `node scripts/add-permission-overrides-column.js` (with same env as the app) to add the `permission_overrides` column.

Start All Services
npm run dev

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

Runs all services on ports 3000, 4001–4004.

Common Issues

**Docker not running / “Cannot connect to the Docker daemon”**

You need Docker Desktop running for `npm run dev` (MySQL and Redis run in Docker).

1. **Install Docker Desktop** (if needed): https://www.docker.com/products/docker-desktop/
2. **Start Docker Desktop** from Applications (or the menu bar) and wait until it’s fully up.
3. From the **studycafe-ms** directory run:
   - `npm run dev` — tries to start Docker, then infra + fix-db + all services
   - or, if Docker is already running: `npm run dev:up` — infra + fix-db + all services

Ports in use (EADDRINUSE)
Kill any process using ports 3000, 4001–4005 (e.g. leftover Node from a previous run), then start again:
npm run dev:kill-ports
npm run dev
If you ran full Docker stack before, also: npm run dev:free-ports then npm run dev:infra

MySQL “Access denied” for platform_user / auth_user / etc.
The MySQL container needs schemas and users. Either:
- Fresh start: remove the MySQL volume and run again so init runs: docker compose down -v then docker compose up -d mysql redis then npm run dev
- Existing DB: apply the fix script (creates schemas and users): npm run dev:fix-db
Then run npm run dev again.


Docker network error

docker compose down --remove-orphans
docker network prune -f
docker compose up -d mysql redis


Local MySQL conflict

Docker MySQL runs on port 3307
const { Sequelize } = require("sequelize");
const config = require("../config");
const { attachQueryCollector } = require("../../../../shared/apiRequestLogger");

const sequelize = new Sequelize(
  config.mysql.database,
  config.mysql.user,
  config.mysql.password,
  {
    host: config.mysql.host,
    port: config.mysql.port,
    dialect: "mysql",
    logging: false,
    timezone: "+05:30",
    dialectOptions: { timezone: "+05:30" },
    pool: {
      max: config.mysql.connectionLimit || 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    define: { underscored: true },
  },
);

attachQueryCollector(sequelize);

const Category = require("./Category")(sequelize);
const Tag = require("./Tag")(sequelize);
const ArticleType = require("./ArticleType")(sequelize);
const Court = require("./Court")(sequelize);

const ArticleCategoryMap = require("./ArticleCategoryMap")(sequelize);
const ArticleTagMap = require("./ArticleTagMap")(sequelize);
const ArticleTypeMap = require("./ArticleTypeMap")(sequelize);
const ArticleCourtMap = require("./ArticleCourtMap")(sequelize);

const Article = require("./Article")(sequelize);
const ArticleSection = require("./ArticleSection")(sequelize);
const ArticleEditLock = require("./ArticleEditLock")(sequelize);
const Comment = require("./Comment")(sequelize);

const CmsPage = require("./CmsPage")(sequelize);
const State = require("./State")(sequelize);
const GoogleReview = require("./GoogleReview")(sequelize);
const Testimonial = require("./Testimonial")(sequelize);
const Product = require("./Product")(sequelize);
const Profession = require("./Profession")(sequelize);
const FooterData = require("./FooterData")(sequelize);
const GlobalSetting = require("./GlobalSetting")(sequelize);
const PremiumPlan = require("./PremiumPlan")(sequelize);
const PlanCourse = require("./PlanCourse")(sequelize);
const PlanCourseCategory = require("./PlanCourseCategory")(sequelize);
const PlanComparisonFeature = require("./PlanComparisonFeature")(sequelize);
const PlanFeatureAvailability = require("./PlanFeatureAvailability")(sequelize);
const Faq = require("./Faq")(sequelize);
const SeoMetadata = require("./SeoMetadata")(sequelize);
const SiteSeoRoute = require("./SiteSeoRoute")(sequelize);
const Redirect = require("./Redirect")(sequelize);
const Media = require("./Media")(sequelize);
const ContactInquiry = require("./ContactInquiry")(sequelize);
const UserMembership = require("./UserMembership")(sequelize);
const NewsletterSubscriber = require("./NewsletterSubscriber")(sequelize);
const NewsletterTemplate = require("./NewsletterTemplate")(sequelize);

Article.associate({
  Comment,
  Category,
  Tag,
  ArticleType,
  Court,
  ArticleCategoryMap,
  ArticleTagMap,
  ArticleTypeMap,
  ArticleCourtMap,
  ArticleSection,
});
ArticleSection.associate({ Article });

const models = {
  Article,
  ArticleSection,
  ArticleEditLock,
  Comment,
  Category,
  Tag,
  ArticleType,
  Court,
  ArticleCategoryMap,
  ArticleTagMap,
  ArticleTypeMap,
  ArticleCourtMap,
  CmsPage,
  State,
  GoogleReview,
  Testimonial,
  Product,
  Profession,
  FooterData,
  GlobalSetting,
  PremiumPlan,
  PlanCourse,
  PlanCourseCategory,
  PlanComparisonFeature,
  PlanFeatureAvailability,
  Faq,
  SeoMetadata,
  SiteSeoRoute,
  Redirect,
  Media,
  ContactInquiry,
  UserMembership,
  NewsletterSubscriber,
  NewsletterTemplate,
};

async function connect() {
  await sequelize.authenticate();
  // Ensure the article_sections child table exists (created via model only — no migration script).
  // Idempotent: creates the table if missing, no-op when present. Scoped to this one table.
  await ArticleSection.sync();
  // Same model-only pattern for the concurrent-editing lock table.
  await ArticleEditLock.sync();
  // Ensure the products ("Our Products") table exists (created via model only — no migration script).
  // Idempotent: creates the table if missing, no-op when present. Scoped to this one table.
  await Product.sync();
  // Same model-only pattern for the professions master (also created via the SQL script below).
  await Profession.sync();
  // Ensure the redirects table exists (created via model only — no migration script).
  await Redirect.sync();
  // Telegram auto-publish bookkeeping columns on `articles` (created via idempotent
  // ALTER — not part of the Sequelize model). These are managed purely by raw SQL in
  // telegram.service.js: `telegram_posted_at` is the atomic exactly-once claim marker
  // and `telegram_message_id` stores the posted group message id for observability.
  await ensureArticleTelegramColumns();
}

/**
 * Add the Telegram tracking columns to `articles` if they do not already exist.
 * Idempotent and safe on a live DB (nullable columns → instant metadata-only
 * change on MySQL 8). MySQL lacks `ADD COLUMN IF NOT EXISTS`, so we probe
 * information_schema first and only ALTER when the column is missing.
 */
async function ensureArticleTelegramColumns() {
  const columns = [
    { name: 'telegram_posted_at', ddl: 'DATETIME NULL DEFAULT NULL' },
    { name: 'telegram_message_id', ddl: 'BIGINT NULL DEFAULT NULL' },
  ];
  for (const col of columns) {
    const [{ cnt }] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'articles' AND COLUMN_NAME = :name`,
      { replacements: { name: col.name }, type: Sequelize.QueryTypes.SELECT },
    );
    if (Number(cnt) === 0) {
      await sequelize.query(`ALTER TABLE articles ADD COLUMN ${col.name} ${col.ddl}`);
    }
  }
}

module.exports = {
  sequelize,
  ...models,
  connect,
};

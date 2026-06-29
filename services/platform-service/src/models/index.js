const { Sequelize } = require("sequelize");
const config = require("../config");

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
const Comment = require("./Comment")(sequelize);

const CmsPage = require("./CmsPage")(sequelize);
const State = require("./State")(sequelize);
const GoogleReview = require("./GoogleReview")(sequelize);
const Testimonial = require("./Testimonial")(sequelize);
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
}

module.exports = {
  sequelize,
  ...models,
  connect,
};

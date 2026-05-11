-- Adds WhatsApp group links, Telegram group links, and Google News URL to categories.
-- Run against your database before deploying the service update.

ALTER TABLE categories
  ADD COLUMN whatsapp_links JSON NULL
    COMMENT 'Array of WhatsApp group invite URLs for this category'
    AFTER parent_id,
  ADD COLUMN telegram_links JSON NULL
    COMMENT 'Array of Telegram group/channel URLs for this category'
    AFTER whatsapp_links,
  ADD COLUMN google_news_url VARCHAR(500) NULL
    COMMENT 'Google News topic/search URL for this category'
    AFTER telegram_links;

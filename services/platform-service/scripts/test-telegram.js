#!/usr/bin/env node
/**
 * Telegram integration — local test/console utility.
 *
 * Lets you verify the bot token + chat id and the article-post formatting
 * WITHOUT publishing a real article. Prints clear, human-readable output.
 *
 * Usage (from services/platform-service):
 *   npm run telegram:test                 # send a plain connectivity test message
 *   npm run telegram:test -- --article 42 # post article #42 to the group (force re-send)
 *   npm run telegram:test -- --dry 42     # print the message that WOULD be sent (no API call)
 *
 * Reads TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID from the environment (repo .env).
 */

const { QueryTypes } = require('sequelize');
const config = require('../src/config');
const telegram = require('../src/services/telegram.service');
const { connect, sequelize } = require('../src/models');

function parseArgs(argv) {
  const out = { mode: 'ping', articleId: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--article' || a === '-a') { out.mode = 'article'; out.articleId = Number(argv[++i]); }
    else if (a === '--dry' || a === '-d') { out.mode = 'dry'; out.articleId = Number(argv[++i]); }
    else if (/^\d+$/.test(a) && out.articleId === null) { out.articleId = Number(a); out.mode = 'article'; }
  }
  return out;
}

function printConfig() {
  const { botToken, chatId, enabled, apiBaseUrl } = config.telegram;
  const masked = botToken ? `${botToken.slice(0, 4)}…${botToken.slice(-4)}` : '(missing)';
  console.log('── Telegram config ────────────────────────────');
  console.log(`  enabled     : ${enabled}`);
  console.log(`  bot token   : ${masked}`);
  console.log(`  chat id     : ${chatId || '(missing)'}`);
  console.log(`  api base    : ${apiBaseUrl}`);
  console.log(`  configured  : ${telegram.isConfigured()}`);
  console.log('───────────────────────────────────────────────');
}

async function main() {
  const { mode, articleId } = parseArgs(process.argv.slice(2));
  printConfig();

  if (!telegram.isConfigured()) {
    console.error('\n❌ Not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in your .env, then retry.');
    process.exitCode = 1;
    return;
  }

  if (mode === 'ping') {
    console.log('\n→ Sending connectivity test message…');
    const res = await telegram.sendTestMessage(
      '✅ <b>Study Cafe</b> → Telegram integration is working. (test message)',
    );
    console.log(res.ok ? `✅ Sent. message_id=${res.messageId}` : `❌ Failed: ${res.error}`);
    process.exitCode = res.ok ? 0 : 1;
    return;
  }

  if (!Number.isFinite(articleId) || articleId <= 0) {
    console.error('\n❌ Provide a valid article id, e.g. `npm run telegram:test -- --article 42`.');
    process.exitCode = 1;
    return;
  }

  // Article modes need the DB.
  await connect();

  if (mode === 'dry') {
    const [row] = await sequelize.query(
      `SELECT id, title, slug, excerpt, sub_heading, content, thumbnail_url, status
         FROM articles WHERE id = :id AND deleted_at IS NULL LIMIT 1`,
      { replacements: { id: articleId }, type: QueryTypes.SELECT },
    );
    if (!row) { console.error(`\n❌ Article #${articleId} not found.`); process.exitCode = 1; return; }
    console.log(`\n── Preview for article #${articleId} (status=${row.status}) ──`);
    console.log(`  thumbnail: ${row.thumbnail_url || '(none)'}`);
    console.log(`  link     : ${telegram.articleUrl(row) || '(no slug/site url)'}`);
    console.log('  ─ message ─────────────────────────────────');
    console.log(telegram.buildMessageHtml(row));
    console.log('  ────────────────────────────────────────────');
    console.log('\n(dry run — nothing was sent)');
    return;
  }

  // mode === 'article' → force a real post (re-send even if already announced)
  console.log(`\n→ Posting article #${articleId} to the group (force)…`);
  const res = await telegram.notifyArticlePublished(articleId, { force: true });
  console.log(res.ok
    ? `✅ Posted. message_id=${res.messageId}`
    : `❌ Not sent: ${res.error || res.skipped}`);
  process.exitCode = res.ok ? 0 : 1;
}

main()
  .catch((err) => { console.error('❌ Unexpected error:', err.message); process.exitCode = 1; })
  .finally(async () => { await sequelize.close().catch(() => {}); });

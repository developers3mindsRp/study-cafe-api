#!/usr/bin/env node
/**
 * Interactive guard for `npm run dev:prod`.
 *
 * Running the local stack against .env.production means every write hits the real
 * database and the outbox worker delivers real email to real learners. That should
 * never happen by muscle memory, so this prompt forces an explicit, typed decision
 * and shows exactly which database and SMTP host are about to be used.
 *
 * Exits 0 to continue, non-zero to abort (which stops the npm chain).
 * Set PROD_CONFIRM=yes to bypass in automation.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');

const ENV_FILE = path.resolve(__dirname, '../.env.production');
const RED = '\x1b[41m\x1b[97m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

if (!fs.existsSync(ENV_FILE)) {
  console.error(`\n${RED} .env.production not found ${RESET}\n`);
  console.error(`Expected at: ${ENV_FILE}`);
  console.error('Create it from .env.example and fill in the production values.\n');
  process.exit(1);
}

const cfg = dotenv.parse(fs.readFileSync(ENV_FILE));
const dbHost = cfg.MYSQL_HOST || '(unset)';
const dbName = cfg.MYSQL_DATABASE || '(unset)';
const smtpHost = cfg.SMTP_HOST || '(unset)';
const smtpLive = smtpHost !== '(unset)' && !/^(127\.0\.0\.1|localhost)$/i.test(smtpHost);

console.log(`\n${RED}  ⚠  YOU ARE ABOUT TO RUN THE LOCAL STACK AGAINST PRODUCTION  ${RESET}\n`);
console.log(`${YELLOW}  Database : ${dbHost} / ${dbName}${RESET}`);
console.log(`${YELLOW}  SMTP     : ${smtpHost}${smtpLive ? '   << REAL EMAIL WILL BE DELIVERED TO REAL USERS' : ''}${RESET}`);
console.log(`\n${DIM}  Every write — allotments, orders, deletions — affects live data.`);
console.log(`  For a one-off script prefer:  npm run script:prod -- scripts/<file>.js --args${RESET}\n`);

if ((process.env.PROD_CONFIRM || '').toLowerCase() === 'yes') {
  console.log(`${DIM}  PROD_CONFIRM=yes set — continuing without prompt.${RESET}\n`);
  process.exit(0);
}

if (!process.stdin.isTTY) {
  console.error('  Refusing to start: no TTY to confirm on. Set PROD_CONFIRM=yes to override.\n');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('  Type "production" to continue, anything else aborts: ', (answer) => {
  rl.close();
  if (answer.trim().toLowerCase() === 'production') {
    console.log(`\n${YELLOW}  Continuing against production…${RESET}\n`);
    process.exit(0);
  }
  console.log('\n  Aborted. Nothing was started.\n');
  process.exit(1);
});

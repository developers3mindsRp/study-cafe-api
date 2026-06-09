/**
 * Merges duplicate roles (same name) into one canonical row per name,
 * reassigns users, deletes extras, and adds UNIQUE(name) if missing.
 *
 * Usage: node scripts/dedupe-roles.js
 */
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  const [dupNames] = await conn.query(
    'SELECT name FROM roles GROUP BY name HAVING COUNT(*) > 1'
  );

  if (!dupNames.length) {
    console.log('No duplicate role names found.');
  } else {
    console.log(`Found ${dupNames.length} role name(s) with duplicates. Merging...`);
  }

  for (const { name } of dupNames) {
    const [rows] = await conn.query(
      `SELECT r.id, COUNT(u.id) AS user_count
       FROM roles r
       LEFT JOIN users u ON u.role_id = r.id
       WHERE r.name = ?
       GROUP BY r.id
       ORDER BY user_count DESC, r.id ASC`,
      [name]
    );
    if (rows.length <= 1) continue;

    const keepId = rows[0].id;
    const dropIds = rows.slice(1).map((r) => r.id);
    console.log(`  ${name}: keep id=${keepId}, remove ids=[${dropIds.join(', ')}]`);

    for (const dropId of dropIds) {
      await conn.query('UPDATE users SET role_id = ? WHERE role_id = ?', [keepId, dropId]);
      await conn.query('DELETE FROM roles WHERE id = ?', [dropId]);
    }
  }

  try {
    await conn.query('ALTER TABLE roles ADD UNIQUE KEY uk_roles_name (name)');
    console.log('Added UNIQUE index uk_roles_name on roles.name');
  } catch (err) {
    if (String(err.message).includes('Duplicate key name') || String(err.message).includes('already exists')) {
      console.log('UNIQUE index uk_roles_name already exists.');
    } else {
      throw err;
    }
  }

  const [after] = await conn.query('SELECT COUNT(*) AS c FROM roles');
  console.log(`Done. roles table now has ${after[0].c} row(s).`);
  await conn.end();
}

main().catch((err) => {
  console.error('Dedupe failed:', err.message);
  process.exit(1);
});

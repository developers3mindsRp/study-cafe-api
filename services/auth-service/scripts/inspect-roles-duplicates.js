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

  const [rows] = await conn.query(
    'SELECT id, name, is_system, is_admin_panel FROM roles ORDER BY id'
  );
  console.log('total roles:', rows.length);

  const [dups] = await conn.query(
    'SELECT name, COUNT(*) AS c FROM roles GROUP BY name HAVING c > 1 ORDER BY c DESC'
  );
  console.log('duplicate names:', dups);

  const [userRoles] = await conn.query(
    "SELECT r.id, r.name, COUNT(u.id) AS user_count FROM roles r LEFT JOIN users u ON u.role_id = r.id WHERE r.name = 'user' GROUP BY r.id, r.name ORDER BY user_count DESC LIMIT 20"
  );
  console.log('user role rows (top 20 by user_count):', userRoles);

  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

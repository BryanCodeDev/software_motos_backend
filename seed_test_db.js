const mysql = require('mysql2/promise');
const fs = require('fs');

(async () => {
  const conn = await mysql.createConnection({
    host: 'localhost', port: 3307, user: 'root', password: 'Santimajo101219@', database: 'emergency_id_test',
  });
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  const [tables] = await conn.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'emergency_id_test'");
  for (const t of tables) { await conn.query('DROP TABLE IF EXISTS `' + t.TABLE_NAME + '`'); }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  const strip = (sql) => sql.replace(/USE\s+emergency_id_test\s*;/gi, '').replace(/USE\s+emergency_id\s*;/gi, '');
  const schema = strip(fs.readFileSync(__dirname + '/migrations/schema.sql', 'utf8'));
  const seed = strip(fs.readFileSync(__dirname + '/migrations/seed.sql', 'utf8'));
  const split = (sql) => sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (const stmt of split(schema)) { await conn.query(stmt); }
  for (const stmt of split(seed)) { await conn.query(stmt); }
  const [users] = await conn.query('SELECT COUNT(*) AS c FROM users');
  const [orders] = await conn.query('SELECT COUNT(*) AS c FROM orders');
  const [ids] = await conn.query('SELECT COUNT(*) AS c FROM identifiers');
  const [profiles] = await conn.query('SELECT COUNT(*) AS c FROM emergency_profiles');
  const [products] = await conn.query('SELECT id, name, slug, price, currency, is_purchasable FROM products');
  console.log('SEED OK:', { users: users[0].c, orders: orders[0].c, identifiers: ids[0].c, profiles: profiles[0].c, products });
  await conn.end();
})().catch(e => { console.error('SEED FAIL:', e.message); process.exit(1); });
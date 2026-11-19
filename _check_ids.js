const db = require('./src/config/db');
(async () => {
  // Ver qué IDs existen en identifiers
  const rows = await db.query('SELECT id, value, user_id, status FROM identifiers ORDER BY id LIMIT 10');
  console.log('IDENTIFIERS (primeros 10):');
  rows.forEach(r => console.log(`  id=${r.id}, value=${r.value}, user_id=${r.user_id}, status=${r.status}`));
  
  // Ver el count total
  const [count] = await db.query('SELECT COUNT(*) as total FROM identifiers');
  console.log(`\nTotal identifiers: ${count[0].total}`);
  
  await db.close();
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

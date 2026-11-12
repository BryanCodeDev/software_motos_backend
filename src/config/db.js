const mysql = require('mysql2/promise');
const config = require('./index');

let pool = null;

const buildUrl = () => {
  if (config.databaseUrl) {return config.databaseUrl;}
  const { host, port, user, password, database } = config.db;
  return `mysql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
};

const getPool = () => {
  if (!pool) {
    pool = mysql.createPool(buildUrl());
  }
  return pool;
};

const query = async (sql, params = []) => {
  const conn = getPool();
  const [rows] = await conn.query(sql, params);
  return rows;
};

const ignoreDup = (err) =>
  err && (err.code === 'ER_DUP_FIELD' || err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME' || err.errno === 1060 || err.errno === 1061 || err.errno === 1050);

// Garantiza columnas de permanencia/impresión de QR en bases de datos existentes.
// Las bases nuevas las crean ya con estas columnas via schema.sql.
const ensureIdentifierColumns = async () => {
  try {
    await query(
      "ALTER TABLE identifiers ADD COLUMN activation_at TIMESTAMP NULL DEFAULT NULL AFTER status"
    );
  } catch (e) { if (!ignoreDup(e)) throw e; }
  try {
    await query(
      "ALTER TABLE identifiers ADD COLUMN print_status ENUM('pending_print','sent_to_print','printed','delivered') NOT NULL DEFAULT 'pending_print' AFTER activation_at"
    );
  } catch (e) { if (!ignoreDup(e)) throw e; }
  try {
    await query("CREATE INDEX idx_identifiers_print_status ON identifiers(print_status)");
  } catch (e) { if (!ignoreDup(e)) throw e; }
  try {
    await query("CREATE INDEX idx_identifiers_user_print ON identifiers(user_id, print_status)");
  } catch (e) { if (!ignoreDup(e)) throw e; }
  try {
    await query(
      "ALTER TABLE identifiers ADD COLUMN _one_active_per_user INT UNSIGNED AS (CASE WHEN status IN ('pending_activation','active') THEN user_id END) VIRTUAL AFTER print_status"
    );
  } catch (e) { if (!ignoreDup(e)) throw e; }
  try {
    await query("CREATE UNIQUE INDEX uq_identifiers_one_active_per_user ON identifiers(_one_active_per_user)");
  } catch (e) { if (!ignoreDup(e)) throw e; }
};

const getConnection = async () => getPool().getConnection();

const close = async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};

module.exports = { query, getConnection, close, getPool, buildUrl, ensureIdentifierColumns };

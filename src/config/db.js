const mysql = require('mysql2/promise');
const config = require('./index');

let pool = null;

const buildUrl = () => {
  if (config.databaseUrl) return config.databaseUrl;
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

const getConnection = async () => getPool().getConnection();

const close = async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};

module.exports = { query, getConnection, close, getPool, buildUrl };

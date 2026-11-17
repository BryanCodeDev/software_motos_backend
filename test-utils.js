const http = require('http');
const https = require('https');
const crypto = require('crypto');
const db = require('./src/config/db');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:4001';

const request = (method, path, { body, headers = {}, cookie } = {}) =>
  new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const lib = url.protocol === 'https:' ? https : http;
    const data = body ? JSON.stringify(body) : null;
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...headers,
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        let chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = raw ? JSON.parse(raw) : null; } catch {}
          resolve({ status: res.statusCode, headers: res.headers, body: json, raw, setCookie: res.headers['set-cookie'] });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });

const extractCookie = (setCookie) => {
  if (!setCookie) return '';
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  return arr.map((c) => c.split(';')[0]).join('; ');
};

const login = async (email, password) => {
  const r = await request('POST', '/api/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { cookie: extractCookie(r.setCookie), user: r.body.user };
};

const dbq = async (sql, params = []) => {
  const rows = await db.query(sql, params);
  return rows;
};

const dbone = async (sql, params = []) => {
  const rows = await dbq(sql, params);
  return rows[0] || null;
};

const signWebhook = (dataId, requestId, ts, secret) => {
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
};

const resetDb = async () => {
  const dbName = process.env.DB_NAME || 'emergency_id_test';
  // Autoprovisionar la base de pruebas si no existe (bases aisladas por archivo).
  const mysql = require('mysql2/promise');
  const adminConn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3307,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'Santimajo101219@',
    multipleStatements: true,
  });
  try {
    await adminConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally { adminConn.release(); }

  const conn = await db.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    const [tables] = await conn.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [dbName]);
    for (const t of tables) { await conn.query('DROP TABLE IF EXISTS `' + t.TABLE_NAME + '`'); }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally { conn.release(); }
  const fs = require('fs');
  const strip = (s) => s.replace(/USE\s+`[^`]+`\s*;/gi, '').replace(/USE\s+[`\w]+\s*;/gi, '');
  const schema = strip(fs.readFileSync(__dirname + '/migrations/schema.sql', 'utf8'));
  const seed = strip(fs.readFileSync(__dirname + '/migrations/seed.sql', 'utf8'));
  const split = (s) => s.split(';').map(x => x.trim()).filter(x => x.length);
  const ignoreDup = (err) => err && (err.code === 'ER_DUP_KEYNAME' || err.code === 'ER_TABLE_EXISTS' || err.code === 'ER_DUP_FIELD' || err.code === 'ER_DUP_FIELDNAME' || err.errno === 1061 || err.errno === 1050 || err.errno === 1060);
  for (const stmt of split(schema)) {
    try { await db.query(stmt); } catch (err) { if (!ignoreDup(err)) throw err; }
  }
  for (const stmt of split(seed)) {
    try { await db.query(stmt); } catch (err) { if (!ignoreDup(err)) throw err; }
  }
  // Garantizar columnas de permanencia/impresión aunque la tabla ya existiera sin ellas.
  try {
    await db.query("ALTER TABLE identifiers ADD COLUMN print_status ENUM('pending_print','sent_to_print','printed','delivered') NOT NULL DEFAULT 'pending_print' AFTER activation_at");
  } catch (err) { if (!ignoreDup(err)) throw err; }
  try {
    await db.query("ALTER TABLE identifiers ADD COLUMN activation_at TIMESTAMP NULL DEFAULT NULL AFTER status");
  } catch (err) { if (!ignoreDup(err)) throw err; }
};

module.exports = { request, extractCookie, login, dbq, dbone, signWebhook, resetDb, BASE };

/**
 * migrate.js — Gestor de base de datos para emergency_id
 *
 * Ya no hay migraciones incrementales: schema.sql es el esquema completo
 * (usuarios, perfiles de emergencia, contactos, QR, pedidos, pagos,
 * auditoría, consentimientos y solicitudes de derechos).
 *
 * Uso: node migrations/migrate.js [comando] [--seed]
 * Comandos:
 *   up      (por defecto) crea la base y aplica schema.sql si aún no existe el esquema
 *   status  muestra el estado del esquema y filas por tabla
 *   seed    carga seed.sql (datos de ejemplo; no permitido en producción)
 *   reset   elimina la base y la recrea desde schema.sql (no permitido en producción)
 *           con --seed carga además los datos de ejemplo
 *
 * Requiere: mysql2 y las variables DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 * (si existe dotenv, se lee también el archivo ../.env)
 */

'use strict';

const fs = require('fs');
const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {
  /* dotenv es opcional */
}

const mysql2 = require('mysql2/promise');

// ─── Configuración ──────────────────────────────────────────────
const SQL_DIR = __dirname;
const SCHEMA_FILE = 'schema.sql';
const SEED_FILE = 'seed.sql';

// Tabla marcadora para saber si el esquema ya está aplicado
const SCHEMA_MARKER_TABLE = 'users';

// ─── Conexión ────────────────────────────────────────────────────
function getDbConfig() {
  const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
  if (url && /^mysql:\/\//i.test(url)) {
    try {
      const u = new URL(url);
      return {
        host: u.hostname,
        port: parseInt(u.port || '3306', 10),
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        database: u.pathname.replace(/^\//, '') || undefined,
      };
    } catch (_) {
      console.warn('[MIGRATE] MYSQL_URL/DATABASE_URL inválida; uso variables sueltas.');
    }
  }
  return {
    host: process.env.DB_HOST || process.env.MYSQLHOST || process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || process.env.MYSQLPORT || process.env.MYSQL_PORT || '3306', 10),
    user: process.env.DB_USER || process.env.MYSQLUSER || process.env.MYSQL_USER || 'root',
    password:
      process.env.DB_PASSWORD ||
      process.env.MYSQLPASSWORD ||
      process.env.MYSQL_PASSWORD ||
      process.env.MYSQL_ROOT_PASSWORD ||
      '',
    database:
      process.env.DB_NAME ||
      process.env.MYSQLDATABASE ||
      process.env.MYSQL_DATABASE ||
      process.env.MYSQL_DB,
  };
}

function getDbName() {
  return getDbConfig().database || 'emergency_id';
}

async function createConnection() {
  const { host, port, user, password } = getDbConfig();
  const conn = await mysql2.createConnection({
    host,
    port,
    user,
    password,
    multipleStatements: true,
    charset: 'UTF8MB4_UNICODE_CI',
    connectTimeout: 10000,
  });
  await conn.query('SET NAMES utf8mb4');
  return conn;
}

// ─── Helpers ────────────────────────────────────────────────────
async function ensureDatabase(conn) {
  const dbName = getDbName();
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await conn.query(`USE \`${dbName}\``);
}

async function tableExists(conn, name) {
  const [rows] = await conn.query(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
    [getDbName(), name]
  );
  return rows[0].n > 0;
}

// 'none' = sin esquema · 'current' = esquema aplicado
async function schemaState(conn) {
  if (await tableExists(conn, SCHEMA_MARKER_TABLE)) return 'current';
  return 'none';
}

function readSQLFile(filename) {
  const filePath = path.join(SQL_DIR, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Archivo no encontrado: ${filePath}`);
  let sql = fs.readFileSync(filePath, 'utf8');
  if (sql.charCodeAt(0) === 0xFEFF) sql = sql.slice(1);
  return sql;
}

// Quita CREATE DATABASE / USE del script para que use la base configurada en DB_NAME
function stripCreateDatabaseAndUse(sql) {
  return sql
    .replace(/^\s*CREATE\s+DATABASE\s+IF\s+NOT\s+EXISTS\s+[`\w]+[^;]*;/gim, '')
    .replace(/^\s*USE\s+[`\w]+\s*;/gim, '');
}

function assertNotProduction(action) {
  if (process.env.NODE_ENV === 'production') {
    console.error(`ERROR: ${action} no está permitido en producción.`);
    process.exit(1);
  }
}

// ─── Comandos ────────────────────────────────────────────────────

async function applySchema(conn) {
  console.log(`Aplicando ${SCHEMA_FILE}...`);
  await conn.query(stripCreateDatabaseAndUse(readSQLFile(SCHEMA_FILE)));
  console.log('Esquema aplicado.');
}

async function applySeed(conn) {
  console.log(`Aplicando ${SEED_FILE}...`);
  await conn.query(stripCreateDatabaseAndUse(readSQLFile(SEED_FILE)));
  console.log('Seed aplicado correctamente.');
}

async function cmdUp() {
  const conn = await createConnection();
  try {
    await ensureDatabase(conn);
    // schema.sql usa CREATE TABLE IF NOT EXISTS para todas las tablas, por lo que
    // aplicarlo siempre es idempotente y crea las tablas que faltasen (p. ej. en
    // bases creadas con versiones anteriores del esquema que no incluían
    // consent_records, data_requests, qr_inventory_*, etc.).
    await applySchema(conn);
  } finally {
    await conn.end();
  }
}

async function cmdStatus() {
  const conn = await createConnection();
  try {
    await ensureDatabase(conn);
    console.log(`\n=== ESTADO DE LA BASE DE DATOS (${getDbName()}) ===`);

    const state = await schemaState(conn);
    if (state === 'none') {
      console.log('Esquema NO aplicado. Ejecuta: node migrations/migrate.js up\n');
      return;
    }

    const [tables] = await conn.query(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name`,
      [getDbName()]
    );
    console.log(`Esquema aplicado: ${tables.length} tablas\n`);
    for (const { name } of tables) {
      const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${name}\``);
      console.log(`  ${name.padEnd(35)} ${n}`);
    }
    console.log('');
  } finally {
    await conn.end();
  }
}

async function cmdSeed() {
  assertNotProduction('seed');

  const conn = await createConnection();
  try {
    await ensureDatabase(conn);
    const state = await schemaState(conn);
    if (state === 'none') {
      console.error('ERROR: el esquema no está aplicado. Ejecuta primero: node migrations/migrate.js up');
      process.exit(1);
    }
    await applySeed(conn);
  } finally {
    await conn.end();
  }
}

async function cmdReset(withSeed) {
  assertNotProduction('reset');

  const conn = await createConnection();
  try {
    const dbName = getDbName();
    console.log(`Eliminando base de datos ${dbName}...`);
    await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    console.log('Base de datos eliminada. Recreando...');
    await ensureDatabase(conn);
    await applySchema(conn);
    if (withSeed) await applySeed(conn);
    console.log('Base de datos restablecida.');
  } finally {
    await conn.end();
  }
}

// ─── CLI ─────────────────────────────────────────────────────────
const command = process.argv[2] || 'up';
const flags = process.argv.slice(3);

(async () => {
  try {
    switch (command) {
      case 'up': await cmdUp(); break;
      case 'status': await cmdStatus(); break;
      case 'seed': await cmdSeed(); break;
      case 'reset': await cmdReset(flags.includes('--seed')); break;
      default:
        console.error(`Comando desconocido: ${command}`);
        console.error('Comandos disponibles: up, status, seed, reset [--seed]');
        process.exit(1);
    }
  } catch (err) {
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);
    process.exit(1);
  }
})();

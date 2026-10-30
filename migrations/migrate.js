/**
 * migrate.js — Gestor de base de datos para emergency_id
 *
 * schema.sql es el esquema completo (usuarios, sesiones, perfiles de emergencia,
 * contactos, privacidad, identificadores QR, productos, pedidos, pagos,
 * auditoría y alertas).
 *
 * Uso: node migrations/migrate.js [comando] [--seed]
 * Comandos:
 *   up      (por defecto) aplica schema.sql si no existe el esquema y luego seed.sql
 *           si no hay usuarios (SEED_ON_UP=false lo desactiva)
 *   status  muestra el estado del esquema, filas por tabla y un resumen de datos
 *   seed    carga seed.sql (datos de ejemplo; no permitido en producción)
 *   reset   elimina la base y la recrea desde schema.sql (no permitido en producción)
 *           con --seed carga además los datos de ejemplo
 *
 * Conexión (en este orden de prioridad):
 *   1. MYSQL_URL o DATABASE_URL  (mysql://user:pass@host:port/db)
 *   2. DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME
 *   3. MYSQLHOST/MYSQLPORT/MYSQLUSER/MYSQLPASSWORD/MYSQLDATABASE
 *
 * IMPORTANTE: NO se usa RAILWAY_PRIVATE_DOMAIN. Esa variable es el dominio del
 * servicio actual (el backend), no el de MySQL.
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
// Los .sql viven en database/ (ajusta si los tienes en otra carpeta)
const SQL_DIR = fs.existsSync(path.join(__dirname, '..', 'database', 'schema.sql'))
  ? path.join(__dirname, '..', 'database')
  : __dirname;
const SCHEMA_FILE = 'schema.sql';
const SEED_FILE = 'seed.sql';

// Tablas que debe tener el esquema completo (en orden de creación)
const EXPECTED_TABLES = [
  'users',
  'user_sessions',
  'password_reset_tokens',
  'emergency_profiles',
  'emergency_contacts',
  'privacy_settings',
  'identifiers',
  'products',
  'product_variants',
  'orders',
  'order_items',
  'payment_events',
  'audit_logs',
  'alert_configs',
  'alert_events',
];

// ─── Configuración de conexión ───────────────────────────────────
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
  return getDbConfig().database || 'railway';
}

// ─── Conexión ────────────────────────────────────────────────────
async function createConnection() {
  const { host, port, user, password } = getDbConfig();
  console.log(`[MIGRATE] host=${host} port=${port} user=${user} db=${getDbName()}`);
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

async function listTables(conn) {
  const [rows] = await conn.query(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name`,
    [getDbName()]
  );
  return rows.map(r => r.name);
}

// 'none' = sin tablas · 'partial' = faltan tablas · 'current' = esquema completo
async function schemaState(conn) {
  const existing = new Set(await listTables(conn));
  const missing = EXPECTED_TABLES.filter(t => !existing.has(t));
  if (missing.length === 0) return { state: 'current', missing };
  if (missing.length === EXPECTED_TABLES.length) return { state: 'none', missing };
  return { state: 'partial', missing };
}

function readSQLFile(filename) {
  const filePath = path.join(SQL_DIR, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Archivo no encontrado: ${filePath}`);
  let sql = fs.readFileSync(filePath, 'utf8');
  if (sql.charCodeAt(0) === 0xFEFF) sql = sql.slice(1);
  return sql;
}

// Quita CREATE DATABASE / USE del script para que use la base configurada
function stripCreateDatabaseAndUse(sql) {
  return sql
    .replace(/^\s*CREATE\s+DATABASE\s+IF\s+NOT\s+EXISTS\s+[`\w]+[^;]*;/gim, '')
    .replace(/^\s*USE\s+[`\w]+\s*;/gim, '');
}

function assertNotProduction(action) {
  if (process.env.NODE_ENV === 'production') {
    if (process.env.ALLOW_PROD_SEED === 'true' && (action === 'seed' || action === 'reset')) {
      console.warn(`ADVERTENCIA: ${action} permitido en producción por ALLOW_PROD_SEED=true`);
      return;
    }
    console.error(`ERROR: ${action} no está permitido en producción.`);
    process.exit(1);
  }
}

function partialMessage(missing) {
  return (
    `La base "${getDbName()}" tiene un esquema incompleto. Faltan: ${missing.join(', ')}.\n` +
    'En desarrollo: node migrations/migrate.js reset --seed\n' +
    'Con datos que debas conservar no existe migración automática: hay que aplicar los CREATE/ALTER a mano.'
  );
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

// Aplica el seed esencial solo si no hay usuarios (idempotente entre despliegues).
// Desactivar con SEED_ON_UP=false
async function seedIfEmpty(conn) {
  if (process.env.SEED_ON_UP === 'false') {
    console.log('SEED_ON_UP=false: se omite el seed.');
    return;
  }
  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM users');
  if (n > 0) {
    console.log(`Seed omitido: la base ya tiene ${n} usuario(s).`);
    return;
  }
  await applySeed(conn);
}

async function cmdUp() {
  const conn = await createConnection();
  try {
    await ensureDatabase(conn);
    const { state, missing } = await schemaState(conn);
    if (state === 'partial') {
      console.error(partialMessage(missing));
      process.exit(1);
    }
    if (state === 'none') {
      await applySchema(conn);
    } else {
      console.log(`El esquema ya existe en "${getDbName()}".`);
    }
    await seedIfEmpty(conn);
  } finally {
    await conn.end();
  }
}

async function cmdStatus() {
  const conn = await createConnection();
  try {
    await ensureDatabase(conn);
    console.log(`\n=== ESTADO DE LA BASE DE DATOS (${getDbName()}) ===`);

    const { state, missing } = await schemaState(conn);
    if (state === 'none') {
      console.log('Esquema NO aplicado. Ejecuta: node migrations/migrate.js up\n');
      return;
    }
    if (state === 'partial') console.log(`ADVERTENCIA: ${partialMessage(missing)}\n`);

    const tables = await listTables(conn);
    console.log(`Esquema ${state === 'current' ? 'completo' : 'incompleto'}: ${tables.length} tablas\n`);
    for (const name of tables) {
      const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${name}\``);
      console.log(`  ${name.padEnd(28)} ${n}`);
    }

    if (state !== 'current') return;

    const [[u]] = await conn.query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(role = 'admin'), 0) AS admins,
              COALESCE(SUM(email_verified = 1), 0) AS verificados
       FROM users`
    );
    const [[p]] = await conn.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(is_active = 1), 0) AS activos FROM emergency_profiles`
    );
    const [ids] = await conn.query(
      `SELECT status, COUNT(*) AS n FROM identifiers GROUP BY status ORDER BY status`
    );
    const [orders] = await conn.query(
      `SELECT payment_status, COUNT(*) AS n FROM orders GROUP BY payment_status ORDER BY payment_status`
    );

    console.log('\nResumen:');
    console.log(`  usuarios        total=${u.total} admins=${u.admins} verificados=${u.verificados}`);
    console.log(`  perfiles        total=${p.total} activos=${p.activos}`);
    console.log(`  identificadores ${ids.length ? ids.map(r => `${r.status}=${r.n}`).join(' ') : '-'}`);
    console.log(`  pedidos         ${orders.length ? orders.map(r => `${r.payment_status}=${r.n}`).join(' ') : '-'}`);
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
    const { state, missing } = await schemaState(conn);
    if (state === 'none') {
      console.error('ERROR: el esquema no está aplicado. Ejecuta primero: node migrations/migrate.js up');
      process.exit(1);
    }
    if (state === 'partial') {
      console.error(partialMessage(missing));
      process.exit(1);
    }

    // El seed no es idempotente (emails únicos): evitamos un error a medias
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM users');
    if (n > 0) {
      console.error(`ERROR: la base "${getDbName()}" ya tiene ${n} usuario(s); el seed fallaría por duplicados.`);
      console.error('Para recargar datos de ejemplo usa: node migrations/migrate.js reset --seed');
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
    process.exit(1);
  }
})();
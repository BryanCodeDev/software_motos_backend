/**
 * migrate.js — Gestor de base de datos para emergency_id
 *
 * Aplica schema.sql y los archivos de migración numerados en la carpeta migrations/
 * en cada despliegue. Nunca ejecuta seed.sql y nunca elimina datos.
 *
 * Uso: node migrations/migrate.js [comando]
 * Comandos:
 *   up      (por defecto) aplica schema.sql y migraciones pendientes
 *   status  muestra el estado del esquema
 *
 * Conexión (en este orden de prioridad):
 *   1. MYSQL_URL o DATABASE_URL  (mysql://user:pass@host:port/db)
 *   2. DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME
 *   3. MYSQLHOST/MYSQLPORT/MYSQLUSER/MYSQLPASSWORD/MYSQLDATABASE
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

// Directorio donde están los archivos .sql
const SQL_DIR = fs.existsSync(path.join(__dirname, '..', 'database', 'schema.sql'))
  ? path.join(__dirname, '..', 'database')
  : __dirname;
const SCHEMA_FILE = 'schema.sql';

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

async function ensureDatabase(conn) {
  const dbName = getDbName();
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await conn.query(`USE \`${dbName}\``);
}

function readSQLFile(filename) {
  const filePath = path.join(SQL_DIR, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Archivo no encontrado: ${filePath}`);
  let sql = fs.readFileSync(filePath, 'utf8');
  if (sql.charCodeAt(0) === 0xFEFF) sql = sql.slice(1);
  return sql;
}

function stripCreateDatabaseAndUse(sql) {
  return sql
    .replace(/^\s*CREATE\s+DATABASE\s+IF\s+NOT\s+EXISTS\s+[`\w]+[^;]*;/gim, '')
    .replace(/^\s*USE\s+[`\w]+\s*;/gim, '');
}

async function applySchema(conn) {
  console.log(`Aplicando ${SCHEMA_FILE}...`);
  await conn.query(stripCreateDatabaseAndUse(readSQLFile(SCHEMA_FILE)));
  console.log('Esquema aplicado.');
}

async function applyMigrations(conn) {
  // Tabla de control de migraciones aplicadas (idempotente)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [appliedRows] = await conn.query('SELECT filename FROM schema_migrations');
  const appliedSet = new Set(appliedRows.map(r => r.filename));

  // Archivos de migración numerados en la carpeta migrations/, excluidos schema.sql y seed.sql
  const migrationFiles = fs
    .readdirSync(__dirname)
    .filter(f => f.endsWith('.sql') && f !== 'schema.sql' && f !== 'seed.sql')
    .sort();

  for (const file of migrationFiles) {
    if (appliedSet.has(file)) {
      console.log(`Migración ${file} ya aplicada, saltando.`);
      continue;
    }
    console.log(`Aplicando migración ${file}...`);
    await conn.query(readSQLFile(file));
    await conn.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
    console.log(`Migración ${file} aplicada.`);
  }
}

async function cmdUp() {
  const conn = await createConnection();
  try {
    await ensureDatabase(conn);
    await applySchema(conn);
    await applyMigrations(conn);
    console.log('Base de datos actualizada.');
  } finally {
    await conn.end();
  }
}

async function cmdStatus() {
  const conn = await createConnection();
  try {
    await ensureDatabase(conn);
    console.log(`\n=== ESTADO DE LA BASE DE DATOS (${getDbName()}) ===`);
    const [tables] = await conn.query(
      `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name`,
      [getDbName()]
    );
    console.log(`Tablas: ${tables.length}`);
    for (const t of tables) {
      console.log(`  ${t.name}`);
    }
    const [migs] = await conn.query(
      `SELECT filename FROM schema_migrations ORDER BY applied_at`
    ).catch(() => []);
    if (migs.length > 0) {
      console.log('\nMigraciones aplicadas:');
      for (const m of migs) {
        console.log(`  ${m.filename}`);
      }
    }
    console.log('');
  } finally {
    await conn.end();
  }
}

const command = process.argv[2] || 'up';

(async () => {
  try {
    switch (command) {
      case 'up': await cmdUp(); break;
      case 'status': await cmdStatus(); break;
      default:
        console.error(`Comando desconocido: ${command}`);
        console.error('Comandos disponibles: up, status');
        process.exit(1);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();

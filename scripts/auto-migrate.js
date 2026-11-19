"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const mysql2 = require("mysql2/promise");

try {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
} catch (_) {}

process.env.NODE_ENV = process.env.NODE_ENV || "production";

const ROOT = path.join(__dirname, "..");
const MAX_ATTEMPTS = parseInt(process.env.MIGRATE_MAX_ATTEMPTS || "10", 10);
const WAIT_MS = 5000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function runMigrate(command) {
  console.log(`\n[AUTO-MIGRATE] >>> node migrations/migrate.js ${command}`);
  const res = spawnSync(process.execPath, ["migrations/migrate.js", command], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  const ok = res.status === 0;
  console.log(ok ? "[AUTO-MIGRATE] <<< OK" : `[AUTO-MIGRATE] <<< ERROR (código ${res.status})`);
  return ok;
}

// Ejecuta el seed automático de diseños de stickers para que estén
// disponibles en producción sin intervención manual. Es idempotente.
function runSeedDesigns() {
  console.log("\n[AUTO-MIGRATE] >>> node migrations/seed-designs.js");
  const res = spawnSync(process.execPath, ["migrations/seed-designs.js"], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  const ok = res.status === 0;
  console.log(ok ? "[AUTO-MIGRATE] <<< OK (diseños listos)" : `[AUTO-MIGRATE] <<< AVISO (código ${res.status})`);
  return ok;
}

// Ejecuta migrations/seed.sql (productos, paquetes, usuario admin, etc.)
// contra la base de datos configurada. Idempotente.
async function runSeedSql() {
  console.log("\n[AUTO-MIGRATE] >>> ejecutando migrations/seed.sql");
  const filePath = path.join(ROOT, "migrations", "seed.sql");
  if (!fs.existsSync(filePath)) {
    console.log("[AUTO-MIGRATE] <<< AVISO: seed.sql no encontrado, omitiendo");
    return true;
  }
  let conn;
  try {
    const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
    let dbConfig;
    if (url && /^mysql:\/\//i.test(url)) {
      const u = new URL(url);
      dbConfig = {
        host: u.hostname,
        port: parseInt(u.port || '3306', 10),
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        database: u.pathname.replace(/^\//, '') || undefined,
        multipleStatements: true,
        charset: 'UTF8MB4_UNICODE_CI',
        connectTimeout: 10000,
      };
    } else {
      dbConfig = {
        host: process.env.DB_HOST || process.env.MYSQLHOST || process.env.MYSQL_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || process.env.MYSQLPORT || process.env.MYSQL_PORT || '3306', 10),
        user: process.env.DB_USER || process.env.MYSQLUSER || process.env.MYSQL_USER || 'root',
        password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || process.env.MYSQL_ROOT_PASSWORD || '',
        database: process.env.DB_NAME || process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || process.env.MYSQL_DB || 'emergency_id',
        multipleStatements: true,
        charset: 'UTF8MB4_UNICODE_CI',
        connectTimeout: 10000,
      };
    }
    conn = await mysql2.createConnection(dbConfig);
    await conn.query('SET NAMES utf8mb4');
    const sql = fs.readFileSync(filePath, 'utf8');
    const cleaned = sql
      .replace(/^\s*CREATE\s+DATABASE\s+IF\s+NOT\s+EXISTS\s+[`\w]+[^;]*;/gim, '')
      .replace(/^\s*USE\s+[`\w]+\s*;/gim, '');
    await conn.query(cleaned);
    console.log("[AUTO-MIGRATE] <<< OK (seed.sql ejecutado)");
    return true;
  } catch (err) {
    console.error(`[AUTO-MIGRATE] <<< ERROR ejecutando seed.sql: ${err.message}`);
    return false;
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

(async () => {
  console.log("==============================================");
  console.log("[AUTO-MIGRATE] INICIANDO MIGRACIONES AUTOMATICAS");
  console.log("[AUTO-MIGRATE] Modo: esquema + seed automático de diseños y catálogo (sin reset, sin borrado de datos)");
  console.log("[AUTO-MIGRATE] NODE_ENV=" + process.env.NODE_ENV);
  console.log("[AUTO-MIGRATE] MYSQL_URL=" + (process.env.MYSQL_URL ? "[SET]" : "[NOT SET]"));
  console.log("[AUTO-MIGRATE] DATABASE_URL=" + (process.env.DATABASE_URL ? "[SET]" : "[NOT SET]"));
  console.log("==============================================\n");

  // Pequeña espera para que MySQL esté listo en el arranque conjunto
  await sleep(3000);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[AUTO-MIGRATE] Intento ${attempt}/${MAX_ATTEMPTS}...`);
    if (runMigrate("up")) {
      runMigrate("status");
      // Seed automático de diseños de stickers (idempotente, no borra datos).
      runSeedDesigns();
      // Seed automático del catálogo: productos, paquetes y usuario admin (idempotente).
      await runSeedSql();
      console.log("\n[AUTO-MIGRATE] MIGRACIONES COMPLETADAS. INICIANDO SERVIDOR...\n");
      process.exit(0);
    }
    if (attempt < MAX_ATTEMPTS) {
      console.log(`[AUTO-MIGRATE] Reintentando en ${WAIT_MS / 1000}s...`);
      await sleep(WAIT_MS);
    }
  }

  // No arrancar el servidor sin base de datos: Railway marcará el deploy como fallido
  console.error("[AUTO-MIGRATE] No se pudo conectar/migrar tras varios intentos. Abortando.");
  process.exit(1);
})();

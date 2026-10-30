"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

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

(async () => {
  console.log("==============================================");
  console.log("[AUTO-MIGRATE] INICIANDO MIGRACIONES AUTOMATICAS");
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
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

try {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
} catch (_) {}

function run(cmd, args) {
  console.log("\n[AUTO-MIGRATE] >>> " + cmd + " " + args.join(" "));
  const result = spawnSync(process.execPath, args, {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    console.error("[AUTO-MIGRATE] <<< ERROR: proceso termino con codigo " + result.status);
    return false;
  }
  console.log("[AUTO-MIGRATE] <<< OK");
  return true;
}

console.log("==============================================");
console.log("[AUTO-MIGRATE] INICIANDO MIGRACIONES AUTOMATICAS");
console.log("==============================================");
console.log("[AUTO-MIGRATE] NODE_ENV=" + (process.env.NODE_ENV || "production"));
console.log("[AUTO-MIGRATE] MYSQLHOST=" + (process.env.MYSQLHOST || process.env.DB_HOST || process.env.RAILWAY_PRIVATE_DOMAIN || "N/A"));
console.log("[AUTO-MIGRATE] MYSQLDATABASE=" + (process.env.MYSQLDATABASE || process.env.DB_NAME || process.env.MYSQL_DATABASE || "N/A"));
console.log("[AUTO-MIGRATE] MYSQLUSER=" + (process.env.MYSQLUSER || process.env.DB_USER || "N/A"));
console.log("[AUTO-MIGRATE] DATABASE_URL=" + (process.env.DATABASE_URL ? "[SET]" : "[NOT SET]"));
console.log("[AUTO-MIGRATE] MYSQL_URL=" + (process.env.MYSQL_URL ? "[SET]" : "[NOT SET]"));
console.log("==============================================\n");

process.env.NODE_ENV = process.env.NODE_ENV || "production";

setTimeout(function() {
  try {
    run(process.execPath, ["migrations/migrate.js", "up"]);
    run(process.execPath, ["migrations/migrate.js", "status"]);
  } catch (e) {
    console.error("[AUTO-MIGRATE] Error inesperado: " + e.message);
  }
  console.log("\n==============================================");
  console.log("[AUTO-MIGRATE] MIGRACIONES COMPLETADAS (o omitidas)");
  console.log("[AUTO-MIGRATE] INICIANDO SERVIDOR...");
  console.log("==============================================\n");
}, 3000);

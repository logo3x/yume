const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "negocio.db");
const BACKUP_DIR = path.join(__dirname, "backups");

if (!fs.existsSync(DB_PATH)) {
  console.log("No existe negocio.db. Nada que limpiar.");
  process.exit(0);
}

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupFile = path.join(BACKUP_DIR, `negocio-reset-backup-${stamp}.db`);
fs.copyFileSync(DB_PATH, backupFile);

const db = new Database(DB_PATH);

try {
  db.exec("PRAGMA foreign_keys = OFF;");

  const deleteTables = [
    "user_sessions",
    "shipments",
    "sales",
    "purchases",
    "cash_movements",
    "clients",
    "products",
    "users"
  ];

  for (const table of deleteTables) {
    db.prepare(`DELETE FROM ${table}`).run();
    db.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).run(table);
  }

  db.prepare("UPDATE settings SET default_margin_percent = 30, initial_investment = 0 WHERE id = 1").run();

  db.exec("PRAGMA foreign_keys = ON;");
  console.log(`Base de datos limpiada correctamente.`);
  console.log(`Backup creado en: ${backupFile}`);
  console.log(`\nLos usuarios han sido eliminados. Al reiniciar la app, podras crear nuevas credenciales.`);
} catch (err) {
  console.error("Error limpiando datos:", err.message);
  process.exitCode = 1;
} finally {
  db.close();
}

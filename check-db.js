const db = require('better-sqlite3')('negocio.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(r => r.name).join(', '));

try {
  const shipmentsCols = db.prepare("PRAGMA table_info(shipments)").all();
  console.log('Shipments columns:', shipmentsCols.map(r => r.name).join(', '));
} catch(e) {
  console.log('Shipments table does not exist!');
}

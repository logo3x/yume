const db = require('better-sqlite3')('negocio.db');

// Enable foreign keys
db.pragma('foreign_keys = ON');

console.log('Testing shipments insert...');

try {
  // Test 1: Insert without sale_id
  const result1 = db.prepare(`
    INSERT INTO shipments (sale_id, client_name, client_address, city, shipping_value, transport_company, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(null, 'Test Client', 'Test Address', 'Test City', 10000, 'Test Transport', 'Pendiente');
  console.log('Test 1 (null sale_id) - Success! ID:', result1.lastInsertRowid);
  
  // Delete test record
  db.prepare('DELETE FROM shipments WHERE id = ?').run(result1.lastInsertRowid);
  
  // Test 2: Insert with sale_id = 999 (non-existent)
  try {
    const result2 = db.prepare(`
      INSERT INTO shipments (sale_id, client_name, client_address, city, shipping_value, transport_company, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(999, 'Test Client 2', 'Test Address 2', 'Test City 2', 10000, 'Test Transport', 'Pendiente');
    console.log('Test 2 (invalid sale_id) - Success! ID:', result2.lastInsertRowid);
  } catch (e) {
    console.log('Test 2 (invalid sale_id) - Failed (expected):', e.message);
  }
  
  // Test 3: Check if there are any existing sales
  const sales = db.prepare('SELECT id FROM sales LIMIT 5').all();
  console.log('Existing sales:', sales.map(s => s.id).join(', ') || 'None');
  
  console.log('All tests completed!');
} catch (err) {
  console.error('Error:', err);
}

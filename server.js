const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const initSqlJs = require("sql.js");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_DIR = __dirname;
const DB_PATH = path.join(BASE_DIR, "negocio.db");
const BACKUP_DIR = path.join(BASE_DIR, "backups");
const UPLOADS_DIR = path.join(BASE_DIR, "uploads");

let db;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR + "/"),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`)
});
const upload = multer({ storage });

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const allowedOrigins = ["http://localhost:3000", "https://yume.onrender.com"];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin) || !origin) {
    res.header("Access-Control-Allow-Origin", origin || "*");
  }
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.use("/uploads", express.static(UPLOADS_DIR, {
  setHeaders: (res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=31536000");
  }
}));
app.use("/backups", express.static(BACKUP_DIR));

function saveDb() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

function runQuery(sql, params = []) {
  db.run(sql, params);
  saveDb();
  return { changes: db.getRowsModified() };
}

function getOne(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function getAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function initDb() {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), default_margin_percent REAL DEFAULT 30, initial_investment REAL DEFAULT 0);
    INSERT OR IGNORE INTO settings(id, default_margin_percent, initial_investment) VALUES (1, 30, 0);
    CREATE TABLE IF NOT EXISTS modules (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, icon TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, is_admin INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS role_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, role_id INTEGER NOT NULL, module_key TEXT NOT NULL, can_view INTEGER DEFAULT 1, can_create INTEGER DEFAULT 1, can_edit INTEGER DEFAULT 1, can_delete INTEGER DEFAULT 1, UNIQUE(role_id, module_key));
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, role_id INTEGER DEFAULT 2, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS user_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, module_key TEXT NOT NULL, can_view INTEGER DEFAULT 1, can_create INTEGER DEFAULT 1, can_edit INTEGER DEFAULT 1, can_delete INTEGER DEFAULT 1, UNIQUE(user_id, module_key));
    CREATE TABLE IF NOT EXISTS user_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT, address TEXT, city TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, category TEXT, description TEXT, features TEXT, stock INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'Disponible', entry_date TEXT NOT NULL, supplier TEXT, photo_path TEXT, purchase_price REAL NOT NULL DEFAULT 0, extra_costs REAL NOT NULL DEFAULT 0, total_real_cost REAL NOT NULL DEFAULT 0, margin_percent REAL NOT NULL DEFAULT 30, sale_price REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL, purchase_price REAL NOT NULL, supplier TEXT, shipping_cost REAL NOT NULL DEFAULT 0, purchase_date TEXT NOT NULL, total_invested REAL NOT NULL, FOREIGN KEY(product_id) REFERENCES products(id));
    CREATE TABLE IF NOT EXISTS sales (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_date TEXT NOT NULL, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL, sale_price REAL NOT NULL, client_id INTEGER, payment_method TEXT NOT NULL, includes_shipping INTEGER NOT NULL DEFAULT 0, shipping_value REAL NOT NULL DEFAULT 0, total_amount REAL NOT NULL, total_cost REAL NOT NULL, profit REAL NOT NULL, FOREIGN KEY(product_id) REFERENCES products(id), FOREIGN KEY(client_id) REFERENCES clients(id));
    CREATE TABLE IF NOT EXISTS shipments (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER, client_name TEXT NOT NULL, client_address TEXT NOT NULL, city TEXT NOT NULL, shipping_value REAL NOT NULL DEFAULT 0, transport_company TEXT, status TEXT NOT NULL CHECK(status IN ('Pendiente','Enviado','Entregado')) DEFAULT 'Pendiente', created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY(sale_id) REFERENCES sales(id));
    CREATE TABLE IF NOT EXISTS cash_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, movement_date TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('Ingreso','Egreso')), category TEXT NOT NULL, amount REAL NOT NULL, notes TEXT);
  `);
  db.exec(`
    INSERT OR IGNORE INTO modules(key, name, icon) VALUES ('clientes', 'Clientes', '👥');
    INSERT OR IGNORE INTO modules(key, name, icon) VALUES ('inventario', 'Inventario', '📦');
    INSERT OR IGNORE INTO modules(key, name, icon) VALUES ('compras', 'Compras', '🛒');
    INSERT OR IGNORE INTO modules(key, name, icon) VALUES ('ventas', 'Ventas', '💰');
    INSERT OR IGNORE INTO modules(key, name, icon) VALUES ('envios', 'Envíos', '🚚');
    INSERT OR IGNORE INTO modules(key, name, icon) VALUES ('caja', 'Caja', '💼');
    INSERT OR IGNORE INTO modules(key, name, icon) VALUES ('reportes', 'Reportes', '📊');
    INSERT OR IGNORE INTO modules(key, name, icon) VALUES ('admin', 'Administración', '⚙️');
    INSERT OR IGNORE INTO roles(id, name, is_admin) VALUES (1, 'Administrador', 1);
    INSERT OR IGNORE INTO roles(id, name, is_admin) VALUES (2, 'Gerente', 0);
    INSERT OR IGNORE INTO roles(id, name, is_admin) VALUES (3, 'Vendedor', 0);
  `);
  saveDb();
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return raw.split(";").map(v => v.trim()).filter(Boolean).reduce((acc, part) => {
    const idx = part.indexOf("=");
    if (idx > 0) acc[part.slice(0, idx)] = decodeURIComponent(part.slice(idx + 1));
    return acc;
  }, {});
}

function requireAuth(req, res, next) {
  const p = req.path;
  if (!p.startsWith("/api/") || p.startsWith("/api/auth/")) return next();
  const token = parseCookies(req).session_token;
  if (!token) return res.status(401).json({ error: "No autenticado" });
  const session = getOne(`SELECT us.*, u.username FROM user_sessions us JOIN users u ON u.id = us.user_id WHERE us.token = ?`, [token]);
  if (!session) return res.status(401).json({ error: "Sesion invalida" });
  if (new Date(session.expires_at) < new Date()) {
    runQuery("DELETE FROM user_sessions WHERE token = ?", [token]);
    return res.status(401).json({ error: "Sesion expirada" });
  }
  req.user = { id: session.user_id, username: session.username };
  next();
}

app.use(requireAuth);

function productStatus(stock) { return stock > 0 ? "Disponible" : "Agotado"; }

function calcPricing(purchasePrice, extraCosts, marginPercent) {
  const totalRealCost = Number(purchasePrice) + Number(extraCosts);
  const salePrice = totalRealCost * (1 + Number(marginPercent) / 100);
  return { totalRealCost, salePrice };
}

function createBackup(reason = "auto") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `negocio-${reason}-${stamp}.db`;
  saveDb();
  fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, name));
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith(".db")).map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime() })).sort((a, b) => b.time - a.time);
  files.slice(20).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f.name)));
  return name;
}

setInterval(() => { try { createBackup("auto"); } catch (e) { console.error("Error backup auto", e.message); } }, 6 * 60 * 60 * 1000);

app.get("/api/auth/status", (req, res) => {
  const hasUsers = getOne("SELECT COUNT(*) AS c FROM users")?.c > 0;
  const token = parseCookies(req).session_token;
  if (!token) return res.json({ authenticated: false, hasUsers });
  const session = getOne(`SELECT us.user_id, us.expires_at, u.username, u.role_id, r.name as role_name, r.is_admin FROM user_sessions us JOIN users u ON u.id = us.user_id LEFT JOIN roles r ON r.id = u.role_id WHERE us.token = ?`, [token]);
  if (!session || new Date(session.expires_at) < new Date()) return res.json({ authenticated: false, hasUsers });
  res.json({ authenticated: true, hasUsers, username: session.username, userId: session.user_id, role: session.role_name, isAdmin: session.is_admin === 1 });
});

app.post("/api/auth/bootstrap", (req, res) => {
  const count = getOne("SELECT COUNT(*) AS c FROM users")?.c || 0;
  if (count > 0) return res.status(400).json({ error: "Ya existe un usuario" });
  const { username, password } = req.body;
  if (!username || !password || String(password).length < 6) return res.status(400).json({ error: "Usuario y contrasena (minimo 6) son obligatorios" });
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  runQuery("INSERT INTO users (username, password_hash, salt, role_id) VALUES (?, ?, ?, 1)", [username, hash, salt]);
  res.json({ ok: true });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  const user = getOne("SELECT * FROM users WHERE username = ?", [username]);
  if (!user) return res.status(401).json({ error: "Credenciales invalidas" });
  const hash = hashPassword(password, user.salt);
  if (hash !== user.password_hash) return res.status(401).json({ error: "Credenciales invalidas" });
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  runQuery("INSERT INTO user_sessions (user_id, token, expires_at) VALUES (?, ?, ?)", [user.id, token, expiresAt]);
  res.setHeader("Set-Cookie", `session_token=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`);
  res.json({ ok: true, username: user.username });
});

app.post("/api/auth/logout", (req, res) => {
  const token = parseCookies(req).session_token;
  if (token) runQuery("DELETE FROM user_sessions WHERE token = ?", [token]);
  res.setHeader("Set-Cookie", "session_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
  res.json({ ok: true });
});

app.get("/api/settings", (req, res) => res.json(getOne("SELECT * FROM settings WHERE id = 1")));

app.put("/api/settings", (req, res) => {
  const { default_margin_percent, initial_investment } = req.body;
  runQuery("UPDATE settings SET default_margin_percent = ?, initial_investment = ? WHERE id = 1", [default_margin_percent ?? 30, initial_investment ?? 0]);
  res.json({ ok: true });
});

function requireAdmin(req, res, next) {
  const token = parseCookies(req).session_token;
  if (!token) return res.status(401).json({ error: "No autenticado" });
  const session = getOne(`SELECT u.role_id, r.is_admin, u.id as user_id FROM user_sessions us JOIN users u ON u.id = us.user_id LEFT JOIN roles r ON r.id = u.role_id WHERE us.token = ? AND us.expires_at > datetime('now')`, [token]);
  if (!session) return res.status(401).json({ error: "Sesion invalida" });
  if (session.is_admin !== 1) return res.status(403).json({ error: "Acceso denegado" });
  req.userId = session.user_id;
  next();
}

app.get("/api/admin/roles", requireAdmin, (req, res) => res.json(getAll("SELECT * FROM roles ORDER BY id")));
app.get("/api/admin/modules", requireAdmin, (req, res) => res.json(getAll("SELECT * FROM modules ORDER BY id")));
app.get("/api/admin/users", requireAdmin, (req, res) => res.json(getAll(`SELECT u.id, u.username, u.role_id, u.is_active, u.created_at, r.name as role_name FROM users u LEFT JOIN roles r ON r.id = u.role_id ORDER BY u.id DESC`)));

app.post("/api/admin/users", requireAdmin, (req, res) => {
  const { username, password, role_id } = req.body;
  if (!username || !password || String(password).length < 6) return res.status(400).json({ error: "Usuario y contrasena (minimo 6) son obligatorios" });
  if (getOne("SELECT id FROM users WHERE username = ?", [username])) return res.status(400).json({ error: "El usuario ya existe" });
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  runQuery("INSERT INTO users (username, password_hash, salt, role_id) VALUES (?, ?, ?, ?)", [username, hash, salt, role_id || 2]);
  res.json({ id: getOne("SELECT last_insert_rowid() as id")?.id });
});

app.put("/api/admin/users/:id", requireAdmin, (req, res) => {
  const { username, password, role_id, is_active } = req.body;
  const userId = Number(req.params.id);
  if (userId === 1) return res.status(400).json({ error: "No se puede modificar el usuario administrador principal" });
  const user = getOne("SELECT * FROM users WHERE id = ?", [userId]);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  if (username) {
    const existing = getOne("SELECT id FROM users WHERE username = ? AND id != ?", [username, userId]);
    if (existing) return res.status(400).json({ error: "El nombre de usuario ya existe" });
  }
  if (password && password.length < 6) return res.status(400).json({ error: "La contrasena debe tener minimo 6 caracteres" });
  if (password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = hashPassword(password, salt);
    runQuery("UPDATE users SET username = ?, password_hash = ?, salt = ?, role_id = ?, is_active = ? WHERE id = ?", [username || user.username, hash, salt, role_id ?? user.role_id, is_active !== undefined ? (is_active ? 1 : 0) : user.is_active, userId]);
  } else {
    runQuery("UPDATE users SET username = ?, role_id = ?, is_active = ? WHERE id = ?", [username || user.username, role_id ?? user.role_id, is_active !== undefined ? (is_active ? 1 : 0) : user.is_active, userId]);
  }
  res.json({ ok: true });
});

app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  if (userId === 1) return res.status(400).json({ error: "No se puede eliminar el usuario administrador principal" });
  if (userId === req.userId) return res.status(400).json({ error: "No puedes eliminarte a ti mismo" });
  if (!getOne("SELECT * FROM users WHERE id = ?", [userId])) return res.status(404).json({ error: "Usuario no encontrado" });
  runQuery("DELETE FROM user_sessions WHERE user_id = ?", [userId]);
  runQuery("DELETE FROM user_permissions WHERE user_id = ?", [userId]);
  runQuery("DELETE FROM users WHERE id = ?", [userId]);
  res.json({ ok: true });
});

app.get("/api/admin/permissions/:userId", requireAdmin, (req, res) => {
  const userId = Number(req.params.userId);
  const user = getOne("SELECT * FROM users WHERE id = ?", [userId]);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  const modules = getAll("SELECT * FROM modules ORDER BY id");
  const userPerms = getAll("SELECT * FROM user_permissions WHERE user_id = ?", [userId]);
  const rolePerms = getAll("SELECT * FROM role_permissions WHERE role_id = ?", [user.role_id]);
  const permsMap = {};
  for (const p of userPerms) permsMap[p.module_key] = { can_view: p.can_view, can_create: p.can_create, can_edit: p.can_edit, can_delete: p.can_delete, is_custom: 1 };
  for (const p of rolePerms) if (!permsMap[p.module_key]) permsMap[p.module_key] = { can_view: p.can_view, can_create: p.can_create, can_edit: p.can_edit, can_delete: p.can_delete, is_custom: 0 };
  res.json(modules.map(m => ({ ...m, ...(permsMap[m.key] || { can_view: 1, can_create: 1, can_edit: 1, can_delete: 1, is_custom: 0 }) })));
});

app.put("/api/admin/permissions/:userId", requireAdmin, (req, res) => {
  const userId = Number(req.params.userId);
  const { permissions } = req.body;
  const user = getOne("SELECT * FROM users WHERE id = ?", [userId]);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  if (user.is_admin === 1) return res.status(400).json({ error: "El administrador tiene acceso total" });
  runQuery("DELETE FROM user_permissions WHERE user_id = ?", [userId]);
  if (Array.isArray(permissions)) for (const p of permissions) runQuery(`INSERT INTO user_permissions (user_id, module_key, can_view, can_create, can_edit, can_delete) VALUES (?, ?, ?, ?, ?, ?)`, [userId, p.module_key, p.can_view ? 1 : 0, p.can_create ? 1 : 0, p.can_edit ? 1 : 0, p.can_delete ? 1 : 0]);
  res.json({ ok: true });
});

app.get("/api/products", (req, res) => res.json(getAll("SELECT * FROM products ORDER BY id DESC")));
app.post("/api/products", upload.single("photo"), (req, res) => {
  const { code, name, category, description, features, stock, entry_date, supplier, purchase_price, extra_costs, margin_percent } = req.body;
  const { totalRealCost, salePrice } = calcPricing(purchase_price || 0, extra_costs || 0, margin_percent || 30);
  const currentStock = Number(stock || 0);
  runQuery(`INSERT INTO products (code, name, category, description, features, stock, status, entry_date, supplier, photo_path, purchase_price, extra_costs, total_real_cost, margin_percent, sale_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [code, name, category || "", description || "", features || "", currentStock, productStatus(currentStock), entry_date || new Date().toISOString().slice(0, 10), supplier || "", req.file ? `/uploads/${req.file.filename}` : null, Number(purchase_price || 0), Number(extra_costs || 0), totalRealCost, Number(margin_percent || 30), salePrice]);
  res.json({ id: getOne("SELECT last_insert_rowid() as id")?.id });
});
app.get("/api/products/:id", (req, res) => { const p = getOne("SELECT * FROM products WHERE id = ?", [Number(req.params.id)]); if (!p) return res.status(404).json({ error: "Producto no encontrado" }); res.json(p); });
app.put("/api/products/:id", upload.single("photo"), (req, res) => {
  const product = getOne("SELECT * FROM products WHERE id = ?", [Number(req.params.id)]);
  if (!product) return res.status(404).json({ error: "Producto no encontrado" });
  const { code, name, category, description, features, stock, entry_date, supplier, purchase_price, extra_costs, margin_percent } = req.body;
  const { totalRealCost, salePrice } = calcPricing(purchase_price || product.purchase_price, extra_costs || 0, margin_percent || product.margin_percent);
  const currentStock = Number(stock ?? product.stock);
  runQuery(`UPDATE products SET code = ?, name = ?, category = ?, description = ?, features = ?, stock = ?, status = ?, entry_date = ?, supplier = ?, photo_path = ?, purchase_price = ?, extra_costs = ?, total_real_cost = ?, margin_percent = ?, sale_price = ? WHERE id = ?`, [code || product.code, name || product.name, category ?? product.category, description ?? product.description, features ?? product.features, currentStock, productStatus(currentStock), entry_date || product.entry_date, supplier ?? product.supplier, req.file ? `/uploads/${req.file.filename}` : product.photo_path, Number(purchase_price ?? product.purchase_price), Number(extra_costs ?? product.extra_costs), totalRealCost, Number(margin_percent ?? product.margin_percent), salePrice, Number(req.params.id)]);
  res.json({ ok: true });
});
app.delete("/api/products/:id", (req, res) => {
  try {
    if (!getOne("SELECT * FROM products WHERE id = ?", [Number(req.params.id)])) return res.status(404).json({ error: "Producto no encontrado" });
    runQuery("DELETE FROM sales WHERE product_id = ?", [Number(req.params.id)]);
    runQuery("DELETE FROM purchases WHERE product_id = ?", [Number(req.params.id)]);
    runQuery("DELETE FROM products WHERE id = ?", [Number(req.params.id)]);
    res.json({ ok: true });
  } catch (err) { console.error("Error deleting product:", err); res.status(500).json({ error: "Error al eliminar producto" }); }
});

app.post("/api/purchases", (req, res) => {
  const { product_id, quantity, purchase_price, supplier, shipping_cost, purchase_date } = req.body;
  const q = Number(quantity), price = Number(purchase_price), ship = Number(shipping_cost || 0), total = q * price + ship;
  const product = getOne("SELECT * FROM products WHERE id = ?", [product_id]);
  if (!product) return res.status(404).json({ error: "Producto no existe" });
  runQuery(`INSERT INTO purchases (product_id, quantity, purchase_price, supplier, shipping_cost, purchase_date, total_invested) VALUES (?, ?, ?, ?, ?, ?, ?)`, [product_id, q, price, supplier || product.supplier || "", ship, purchase_date, total]);
  const newStock = product.stock + q;
  runQuery("UPDATE products SET stock = ?, status = ?, purchase_price = ?, extra_costs = ? WHERE id = ?", [newStock, productStatus(newStock), price, ship, product_id]);
  runQuery("INSERT INTO cash_movements (movement_date, type, category, amount, notes) VALUES (?, 'Egreso', 'Compra de productos', ?, ?)", [purchase_date, total, `Compra producto ${product.name}`]);
  res.json({ id: getOne("SELECT last_insert_rowid() as id")?.id, total_invested: total });
});
app.get("/api/purchases", (req, res) => res.json(getAll("SELECT p.*, pr.name AS product_name FROM purchases p JOIN products pr ON pr.id = p.product_id ORDER BY p.id DESC")));
app.get("/api/purchases/:id", (req, res) => { const r = getOne("SELECT p.*, pr.name AS product_name FROM purchases p JOIN products pr ON pr.id = p.product_id WHERE p.id = ?", [Number(req.params.id)]); if (!r) return res.status(404).json({ error: "Compra no encontrada" }); res.json(r); });
app.put("/api/purchases/:id", (req, res) => {
  const { quantity, purchase_price, supplier, shipping_cost, purchase_date } = req.body;
  const purchase = getOne("SELECT * FROM purchases WHERE id = ?", [Number(req.params.id)]);
  if (!purchase) return res.status(404).json({ error: "Compra no encontrada" });
  const product = getOne("SELECT * FROM products WHERE id = ?", [purchase.product_id]);
  const oldStock = product.stock - purchase.quantity;
  const newQty = Number(quantity ?? purchase.quantity), newPrice = Number(purchase_price ?? purchase.purchase_price), newShip = Number(shipping_cost ?? purchase.shipping_cost), newTotal = newQty * newPrice + newShip;
  runQuery("UPDATE purchases SET quantity = ?, purchase_price = ?, supplier = ?, shipping_cost = ?, purchase_date = ?, total_invested = ? WHERE id = ?", [newQty, newPrice, supplier || purchase.supplier || "", newShip, purchase_date || purchase.purchase_date, newTotal, Number(req.params.id)]);
  runQuery("UPDATE products SET stock = ?, purchase_price = ?, extra_costs = ? WHERE id = ?", [oldStock + newQty, newPrice, newShip, purchase.product_id]);
  res.json({ ok: true });
});
app.delete("/api/purchases/:id", (req, res) => {
  try {
    const purchase = getOne("SELECT * FROM purchases WHERE id = ?", [Number(req.params.id)]);
    if (!purchase) return res.status(404).json({ error: "Compra no encontrada" });
    const product = getOne("SELECT * FROM products WHERE id = ?", [purchase.product_id]);
    if (product) { const newStock = product.stock - purchase.quantity; runQuery("UPDATE products SET stock = ?, status = ? WHERE id = ?", [newStock, productStatus(newStock), purchase.product_id]); }
    runQuery("DELETE FROM purchases WHERE id = ?", [Number(req.params.id)]);
    res.json({ ok: true });
  } catch (err) { console.error("Error deleting purchase:", err); res.status(500).json({ error: "Error al eliminar compra" }); }
});

app.post("/api/clients", (req, res) => {
  const { name, phone, address, city } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre es obligatorio" });
  runQuery("INSERT INTO clients (name, phone, address, city) VALUES (?, ?, ?, ?)", [name, phone || "", address || "", city || ""]);
  res.json({ id: getOne("SELECT last_insert_rowid() as id")?.id });
});
app.get("/api/clients", (req, res) => res.json(getAll("SELECT * FROM clients ORDER BY id DESC")));
app.get("/api/clients/:id", (req, res) => { const r = getOne("SELECT * FROM clients WHERE id = ?", [Number(req.params.id)]); if (!r) return res.status(404).json({ error: "Cliente no encontrado" }); res.json(r); });
app.put("/api/clients/:id", (req, res) => {
  const { name, phone, address, city } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre es obligatorio" });
  if (!getOne("SELECT * FROM clients WHERE id = ?", [Number(req.params.id)])) return res.status(404).json({ error: "Cliente no encontrado" });
  runQuery("UPDATE clients SET name = ?, phone = ?, address = ?, city = ? WHERE id = ?", [name, phone || "", address || "", city || "", Number(req.params.id)]);
  res.json({ ok: true });
});
app.delete("/api/clients/:id", (req, res) => {
  try {
    if (!getOne("SELECT * FROM clients WHERE id = ?", [Number(req.params.id)])) return res.status(404).json({ error: "Cliente no encontrado" });
    runQuery("UPDATE sales SET client_id = NULL WHERE client_id = ?", [Number(req.params.id)]);
    runQuery("DELETE FROM clients WHERE id = ?", [Number(req.params.id)]);
    res.json({ ok: true });
  } catch (err) { console.error("Error deleting client:", err); res.status(500).json({ error: "Error al eliminar cliente" }); }
});

app.post("/api/sales", (req, res) => {
  const { sale_date, product_id, quantity, sale_price, client_id, payment_method, includes_shipping, shipping_value } = req.body;
  const product = getOne("SELECT * FROM products WHERE id = ?", [product_id]);
  if (!product) return res.status(404).json({ error: "Producto no existe" });
  const q = Number(quantity);
  if (q <= 0) return res.status(400).json({ error: "Cantidad invalida" });
  if (product.stock < q) return res.status(400).json({ error: "Stock insuficiente" });
  const unitSale = Number(sale_price || product.sale_price), shipValue = Number(shipping_value || 0);
  const totalAmount = unitSale * q + (Number(includes_shipping) ? shipValue : 0), totalCost = Number(product.total_real_cost) * q, profit = totalAmount - totalCost;
  runQuery(`INSERT INTO sales (sale_date, product_id, quantity, sale_price, client_id, payment_method, includes_shipping, shipping_value, total_amount, total_cost, profit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [sale_date, product_id, q, unitSale, client_id || null, payment_method, Number(includes_shipping) ? 1 : 0, shipValue, totalAmount, totalCost, profit]);
  const newStock = product.stock - q;
  runQuery("UPDATE products SET stock = ?, status = ? WHERE id = ?", [newStock, productStatus(newStock), product_id]);
  runQuery("INSERT INTO cash_movements (movement_date, type, category, amount, notes) VALUES (?, 'Ingreso', 'Ventas', ?, ?)", [sale_date, totalAmount, `Venta producto ${product.name}`]);
  res.json({ id: getOne("SELECT last_insert_rowid() as id")?.id, profit, remaining_stock: newStock });
});
app.get("/api/sales", (req, res) => res.json(getAll(`SELECT s.*, p.name AS product_name, c.name AS client_name FROM sales s JOIN products p ON p.id = s.product_id LEFT JOIN clients c ON c.id = s.client_id ORDER BY s.id DESC`)));
app.get("/api/sales/:id", (req, res) => { const r = getOne(`SELECT s.*, p.name AS product_name, c.name AS client_name FROM sales s JOIN products p ON p.id = s.product_id LEFT JOIN clients c ON c.id = s.client_id WHERE s.id = ?`, [Number(req.params.id)]); if (!r) return res.status(404).json({ error: "Venta no encontrada" }); res.json(r); });
app.put("/api/sales/:id", (req, res) => {
  const { sale_date, quantity, sale_price, payment_method, includes_shipping, shipping_value } = req.body;
  const sale = getOne("SELECT * FROM sales WHERE id = ?", [Number(req.params.id)]);
  if (!sale) return res.status(404).json({ error: "Venta no encontrada" });
  const product = getOne("SELECT * FROM products WHERE id = ?", [sale.product_id]);
  const oldStock = product.stock + sale.quantity;
  const newQty = Number(quantity ?? sale.quantity), newPrice = Number(sale_price ?? sale.sale_price), newShip = Number(includes_shipping ? (shipping_value ?? sale.shipping_value) : 0);
  const newTotal = newQty * newPrice + newShip, newCost = Number(product.total_real_cost) * newQty, newProfit = newTotal - newCost;
  runQuery("UPDATE sales SET sale_date = ?, quantity = ?, sale_price = ?, payment_method = ?, includes_shipping = ?, shipping_value = ?, total_amount = ?, total_cost = ?, profit = ? WHERE id = ?", [sale_date || sale.sale_date, newQty, newPrice, payment_method || sale.payment_method, includes_shipping ? 1 : 0, newShip, newTotal, newCost, newProfit, Number(req.params.id)]);
  runQuery("UPDATE products SET stock = ?, status = ? WHERE id = ?", [oldStock - newQty, productStatus(oldStock - newQty), sale.product_id]);
  res.json({ ok: true });
});
app.delete("/api/sales/:id", (req, res) => {
  try {
    const sale = getOne("SELECT * FROM sales WHERE id = ?", [Number(req.params.id)]);
    if (!sale) return res.status(404).json({ error: "Venta no encontrada" });
    const product = getOne("SELECT * FROM products WHERE id = ?", [sale.product_id]);
    if (product) { const newStock = product.stock + sale.quantity; runQuery("UPDATE products SET stock = ?, status = ? WHERE id = ?", [newStock, productStatus(newStock), sale.product_id]); }
    runQuery("DELETE FROM sales WHERE id = ?", [Number(req.params.id)]);
    res.json({ ok: true });
  } catch (err) { console.error("Error deleting sale:", err); res.status(500).json({ error: "Error al eliminar venta" }); }
});

app.post("/api/shipments", (req, res) => {
  try {
    const { sale_id, client_name, client_address, city, shipping_value, transport_company, status } = req.body;
    if (!client_name || !client_address || !city) return res.status(400).json({ error: "Cliente, direccion y ciudad son obligatorios" });
    let saleId = null;
    if (sale_id && sale_id !== '') { const s = getOne("SELECT id FROM sales WHERE id = ?", [Number(sale_id)]); if (s) saleId = Number(sale_id); }
    runQuery(`INSERT INTO shipments (sale_id, client_name, client_address, city, shipping_value, transport_company, status) VALUES (?, ?, ?, ?, ?, ?, ?)`, [saleId, client_name, client_address, city, Number(shipping_value || 0), transport_company || "", status || "Pendiente"]);
    res.json({ id: getOne("SELECT last_insert_rowid() as id")?.id });
  } catch (err) { console.error("Error creating shipment:", err); res.status(500).json({ error: "Error al crear envio: " + err.message }); }
});
app.get("/api/shipments", (req, res) => res.json(getAll(`SELECT sh.*, s.total_amount as sale_total FROM shipments sh LEFT JOIN sales s ON s.id = sh.sale_id ORDER BY sh.id DESC`)));
app.get("/api/shipments/:id", (req, res) => { const r = getOne("SELECT * FROM shipments WHERE id = ?", [Number(req.params.id)]); if (!r) return res.status(404).json({ error: "Envio no encontrado" }); res.json(r); });
app.put("/api/shipments/:id", (req, res) => {
  const { client_name, client_address, city, shipping_value, transport_company, status } = req.body;
  if (!client_name || !client_address || !city) return res.status(400).json({ error: "Cliente, direccion y ciudad son obligatorios" });
  const existing = getOne("SELECT * FROM shipments WHERE id = ?", [Number(req.params.id)]);
  if (!existing) return res.status(404).json({ error: "Envio no encontrado" });
  runQuery(`UPDATE shipments SET client_name = ?, client_address = ?, city = ?, shipping_value = ?, transport_company = ?, status = ? WHERE id = ?`, [client_name, client_address, city, Number(shipping_value || 0), transport_company || "", status || existing.status, Number(req.params.id)]);
  res.json({ ok: true });
});
app.delete("/api/shipments/:id", (req, res) => { try { if (!getOne("SELECT * FROM shipments WHERE id = ?", [Number(req.params.id)])) return res.status(404).json({ error: "Envio no encontrado" }); runQuery("DELETE FROM shipments WHERE id = ?", [Number(req.params.id)]); res.json({ ok: true }); } catch (err) { console.error("Error deleting shipment:", err); res.status(500).json({ error: "Error al eliminar envio" }); } });

app.post("/api/cash-movements", (req, res) => { const { movement_date, type, category, amount, notes } = req.body; if (!movement_date || !type || !category || !amount) return res.status(400).json({ error: "Todos los campos son obligatorios" }); runQuery("INSERT INTO cash_movements (movement_date, type, category, amount, notes) VALUES (?, ?, ?, ?, ?)", [movement_date, type, category, Number(amount), notes || ""]); res.json({ id: getOne("SELECT last_insert_rowid() as id")?.id }); });
app.get("/api/cash-movements", (req, res) => { let query = "SELECT * FROM cash_movements WHERE 1=1"; const params = []; if (req.query.start_date) { query += " AND movement_date >= ?"; params.push(req.query.start_date); } if (req.query.end_date) { query += " AND movement_date <= ?"; params.push(req.query.end_date); } if (req.query.type && req.query.type !== "all") { query += " AND type = ?"; params.push(req.query.type); } query += " ORDER BY id DESC"; res.json(getAll(query, params)); });
app.delete("/api/cash-movements/:id", (req, res) => { try { if (!getOne("SELECT * FROM cash_movements WHERE id = ?", [Number(req.params.id)])) return res.status(404).json({ error: "Movimiento no encontrado" }); runQuery("DELETE FROM cash_movements WHERE id = ?", [Number(req.params.id)]); res.json({ ok: true }); } catch (err) { console.error("Error deleting cash movement:", err); res.status(500).json({ error: "Error al eliminar movimiento" }); } });

app.get("/api/reports/summary", (req, res) => {
  const today = getOne("SELECT IFNULL(SUM(total_amount), 0) AS v FROM sales WHERE sale_date = date('now', 'localtime')")?.v || 0;
  const week = getOne("SELECT IFNULL(SUM(total_amount), 0) AS v FROM sales WHERE sale_date >= date('now', '-6 day', 'localtime')")?.v || 0;
  const month = getOne("SELECT IFNULL(SUM(total_amount), 0) AS v FROM sales WHERE strftime('%Y-%m', sale_date) = strftime('%Y-%m', 'now', 'localtime')")?.v || 0;
  const totalProfit = getOne("SELECT IFNULL(SUM(profit), 0) AS v FROM sales")?.v || 0;
  const mostSold = getAll("SELECT p.name, IFNULL(SUM(s.quantity), 0) AS qty FROM products p LEFT JOIN sales s ON s.product_id = p.id GROUP BY p.id ORDER BY qty DESC LIMIT 5");
  const leastSold = getAll("SELECT p.name, IFNULL(SUM(s.quantity), 0) AS qty FROM products p LEFT JOIN sales s ON s.product_id = p.id GROUP BY p.id ORDER BY qty ASC LIMIT 5");
  const outOfStock = getAll("SELECT * FROM products WHERE stock <= 0 ORDER BY name");
  const income = getOne("SELECT IFNULL(SUM(amount), 0) AS v FROM cash_movements WHERE type = 'Ingreso'")?.v || 0;
  const expense = getOne("SELECT IFNULL(SUM(amount), 0) AS v FROM cash_movements WHERE type = 'Egreso'")?.v || 0;
  res.json({ today, week, month, totalProfit, mostSold, leastSold, outOfStock, income, expense });
});
app.get("/api/reports/charts", (req, res) => res.json({ salesByMonth: getAll(`SELECT strftime('%Y-%m', sale_date) AS month, IFNULL(SUM(total_amount),0) AS total_sales, IFNULL(SUM(profit),0) AS total_profit FROM sales GROUP BY strftime('%Y-%m', sale_date) ORDER BY month`), topProducts: getAll("SELECT p.name, IFNULL(SUM(s.quantity),0) AS qty FROM products p LEFT JOIN sales s ON s.product_id = p.id GROUP BY p.id ORDER BY qty DESC LIMIT 10") }));

app.get("/api/reports/filtered", (req, res) => {
  const { start_date, end_date } = req.query;
  let dateFilter = "";
  let params = [];
  if (start_date && end_date) {
    dateFilter = " WHERE sale_date >= ? AND sale_date <= ?";
    params = [start_date, end_date];
  } else if (start_date) {
    dateFilter = " WHERE sale_date >= ?";
    params = [start_date];
  } else if (end_date) {
    dateFilter = " WHERE sale_date <= ?";
    params = [end_date];
  }
  
  const totalSales = getOne(`SELECT IFNULL(SUM(total_amount),0) AS v FROM sales${dateFilter}`, params)?.v || 0;
  const totalProfit = getOne(`SELECT IFNULL(SUM(profit),0) AS v FROM sales${dateFilter}`, params)?.v || 0;
  const totalQty = getOne(`SELECT IFNULL(SUM(quantity),0) AS v FROM sales${dateFilter}`, params)?.v || 0;
  
  const salesByDay = getAll(`SELECT sale_date AS day, IFNULL(SUM(total_amount),0) AS total_sales, IFNULL(SUM(profit),0) AS total_profit, IFNULL(SUM(quantity),0) AS total_qty FROM sales${dateFilter} GROUP BY sale_date ORDER BY sale_date`, params);
  
  const topProducts = getAll(`SELECT p.name, IFNULL(SUM(s.quantity),0) AS qty, IFNULL(SUM(s.total_amount),0) AS total FROM sales s JOIN products p ON p.id = s.product_id${dateFilter} GROUP BY p.id ORDER BY qty DESC LIMIT 10`, params);
  
  const cashIn = getOne(`SELECT IFNULL(SUM(amount),0) AS v FROM cash_movements WHERE type = 'Ingreso'${dateFilter.replace('sale_date', 'movement_date')}`, params)?.v || 0;
  const cashOut = getOne(`SELECT IFNULL(SUM(amount),0) AS v FROM cash_movements WHERE type = 'Egreso'${dateFilter.replace('sale_date', 'movement_date')}`, params)?.v || 0;
  
  res.json({ totalSales, totalProfit, totalQty, salesByDay, topProducts, cashIn, cashOut });
});
app.get("/api/cash/summary", (req, res) => { const settings = getOne("SELECT * FROM settings WHERE id = 1"); const incomes = getOne("SELECT IFNULL(SUM(amount),0) AS v FROM cash_movements WHERE type = 'Ingreso'")?.v || 0; const expenses = getOne("SELECT IFNULL(SUM(amount),0) AS v FROM cash_movements WHERE type = 'Egreso'")?.v || 0; const current = Number(settings?.initial_investment || 0) + Number(incomes) - Number(expenses); res.json({ initial_investment: Number(settings?.initial_investment || 0), incomes: Number(incomes), expenses: Number(expenses), current }); });

app.post("/api/backups/create", (req, res) => res.json({ ok: true, file: createBackup("manual") }));
app.get("/api/backups", (req, res) => res.json(fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith(".db")).map(f => { const stat = fs.statSync(path.join(BACKUP_DIR, f)); return { file: f, size: stat.size, updated_at: stat.mtime.toISOString(), url: `/backups/${f}` }; }).sort((a, b) => b.updated_at.localeCompare(a.updated_at))));

function escapeCsv(val) {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(headers, rows) {
  const headerLine = headers.map(escapeCsv).join(",");
  const dataLines = rows.map(row => headers.map(h => escapeCsv(row[h])).join(","));
  return [headerLine, ...dataLines].join("\n");
}

app.get("/api/export/:type", (req, res) => {
  const type = req.params.type;
  const tables = {
    products: { headers: ["id", "code", "name", "category", "description", "features", "stock", "status", "entry_date", "supplier", "purchase_price", "extra_costs", "total_real_cost", "margin_percent", "sale_price"], query: "SELECT * FROM products ORDER BY id" },
    clients: { headers: ["id", "name", "phone", "address", "city", "created_at"], query: "SELECT * FROM clients ORDER BY id" },
    sales: { headers: ["id", "sale_date", "product_id", "quantity", "sale_price", "client_id", "payment_method", "includes_shipping", "shipping_value", "total_amount", "total_cost", "profit"], query: "SELECT * FROM sales ORDER BY id" },
    purchases: { headers: ["id", "product_id", "quantity", "purchase_price", "supplier", "shipping_cost", "purchase_date", "total_invested"], query: "SELECT * FROM purchases ORDER BY id" },
    shipments: { headers: ["id", "sale_id", "client_name", "client_address", "city", "shipping_value", "transport_company", "status", "created_at"], query: "SELECT * FROM shipments ORDER BY id" },
    cash_movements: { headers: ["id", "movement_date", "type", "category", "amount", "notes"], query: "SELECT * FROM cash_movements ORDER BY id" },
    all: { headers: ["table", "id", "data"], query: null }
  };
  
  if (!tables[type]) return res.status(400).json({ error: "Tipo inválido" });
  
  if (type === "all") {
    const allData = {};
    for (const t of ["products", "clients", "sales", "purchases", "shipments", "cash_movements"]) {
      allData[t] = getAll(`SELECT * FROM ${t} ORDER BY id`);
    }
    return res.json(allData);
  }
  
  const t = tables[type];
  const rows = getAll(t.query);
  const csv = toCsv(t.headers, rows);
  
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${type}_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send("\ufeff" + csv);
});

app.post("/api/import/:type", (req, res) => {
  const type = req.params.type;
  const { data } = req.body;
  
  if (!data || !Array.isArray(data)) return res.status(400).json({ error: "Datos inválidos" });
  
  let imported = 0;
  let errors = [];
  
  try {
    for (const row of data) {
      if (type === "products") {
        const exists = getOne("SELECT id FROM products WHERE code = ?", [row.code]);
        if (exists) {
          runQuery(`UPDATE products SET name = ?, category = ?, description = ?, features = ?, stock = ?, status = ?, entry_date = ?, supplier = ?, purchase_price = ?, extra_costs = ?, total_real_cost = ?, margin_percent = ?, sale_price = ? WHERE code = ?`,
            [row.name, row.category || "", row.description || "", row.features || "", row.stock || 0, row.status || "Disponible", row.entry_date, row.supplier || "", row.purchase_price || 0, row.extra_costs || 0, row.total_real_cost || 0, row.margin_percent || 30, row.sale_price || 0, row.code]);
        } else {
          runQuery(`INSERT INTO products (code, name, category, description, features, stock, status, entry_date, supplier, purchase_price, extra_costs, total_real_cost, margin_percent, sale_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [row.code, row.name, row.category || "", row.description || "", row.features || "", row.stock || 0, row.status || "Disponible", row.entry_date, row.supplier || "", row.purchase_price || 0, row.extra_costs || 0, row.total_real_cost || 0, row.margin_percent || 30, row.sale_price || 0]);
        }
        imported++;
      } else if (type === "clients") {
        const exists = getOne("SELECT id FROM clients WHERE name = ? AND phone = ?", [row.name, row.phone || ""]);
        if (!exists) {
          runQuery("INSERT INTO clients (name, phone, address, city) VALUES (?, ?, ?, ?)", [row.name, row.phone || "", row.address || "", row.city || ""]);
          imported++;
        }
      }
    }
  } catch (e) {
    errors.push(e.message);
  }
  
  res.json({ ok: true, imported, errors });
});

app.use(express.static(path.join(__dirname, "public")));
app.use((req, res) => { if (req.path.startsWith("/api/")) res.status(404).json({ error: "Ruta no encontrada" }); else res.sendFile(path.join(__dirname, "public", "index.html")); });
app.use((err, req, res, next) => { console.error("Error:", err); res.status(500).json({ error: "Error interno del servidor" }); });

async function startServer() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) { console.log("DATA_DIR exists or cannot be created:", e.message); }
  try {
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  } catch (e) { console.log("UPLOADS_DIR exists or cannot be created:", e.message); }
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  } catch (e) { console.log("BACKUP_DIR exists or cannot be created:", e.message); }
  
  const SQL = await initSqlJs();
  try {
    if (fs.existsSync(DB_PATH)) { const fileBuffer = fs.readFileSync(DB_PATH); db = new SQL.Database(fileBuffer); } else { db = new SQL.Database(); }
  } catch (e) {
    console.log("DB error, creating new:", e.message);
    db = new SQL.Database();
  }
  initDb();
  app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
}
startServer().catch(console.error);

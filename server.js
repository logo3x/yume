const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, "negocio.db");
const BACKUP_DIR = path.join(__dirname, "backups");
const db = new Database(DB_PATH);

if (!fs.existsSync(path.join(__dirname, "uploads"))) fs.mkdirSync(path.join(__dirname, "uploads"));
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`)
});
const upload = multer({ storage });

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "http://localhost:3000");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.use("/uploads", express.static(path.join(__dirname, "uploads"), {
  setHeaders: (res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=31536000");
  }
}));
app.use("/backups", express.static(BACKUP_DIR));

function initDb() {
  db.exec(`
    PRAGMA foreign_keys = OFF;

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      default_margin_percent REAL DEFAULT 30,
      initial_investment REAL DEFAULT 0
    );
    INSERT OR IGNORE INTO settings(id, default_margin_percent, initial_investment) VALUES (1, 30, 0);

    CREATE TABLE IF NOT EXISTS modules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      icon TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_admin INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_id INTEGER NOT NULL,
      module_key TEXT NOT NULL,
      can_view INTEGER DEFAULT 1,
      can_create INTEGER DEFAULT 1,
      can_edit INTEGER DEFAULT 1,
      can_delete INTEGER DEFAULT 1,
      UNIQUE(role_id, module_key)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role_id INTEGER DEFAULT 2,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      module_key TEXT NOT NULL,
      can_view INTEGER DEFAULT 1,
      can_create INTEGER DEFAULT 1,
      can_edit INTEGER DEFAULT 1,
      can_delete INTEGER DEFAULT 1,
      UNIQUE(user_id, module_key)
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      city TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT,
      description TEXT,
      features TEXT,
      stock INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Disponible',
      entry_date TEXT NOT NULL,
      supplier TEXT,
      photo_path TEXT,
      purchase_price REAL NOT NULL DEFAULT 0,
      extra_costs REAL NOT NULL DEFAULT 0,
      total_real_cost REAL NOT NULL DEFAULT 0,
      margin_percent REAL NOT NULL DEFAULT 30,
      sale_price REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      purchase_price REAL NOT NULL,
      supplier TEXT,
      shipping_cost REAL NOT NULL DEFAULT 0,
      purchase_date TEXT NOT NULL,
      total_invested REAL NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_date TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      sale_price REAL NOT NULL,
      client_id INTEGER,
      payment_method TEXT NOT NULL,
      includes_shipping INTEGER NOT NULL DEFAULT 0,
      shipping_value REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL,
      total_cost REAL NOT NULL,
      profit REAL NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(client_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS shipments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER,
      client_name TEXT NOT NULL,
      client_address TEXT NOT NULL,
      city TEXT NOT NULL,
      shipping_value REAL NOT NULL DEFAULT 0,
      transport_company TEXT,
      status TEXT NOT NULL CHECK(status IN ('Pendiente','Enviado','Entregado')) DEFAULT 'Pendiente',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(sale_id) REFERENCES sales(id)
    );

    CREATE TABLE IF NOT EXISTS cash_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movement_date TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('Ingreso','Egreso')),
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      notes TEXT
    );
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
}

initDb();

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
  const path = req.path;
  
  if (!path.startsWith("/api/") || path.startsWith("/api/auth/")) {
    return next();
  }
  
  const cookies = parseCookies(req);
  const token = cookies.session_token;
  
  if (!token) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const session = db.prepare(`
    SELECT us.*, u.username
    FROM user_sessions us
    JOIN users u ON u.id = us.user_id
    WHERE us.token = ?
  `).get(token);

  if (!session) return res.status(401).json({ error: "Sesion invalida" });
  if (new Date(session.expires_at) < new Date()) {
    db.prepare("DELETE FROM user_sessions WHERE token = ?").run(token);
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
  const target = path.join(BACKUP_DIR, name);
  fs.copyFileSync(DB_PATH, target);

  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith(".db"))
    .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime() }))
    .sort((a, b) => b.time - a.time);

  files.slice(20).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f.name)));
  return name;
}

setInterval(() => {
  try { createBackup("auto"); } catch (e) { console.error("Error backup auto", e.message); }
}, 6 * 60 * 60 * 1000);

// ============================================
// RUTAS DE AUTENTICACION (publicas)
// ============================================

app.get("/api/auth/status", (req, res) => {
  const hasUsers = db.prepare("SELECT COUNT(*) AS c FROM users").get().c > 0;
  const token = parseCookies(req).session_token;
  if (!token) return res.json({ authenticated: false, hasUsers });

  const session = db.prepare(`
    SELECT us.user_id, us.expires_at, u.username, u.role_id, r.name as role_name, r.is_admin
    FROM user_sessions us
    JOIN users u ON u.id = us.user_id
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE us.token = ?
  `).get(token);

  if (!session || new Date(session.expires_at) < new Date()) return res.json({ authenticated: false, hasUsers });
  res.json({ 
    authenticated: true, 
    hasUsers, 
    username: session.username,
    userId: session.user_id,
    role: session.role_name,
    isAdmin: session.is_admin === 1
  });
});

app.post("/api/auth/bootstrap", (req, res) => {
  const count = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  if (count > 0) return res.status(400).json({ error: "Ya existe un usuario" });

  const { username, password } = req.body;
  if (!username || !password || String(password).length < 6) {
    return res.status(400).json({ error: "Usuario y contrasena (minimo 6) son obligatorios" });
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  db.prepare("INSERT INTO users (username, password_hash, salt, role_id) VALUES (?, ?, ?, 1)").run(username, hash, salt);
  res.json({ ok: true });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user) return res.status(401).json({ error: "Credenciales invalidas" });

  const hash = hashPassword(password, user.salt);
  if (hash !== user.password_hash) return res.status(401).json({ error: "Credenciales invalidas" });

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO user_sessions (user_id, token, expires_at) VALUES (?, ?, ?)").run(user.id, token, expiresAt);

  res.setHeader("Set-Cookie", `session_token=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`);
  res.json({ ok: true, username: user.username });
});

app.post("/api/auth/logout", (req, res) => {
  const token = parseCookies(req).session_token;
  if (token) db.prepare("DELETE FROM user_sessions WHERE token = ?").run(token);
  res.setHeader("Set-Cookie", "session_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
  res.json({ ok: true });
});

// ============================================
// RUTAS DE AJUSTES
// ============================================

app.get("/api/settings", (req, res) => res.json(db.prepare("SELECT * FROM settings WHERE id = 1").get()));

app.put("/api/settings", (req, res) => {
  const { default_margin_percent, initial_investment } = req.body;
  db.prepare("UPDATE settings SET default_margin_percent = ?, initial_investment = ? WHERE id = 1")
    .run(default_margin_percent ?? 30, initial_investment ?? 0);
  res.json({ ok: true });
});

// ============================================
// RUTAS DE ADMINISTRACION
// ============================================

function requireAdmin(req, res, next) {
  const token = parseCookies(req).session_token;
  if (!token) return res.status(401).json({ error: "No autenticado" });
  
  const session = db.prepare(`
    SELECT u.role_id, r.is_admin
    FROM user_sessions us
    JOIN users u ON u.id = us.user_id
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE us.token = ? AND us.expires_at > datetime('now')
  `).get(token);
  
  if (!session) return res.status(401).json({ error: "Sesion invalida" });
  if (session.is_admin !== 1) return res.status(403).json({ error: "Acceso denegado" });
  
  req.userId = session.user_id;
  next();
}

app.get("/api/admin/roles", requireAdmin, (req, res) => {
  const roles = db.prepare("SELECT * FROM roles ORDER BY id").all();
  res.json(roles);
});

app.get("/api/admin/modules", requireAdmin, (req, res) => {
  const modules = db.prepare("SELECT * FROM modules ORDER BY id").all();
  res.json(modules);
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.role_id, u.is_active, u.created_at, r.name as role_name
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    ORDER BY u.id DESC
  `).all();
  res.json(users);
});

app.post("/api/admin/users", requireAdmin, (req, res) => {
  const { username, password, role_id } = req.body;
  if (!username || !password || String(password).length < 6) {
    return res.status(400).json({ error: "Usuario y contrasena (minimo 6) son obligatorios" });
  }
  
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) return res.status(400).json({ error: "El usuario ya existe" });
  
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, salt, role_id) VALUES (?, ?, ?, ?)
  `).run(username, hash, salt, role_id || 2);
  
  res.json({ id: info.lastInsertRowid });
});

app.put("/api/admin/users/:id", requireAdmin, (req, res) => {
  const { username, password, role_id, is_active } = req.body;
  const userId = Number(req.params.id);
  
  if (userId === 1) return res.status(400).json({ error: "No se puede modificar el usuario administrador principal" });
  
  if (username) {
    const existing = db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").get(username, userId);
    if (existing) return res.status(400).json({ error: "El nombre de usuario ya existe" });
  }
  
  if (password && password.length < 6) {
    return res.status(400).json({ error: "La contrasena debe tener minimo 6 caracteres" });
  }
  
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  
  if (password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = hashPassword(password, salt);
    db.prepare("UPDATE users SET username = ?, password_hash = ?, salt = ?, role_id = ?, is_active = ? WHERE id = ?")
      .run(username || user.username, hash, salt, role_id ?? user.role_id, is_active !== undefined ? (is_active ? 1 : 0) : user.is_active, userId);
  } else {
    db.prepare("UPDATE users SET username = ?, role_id = ?, is_active = ? WHERE id = ?")
      .run(username || user.username, role_id ?? user.role_id, is_active !== undefined ? (is_active ? 1 : 0) : user.is_active, userId);
  }
  
  res.json({ ok: true });
});

app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  
  if (userId === 1) return res.status(400).json({ error: "No se puede eliminar el usuario administrador principal" });
  
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  
  if (userId === req.userId) return res.status(400).json({ error: "No puedes eliminarte a ti mismo" });
  
  db.prepare("DELETE FROM user_sessions WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM user_permissions WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  
  res.json({ ok: true });
});

app.get("/api/admin/permissions/:userId", requireAdmin, (req, res) => {
  const userId = Number(req.params.userId);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  
  const modules = db.prepare("SELECT * FROM modules ORDER BY id").all();
  const userPerms = db.prepare("SELECT * FROM user_permissions WHERE user_id = ?").all(userId);
  const rolePerms = db.prepare("SELECT * FROM role_permissions WHERE role_id = ?").all(user.role_id);
  
  const permsMap = {};
  for (const p of userPerms) {
    permsMap[p.module_key] = { can_view: p.can_view, can_create: p.can_create, can_edit: p.can_edit, can_delete: p.can_delete, is_custom: 1 };
  }
  for (const p of rolePerms) {
    if (!permsMap[p.module_key]) {
      permsMap[p.module_key] = { can_view: p.can_view, can_create: p.can_create, can_edit: p.can_edit, can_delete: p.can_delete, is_custom: 0 };
    }
  }
  
  const result = modules.map(m => ({
    ...m,
    ...(permsMap[m.key] || { can_view: 1, can_create: 1, can_edit: 1, can_delete: 1, is_custom: 0 })
  }));
  
  res.json(result);
});

app.put("/api/admin/permissions/:userId", requireAdmin, (req, res) => {
  const userId = Number(req.params.userId);
  const { permissions } = req.body;
  
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  if (user.is_admin === 1) return res.status(400).json({ error: "El administrador tiene acceso total" });
  
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM user_permissions WHERE user_id = ?").run(userId);
    
    if (Array.isArray(permissions)) {
      for (const p of permissions) {
        db.prepare(`
          INSERT INTO user_permissions (user_id, module_key, can_view, can_create, can_edit, can_delete)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, p.module_key, p.can_view ? 1 : 0, p.can_create ? 1 : 0, p.can_edit ? 1 : 0, p.can_delete ? 1 : 0);
      }
    }
  });
  
  tx();
  res.json({ ok: true });
});

// ============================================
// RUTAS DE PRODUCTOS
// ============================================

app.get("/api/products", (req, res) => res.json(db.prepare("SELECT * FROM products ORDER BY id DESC").all()));

app.post("/api/products", upload.single("photo"), (req, res) => {
  const { code, name, category, description, features, stock, entry_date, supplier, purchase_price, extra_costs, margin_percent } = req.body;
  const { totalRealCost, salePrice } = calcPricing(purchase_price || 0, extra_costs || 0, margin_percent || 30);
  const currentStock = Number(stock || 0);
  const info = db.prepare(`
    INSERT INTO products (code, name, category, description, features, stock, status, entry_date, supplier, photo_path, purchase_price, extra_costs, total_real_cost, margin_percent, sale_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    code, name, category || "", description || "", features || "", currentStock, productStatus(currentStock),
    entry_date || new Date().toISOString().slice(0, 10), supplier || "", req.file ? `/uploads/${req.file.filename}` : null,
    Number(purchase_price || 0), Number(extra_costs || 0), totalRealCost, Number(margin_percent || 30), salePrice
  );
  res.json({ id: info.lastInsertRowid });
});

app.get("/api/products/:id", (req, res) => {
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(Number(req.params.id));
  if (!product) return res.status(404).json({ error: "Producto no encontrado" });
  res.json(product);
});

app.put("/api/products/:id", upload.single("photo"), (req, res) => {
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(Number(req.params.id));
  if (!product) return res.status(404).json({ error: "Producto no encontrado" });
  
  const { code, name, category, description, features, stock, entry_date, supplier, purchase_price, extra_costs, margin_percent } = req.body;
  const { totalRealCost, salePrice } = calcPricing(purchase_price || product.purchase_price, extra_costs || 0, margin_percent || product.margin_percent);
  const currentStock = Number(stock ?? product.stock);
  
  db.prepare(`
    UPDATE products SET 
      code = ?, name = ?, category = ?, description = ?, features = ?, 
      stock = ?, status = ?, entry_date = ?, supplier = ?, 
      photo_path = ?, purchase_price = ?, extra_costs = ?, 
      total_real_cost = ?, margin_percent = ?, sale_price = ?
    WHERE id = ?
  `).run(
    code || product.code, name || product.name, category ?? product.category,
    description ?? product.description, features ?? product.features,
    currentStock, productStatus(currentStock), entry_date || product.entry_date,
    supplier ?? product.supplier,
    req.file ? `/uploads/${req.file.filename}` : product.photo_path,
    Number(purchase_price ?? product.purchase_price),
    Number(extra_costs ?? product.extra_costs),
    totalRealCost, Number(margin_percent ?? product.margin_percent),
    salePrice, Number(req.params.id)
  );
  res.json({ ok: true });
});

app.delete("/api/products/:id", (req, res) => {
  try {
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(Number(req.params.id));
    if (!product) return res.status(404).json({ error: "Producto no encontrado" });
    
    db.prepare("DELETE FROM sales WHERE product_id = ?").run(Number(req.params.id));
    db.prepare("DELETE FROM purchases WHERE product_id = ?").run(Number(req.params.id));
    db.prepare("DELETE FROM products WHERE id = ?").run(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    console.error("Error deleting product:", err);
    res.status(500).json({ error: "Error al eliminar producto" });
  }
});

// ============================================
// RUTAS DE COMPRAS
// ============================================

app.post("/api/purchases", (req, res) => {
  const { product_id, quantity, purchase_price, supplier, shipping_cost, purchase_date } = req.body;
  const q = Number(quantity);
  const price = Number(purchase_price);
  const ship = Number(shipping_cost || 0);
  const total = q * price + ship;
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(product_id);
  if (!product) return res.status(404).json({ error: "Producto no existe" });

  const tx = db.transaction(() => {
    const purchase = db.prepare(`
      INSERT INTO purchases (product_id, quantity, purchase_price, supplier, shipping_cost, purchase_date, total_invested)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(product_id, q, price, supplier || product.supplier || "", ship, purchase_date, total);

    const newStock = product.stock + q;
    db.prepare("UPDATE products SET stock = ?, status = ?, purchase_price = ?, extra_costs = ? WHERE id = ?")
      .run(newStock, productStatus(newStock), price, ship, product_id);

    db.prepare("INSERT INTO cash_movements (movement_date, type, category, amount, notes) VALUES (?, 'Egreso', 'Compra de productos', ?, ?)")
      .run(purchase_date, total, `Compra producto ${product.name}`);

    return purchase.lastInsertRowid;
  });

  res.json({ id: tx(), total_invested: total });
});

app.get("/api/purchases", (req, res) => {
  const rows = db.prepare("SELECT p.*, pr.name AS product_name FROM purchases p JOIN products pr ON pr.id = p.product_id ORDER BY p.id DESC").all();
  res.json(rows);
});

app.get("/api/purchases/:id", (req, res) => {
  const row = db.prepare("SELECT p.*, pr.name AS product_name FROM purchases p JOIN products pr ON pr.id = p.product_id WHERE p.id = ?").get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Compra no encontrada" });
  res.json(row);
});

app.put("/api/purchases/:id", (req, res) => {
  const { quantity, purchase_price, supplier, shipping_cost, purchase_date } = req.body;
  const purchase = db.prepare("SELECT * FROM purchases WHERE id = ?").get(Number(req.params.id));
  if (!purchase) return res.status(404).json({ error: "Compra no encontrada" });
  
  const tx = db.transaction(() => {
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(purchase.product_id);
    const oldStock = product.stock - purchase.quantity;
    const newQty = Number(quantity ?? purchase.quantity);
    const newPrice = Number(purchase_price ?? purchase.purchase_price);
    const newShip = Number(shipping_cost ?? purchase.shipping_cost);
    const newTotal = newQty * newPrice + newShip;
    
    db.prepare("UPDATE purchases SET quantity = ?, purchase_price = ?, supplier = ?, shipping_cost = ?, purchase_date = ?, total_invested = ? WHERE id = ?")
      .run(newQty, newPrice, supplier || purchase.supplier || "", newShip, purchase_date || purchase.purchase_date, newTotal, Number(req.params.id));
    
    db.prepare("UPDATE products SET stock = ?, purchase_price = ?, extra_costs = ? WHERE id = ?")
      .run(oldStock + newQty, newPrice, newShip, purchase.product_id);
  });
  tx();
  res.json({ ok: true });
});

app.delete("/api/purchases/:id", (req, res) => {
  try {
    const purchase = db.prepare("SELECT * FROM purchases WHERE id = ?").get(Number(req.params.id));
    if (!purchase) return res.status(404).json({ error: "Compra no encontrada" });
    
    const tx = db.transaction(() => {
      const product = db.prepare("SELECT * FROM products WHERE id = ?").get(purchase.product_id);
      if (product) {
        const newStock = product.stock - purchase.quantity;
        db.prepare("UPDATE products SET stock = ?, status = ? WHERE id = ?").run(newStock, productStatus(newStock), purchase.product_id);
      }
      db.prepare("DELETE FROM purchases WHERE id = ?").run(Number(req.params.id));
    });
    tx();
    res.json({ ok: true });
  } catch (err) {
    console.error("Error deleting purchase:", err);
    res.status(500).json({ error: "Error al eliminar compra" });
  }
});

// ============================================
// RUTAS DE CLIENTES
// ============================================

app.post("/api/clients", (req, res) => {
  const { name, phone, address, city } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre es obligatorio" });
  const info = db.prepare("INSERT INTO clients (name, phone, address, city) VALUES (?, ?, ?, ?)").run(name, phone || "", address || "", city || "");
  res.json({ id: info.lastInsertRowid });
});

app.get("/api/clients", (req, res) => res.json(db.prepare("SELECT * FROM clients ORDER BY id DESC").all()));

app.get("/api/clients/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM clients WHERE id = ?").get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Cliente no encontrado" });
  res.json(row);
});

app.put("/api/clients/:id", (req, res) => {
  const { name, phone, address, city } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre es obligatorio" });
  const existing = db.prepare("SELECT * FROM clients WHERE id = ?").get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: "Cliente no encontrado" });
  db.prepare("UPDATE clients SET name = ?, phone = ?, address = ?, city = ? WHERE id = ?").run(name, phone || "", address || "", city || "", Number(req.params.id));
  res.json({ ok: true });
});

app.delete("/api/clients/:id", (req, res) => {
  try {
    const existing = db.prepare("SELECT * FROM clients WHERE id = ?").get(Number(req.params.id));
    if (!existing) return res.status(404).json({ error: "Cliente no encontrado" });
    
    db.prepare("UPDATE sales SET client_id = NULL WHERE client_id = ?").run(Number(req.params.id));
    db.prepare("DELETE FROM clients WHERE id = ?").run(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    console.error("Error deleting client:", err);
    res.status(500).json({ error: "Error al eliminar cliente" });
  }
});

// ============================================
// RUTAS DE VENTAS
// ============================================

app.post("/api/sales", (req, res) => {
  const { sale_date, product_id, quantity, sale_price, client_id, payment_method, includes_shipping, shipping_value } = req.body;
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(product_id);
  if (!product) return res.status(404).json({ error: "Producto no existe" });

  const q = Number(quantity);
  if (q <= 0) return res.status(400).json({ error: "Cantidad invalida" });
  if (product.stock < q) return res.status(400).json({ error: "Stock insuficiente" });

  const unitSale = Number(sale_price || product.sale_price);
  const shipValue = Number(shipping_value || 0);
  const totalAmount = unitSale * q + (Number(includes_shipping) ? shipValue : 0);
  const totalCost = Number(product.total_real_cost) * q;
  const profit = totalAmount - totalCost;

  const saleId = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO sales (sale_date, product_id, quantity, sale_price, client_id, payment_method, includes_shipping, shipping_value, total_amount, total_cost, profit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sale_date, product_id, q, unitSale, client_id || null, payment_method, Number(includes_shipping) ? 1 : 0, shipValue, totalAmount, totalCost, profit);

    const newStock = product.stock - q;
    db.prepare("UPDATE products SET stock = ?, status = ? WHERE id = ?").run(newStock, productStatus(newStock), product_id);
    db.prepare("INSERT INTO cash_movements (movement_date, type, category, amount, notes) VALUES (?, 'Ingreso', 'Ventas', ?, ?)")
      .run(sale_date, totalAmount, `Venta producto ${product.name}`);

    return { id: info.lastInsertRowid, remaining_stock: newStock };
  })();

  res.json({ id: saleId.id, profit, remaining_stock: saleId.remaining_stock });
});

app.get("/api/sales", (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, p.name AS product_name, c.name AS client_name
    FROM sales s
    JOIN products p ON p.id = s.product_id
    LEFT JOIN clients c ON c.id = s.client_id
    ORDER BY s.id DESC
  `).all();
  res.json(rows);
});

app.get("/api/sales/:id", (req, res) => {
  const row = db.prepare(`
    SELECT s.*, p.name AS product_name, c.name AS client_name
    FROM sales s
    JOIN products p ON p.id = s.product_id
    LEFT JOIN clients c ON c.id = s.client_id
    WHERE s.id = ?
  `).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Venta no encontrada" });
  res.json(row);
});

app.put("/api/sales/:id", (req, res) => {
  const { sale_date, quantity, sale_price, payment_method, includes_shipping, shipping_value } = req.body;
  const sale = db.prepare("SELECT * FROM sales WHERE id = ?").get(Number(req.params.id));
  if (!sale) return res.status(404).json({ error: "Venta no encontrada" });
  
  const tx = db.transaction(() => {
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(sale.product_id);
    const oldStock = product.stock + sale.quantity;
    const newQty = Number(quantity ?? sale.quantity);
    const newPrice = Number(sale_price ?? sale.sale_price);
    const newShip = Number(includes_shipping ? (shipping_value ?? sale.shipping_value) : 0);
    const newTotal = newQty * newPrice + newShip;
    const newCost = Number(product.total_real_cost) * newQty;
    const newProfit = newTotal - newCost;
    
    db.prepare("UPDATE sales SET sale_date = ?, quantity = ?, sale_price = ?, payment_method = ?, includes_shipping = ?, shipping_value = ?, total_amount = ?, total_cost = ?, profit = ? WHERE id = ?")
      .run(sale_date || sale.sale_date, newQty, newPrice, payment_method || sale.payment_method, includes_shipping ? 1 : 0, newShip, newTotal, newCost, newProfit, Number(req.params.id));
    
    db.prepare("UPDATE products SET stock = ?, status = ? WHERE id = ?")
      .run(oldStock - newQty, productStatus(oldStock - newQty), sale.product_id);
  });
  tx();
  res.json({ ok: true });
});

app.delete("/api/sales/:id", (req, res) => {
  try {
    const sale = db.prepare("SELECT * FROM sales WHERE id = ?").get(Number(req.params.id));
    if (!sale) return res.status(404).json({ error: "Venta no encontrada" });
    
    const tx = db.transaction(() => {
      const product = db.prepare("SELECT * FROM products WHERE id = ?").get(sale.product_id);
      if (product) {
        const newStock = product.stock + sale.quantity;
        db.prepare("UPDATE products SET stock = ?, status = ? WHERE id = ?").run(newStock, productStatus(newStock), sale.product_id);
      }
      db.prepare("DELETE FROM sales WHERE id = ?").run(Number(req.params.id));
    });
    tx();
    res.json({ ok: true });
  } catch (err) {
    console.error("Error deleting sale:", err);
    res.status(500).json({ error: "Error al eliminar venta" });
  }
});

// ============================================
// RUTAS DE ENVIOS
// ============================================

app.post("/api/shipments", (req, res) => {
  try {
    const { sale_id, client_name, client_address, city, shipping_value, transport_company, status } = req.body;
    
    if (!client_name || !client_address || !city) {
      return res.status(400).json({ error: "Cliente, direccion y ciudad son obligatorios" });
    }
    
    let saleId = null;
    if (sale_id && sale_id !== '') {
      const saleIdNum = Number(sale_id);
      const saleExists = db.prepare("SELECT id FROM sales WHERE id = ?").get(saleIdNum);
      if (saleExists) {
        saleId = saleIdNum;
      }
    }
    
    const info = db.prepare(`
      INSERT INTO shipments (sale_id, client_name, client_address, city, shipping_value, transport_company, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(saleId, client_name, client_address, city, Number(shipping_value || 0), transport_company || "", status || "Pendiente");
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    console.error("Error creating shipment:", err);
    res.status(500).json({ error: "Error al crear envio: " + err.message });
  }
});

app.get("/api/shipments", (req, res) => {
  const rows = db.prepare(`
    SELECT sh.*, s.total_amount as sale_total
    FROM shipments sh
    LEFT JOIN sales s ON s.id = sh.sale_id
    ORDER BY sh.id DESC
  `).all();
  res.json(rows);
});

app.get("/api/shipments/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM shipments WHERE id = ?").get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Envio no encontrado" });
  res.json(row);
});

app.put("/api/shipments/:id", (req, res) => {
  const { client_name, client_address, city, shipping_value, transport_company, status } = req.body;
  if (!client_name || !client_address || !city) {
    return res.status(400).json({ error: "Cliente, direccion y ciudad son obligatorios" });
  }
  const existing = db.prepare("SELECT * FROM shipments WHERE id = ?").get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: "Envio no encontrado" });
  
  db.prepare(`
    UPDATE shipments SET 
      client_name = ?, client_address = ?, city = ?, 
      shipping_value = ?, transport_company = ?, status = ?
    WHERE id = ?
  `).run(client_name, client_address, city, Number(shipping_value || 0), transport_company || "", status || existing.status, Number(req.params.id));
  res.json({ ok: true });
});

app.delete("/api/shipments/:id", (req, res) => {
  try {
    const existing = db.prepare("SELECT * FROM shipments WHERE id = ?").get(Number(req.params.id));
    if (!existing) return res.status(404).json({ error: "Envio no encontrado" });
    db.prepare("DELETE FROM shipments WHERE id = ?").run(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    console.error("Error deleting shipment:", err);
    res.status(500).json({ error: "Error al eliminar envio" });
  }
});

// ============================================
// RUTAS DE CAJA
// ============================================

app.post("/api/cash-movements", (req, res) => {
  const { movement_date, type, category, amount, notes } = req.body;
  if (!movement_date || !type || !category || !amount) {
    return res.status(400).json({ error: "Todos los campos son obligatorios" });
  }
  const info = db.prepare("INSERT INTO cash_movements (movement_date, type, category, amount, notes) VALUES (?, ?, ?, ?, ?)")
    .run(movement_date, type, category, Number(amount), notes || "");
  res.json({ id: info.lastInsertRowid });
});

app.get("/api/cash-movements", (req, res) => {
  let query = "SELECT * FROM cash_movements WHERE 1=1";
  const params = [];
  if (req.query.start_date) {
    query += " AND movement_date >= ?";
    params.push(req.query.start_date);
  }
  if (req.query.end_date) {
    query += " AND movement_date <= ?";
    params.push(req.query.end_date);
  }
  if (req.query.type && req.query.type !== "all") {
    query += " AND type = ?";
    params.push(req.query.type);
  }
  query += " ORDER BY id DESC";
  res.json(db.prepare(query).all(...params));
});

app.delete("/api/cash-movements/:id", (req, res) => {
  try {
    const existing = db.prepare("SELECT * FROM cash_movements WHERE id = ?").get(Number(req.params.id));
    if (!existing) return res.status(404).json({ error: "Movimiento no encontrado" });
    db.prepare("DELETE FROM cash_movements WHERE id = ?").run(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    console.error("Error deleting cash movement:", err);
    res.status(500).json({ error: "Error al eliminar movimiento" });
  }
});

// ============================================
// RUTAS DE REPORTES
// ============================================

app.get("/api/reports/summary", (req, res) => {
  const today = db.prepare("SELECT IFNULL(SUM(total_amount), 0) AS v FROM sales WHERE sale_date = date('now', 'localtime')").get().v;
  const week = db.prepare("SELECT IFNULL(SUM(total_amount), 0) AS v FROM sales WHERE sale_date >= date('now', '-6 day', 'localtime')").get().v;
  const month = db.prepare("SELECT IFNULL(SUM(total_amount), 0) AS v FROM sales WHERE strftime('%Y-%m', sale_date) = strftime('%Y-%m', 'now', 'localtime')").get().v;
  const totalProfit = db.prepare("SELECT IFNULL(SUM(profit), 0) AS v FROM sales").get().v;
  const mostSold = db.prepare("SELECT p.name, IFNULL(SUM(s.quantity), 0) AS qty FROM products p LEFT JOIN sales s ON s.product_id = p.id GROUP BY p.id ORDER BY qty DESC LIMIT 5").all();
  const leastSold = db.prepare("SELECT p.name, IFNULL(SUM(s.quantity), 0) AS qty FROM products p LEFT JOIN sales s ON s.product_id = p.id GROUP BY p.id ORDER BY qty ASC LIMIT 5").all();
  const outOfStock = db.prepare("SELECT * FROM products WHERE stock <= 0 ORDER BY name").all();
  const income = db.prepare("SELECT IFNULL(SUM(amount), 0) AS v FROM cash_movements WHERE type = 'Ingreso'").get().v;
  const expense = db.prepare("SELECT IFNULL(SUM(amount), 0) AS v FROM cash_movements WHERE type = 'Egreso'").get().v;
  res.json({ today, week, month, totalProfit, mostSold, leastSold, outOfStock, income, expense });
});

app.get("/api/reports/charts", (req, res) => {
  const salesByMonth = db.prepare(`
    SELECT strftime('%Y-%m', sale_date) AS month, IFNULL(SUM(total_amount),0) AS total_sales, IFNULL(SUM(profit),0) AS total_profit
    FROM sales GROUP BY strftime('%Y-%m', sale_date) ORDER BY month
  `).all();
  const topProducts = db.prepare("SELECT p.name, IFNULL(SUM(s.quantity),0) AS qty FROM products p LEFT JOIN sales s ON s.product_id = p.id GROUP BY p.id ORDER BY qty DESC LIMIT 10").all();
  res.json({ salesByMonth, topProducts });
});

app.get("/api/cash/summary", (req, res) => {
  const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get();
  const incomes = db.prepare("SELECT IFNULL(SUM(amount),0) AS v FROM cash_movements WHERE type = 'Ingreso'").get().v;
  const expenses = db.prepare("SELECT IFNULL(SUM(amount),0) AS v FROM cash_movements WHERE type = 'Egreso'").get().v;
  const current = Number(settings.initial_investment) + Number(incomes) - Number(expenses);
  res.json({ initial_investment: Number(settings.initial_investment), incomes: Number(incomes), expenses: Number(expenses), current });
});

// ============================================
// RUTAS DE BACKUPS
// ============================================

app.post("/api/backups/create", (req, res) => {
  const file = createBackup("manual");
  res.json({ ok: true, file });
});

app.get("/api/backups", (req, res) => {
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith(".db"))
    .map(f => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { file: f, size: stat.size, updated_at: stat.mtime.toISOString(), url: `/backups/${f}` };
    })
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  res.json(backups);
});

// ============================================
// ARCHIVOS ESTATICOS (siempre al final)
// ============================================

app.use(express.static(path.join(__dirname, "../htdocs")));

// Manejo de errores 404 y 500
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "Ruta no encontrada" });
  } else {
    res.status(404).sendFile(path.join(__dirname, "public", "index.html"));
  }
});

app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({ error: "Error interno del servidor" });
});

app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));

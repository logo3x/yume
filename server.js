const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:NpG_F?/BQWuK8U#@db.fkfcjttsdayflggazgrc.supabase.co:5432/postgres",
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

let db;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "uploads") + "/"),
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

app.use("/uploads", express.static(path.join(__dirname, "uploads"), {
  setHeaders: (res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=31536000");
  }
}));
app.use("/backups", express.static(path.join(__dirname, "backups")));

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result;
  } finally {
    client.release();
  }
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      default_margin_percent REAL DEFAULT 30,
      initial_investment REAL DEFAULT 0
    )
  `);
  await query(`INSERT INTO settings (id, default_margin_percent, initial_investment) VALUES (1, 30, 0) ON CONFLICT (id) DO NOTHING`);

  await query(`CREATE TABLE IF NOT EXISTS modules (id SERIAL PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, icon TEXT DEFAULT '')`);
  await query(`CREATE TABLE IF NOT EXISTS roles (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, is_admin INTEGER DEFAULT 0)`);
  await query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, role_id INTEGER DEFAULT 2, is_active INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT NOW())`);
  await query(`CREATE TABLE IF NOT EXISTS clients (id SERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT, address TEXT, city TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  await query(`CREATE TABLE IF NOT EXISTS products (id SERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, category TEXT, description TEXT, features TEXT, stock INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'Disponible', entry_date TEXT NOT NULL, supplier TEXT, photo_path TEXT, purchase_price REAL NOT NULL DEFAULT 0, extra_costs REAL NOT NULL DEFAULT 0, total_real_cost REAL NOT NULL DEFAULT 0, margin_percent REAL NOT NULL DEFAULT 30, sale_price REAL NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);
  await query(`CREATE TABLE IF NOT EXISTS purchases (id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL, purchase_price REAL NOT NULL, supplier TEXT, shipping_cost REAL NOT NULL DEFAULT 0, purchase_date TEXT NOT NULL, total_invested REAL NOT NULL)`);
  await query(`CREATE TABLE IF NOT EXISTS sales (id SERIAL PRIMARY KEY, sale_date TEXT NOT NULL, product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL, sale_price REAL NOT NULL, client_id INTEGER REFERENCES clients(id), payment_method TEXT NOT NULL, includes_shipping INTEGER NOT NULL DEFAULT 0, shipping_value REAL NOT NULL DEFAULT 0, total_amount REAL NOT NULL, total_cost REAL NOT NULL, profit REAL NOT NULL)`);
  await query(`CREATE TABLE IF NOT EXISTS shipments (id SERIAL PRIMARY KEY, sale_id INTEGER, client_name TEXT NOT NULL, client_address TEXT NOT NULL, city TEXT NOT NULL, shipping_value REAL NOT NULL DEFAULT 0, transport_company TEXT, status TEXT NOT NULL DEFAULT 'Pendiente', created_at TIMESTAMP DEFAULT NOW())`);
  await query(`CREATE TABLE IF NOT EXISTS cash_movements (id SERIAL PRIMARY KEY, movement_date TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('Ingreso','Egreso')), category TEXT NOT NULL, amount REAL NOT NULL, notes TEXT)`);

  const modules = [
    { key: "clientes", name: "Clientes", icon: "👥" },
    { key: "inventario", name: "Inventario", icon: "📦" },
    { key: "compras", name: "Compras", icon: "🛒" },
    { key: "ventas", name: "Ventas", icon: "💰" },
    { key: "envios", name: "Envíos", icon: "🚚" },
    { key: "caja", name: "Caja", icon: "💼" },
    { key: "reportes", name: "Reportes", icon: "📊" },
    { key: "admin", name: "Administración", icon: "⚙️" }
  ];
  for (const m of modules) {
    await query(`INSERT INTO modules (key, name, icon) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING`, [m.key, m.name, m.icon]);
  }
  await query(`INSERT INTO roles (id, name, is_admin) VALUES (1, 'Administrador', 1) ON CONFLICT DO NOTHING`);
  await query(`INSERT INTO roles (id, name, is_admin) VALUES (2, 'Gerente', 0) ON CONFLICT DO NOTHING`);
  await query(`INSERT INTO roles (id, name, is_admin) VALUES (3, 'Vendedor', 0) ON CONFLICT DO NOTHING`);
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

async function requireAuth(req, res, next) {
  const p = req.path;
  if (!p.startsWith("/api/") || p.startsWith("/api/auth/")) return next();
  const token = parseCookies(req).session_token;
  if (!token) return res.status(401).json({ error: "No autenticado" });
  
  const result = await query(`SELECT us.*, u.username FROM user_sessions us JOIN users u ON u.id = us.user_id WHERE us.token = $1`, [token]);
  if (result.rows.length === 0) return res.status(401).json({ error: "Sesion invalida" });
  const session = result.rows[0];
  if (new Date(session.expires_at) < new Date()) {
    await query("DELETE FROM user_sessions WHERE token = $1", [token]);
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

async function createBackup(reason = "manual") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `negocio-${reason}-${stamp}.db`;
  const target = path.join(__dirname, "backups", name);
  saveDb();
  fs.copyFileSync(path.join(__dirname, "negocio.db"), target);
  return name;
}

function saveDb() {
  if (db) {
    const data = db.export();
    fs.writeFileSync(path.join(__dirname, "negocio.db"), Buffer.from(data));
  }
}

app.get("/api/auth/status", async (req, res) => {
  const result = await query("SELECT COUNT(*) as c FROM users");
  const hasUsers = parseInt(result.rows[0].c) > 0;
  const token = parseCookies(req).session_token;
  if (!token) return res.json({ authenticated: false, hasUsers });
  
  const r = await query(`SELECT us.user_id, us.expires_at, u.username, u.role_id, r.name as role_name, r.is_admin FROM user_sessions us JOIN users u ON u.id = us.user_id LEFT JOIN roles r ON r.id = u.role_id WHERE us.token = $1`, [token]);
  if (r.rows.length === 0 || new Date(r.rows[0].expires_at) < new Date()) return res.json({ authenticated: false, hasUsers });
  const s = r.rows[0];
  res.json({ authenticated: true, hasUsers, username: s.username, userId: s.user_id, role: s.role_name, isAdmin: s.is_admin === 1 });
});

app.post("/api/auth/bootstrap", async (req, res) => {
  const result = await query("SELECT COUNT(*) as c FROM users");
  if (parseInt(result.rows[0].c) > 0) return res.status(400).json({ error: "Ya existe un usuario" });
  const { username, password } = req.body;
  if (!username || !password || password.length < 6) return res.status(400).json({ error: "Usuario y contrasena (minimo 6) son obligatorios" });
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  await query("INSERT INTO users (username, password_hash, salt, role_id) VALUES ($1, $2, $3, 1)", [username, hash, salt]);
  res.json({ ok: true });
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  const result = await query("SELECT * FROM users WHERE username = $1", [username]);
  if (result.rows.length === 0) return res.status(401).json({ error: "Credenciales invalidas" });
  const user = result.rows[0];
  const hash = hashPassword(password, user.salt);
  if (hash !== user.password_hash) return res.status(401).json({ error: "Credenciales invalidas" });
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await query("INSERT INTO user_sessions (user_id, token, expires_at) VALUES ($1, $2, $3)", [user.id, token, expiresAt]);
  res.setHeader("Set-Cookie", `session_token=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`);
  res.json({ ok: true, username: user.username });
});

app.post("/api/auth/logout", async (req, res) => {
  const token = parseCookies(req).session_token;
  if (token) await query("DELETE FROM user_sessions WHERE token = $1", [token]);
  res.setHeader("Set-Cookie", "session_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
  res.json({ ok: true });
});

app.get("/api/settings", async (req, res) => {
  const result = await query("SELECT * FROM settings WHERE id = 1");
  res.json(result.rows[0] || { default_margin_percent: 30, initial_investment: 0 });
});

app.put("/api/settings", async (req, res) => {
  const { default_margin_percent, initial_investment } = req.body;
  await query("UPDATE settings SET default_margin_percent = COALESCE($1, 30), initial_investment = COALESCE($2, 0) WHERE id = 1", [default_margin_percent, initial_investment]);
  res.json({ ok: true });
});

async function requireAdmin(req, res, next) {
  const token = parseCookies(req).session_token;
  if (!token) return res.status(401).json({ error: "No autenticado" });
  const result = await query(`SELECT u.role_id, r.is_admin, u.id as user_id FROM user_sessions us JOIN users u ON u.id = us.user_id LEFT JOIN roles r ON r.id = u.role_id WHERE us.token = $1 AND us.expires_at > NOW()`, [token]);
  if (result.rows.length === 0) return res.status(401).json({ error: "Sesion invalida" });
  if (result.rows[0].is_admin !== 1) return res.status(403).json({ error: "Acceso denegado" });
  req.userId = result.rows[0].user_id;
  next();
}

app.get("/api/admin/roles", requireAdmin, async (req, res) => {
  const result = await query("SELECT * FROM roles ORDER BY id");
  res.json(result.rows);
});

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  const result = await query(`SELECT u.id, u.username, u.role_id, u.is_active, u.created_at, r.name as role_name FROM users u LEFT JOIN roles r ON r.id = u.role_id ORDER BY u.id DESC`);
  res.json(result.rows);
});

app.post("/api/admin/users", requireAdmin, async (req, res) => {
  const { username, password, role_id } = req.body;
  if (!username || !password || password.length < 6) return res.status(400).json({ error: "Usuario y contrasena (minimo 6) son obligatorios" });
  const existing = await query("SELECT id FROM users WHERE username = $1", [username]);
  if (existing.rows.length > 0) return res.status(400).json({ error: "El usuario ya existe" });
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  await query("INSERT INTO users (username, password_hash, salt, role_id) VALUES ($1, $2, $3, $4)", [username, hash, salt, role_id || 2]);
  res.json({ id: (await query("SELECT lastval()")).rows[0].lastval });
});

app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.id);
  if (userId === 1) return res.status(400).json({ error: "No se puede eliminar el usuario administrador principal" });
  if (userId === req.userId) return res.status(400).json({ error: "No puedes eliminarte a ti mismo" });
  await query("DELETE FROM user_sessions WHERE user_id = $1", [userId]);
  await query("DELETE FROM users WHERE id = $1", [userId]);
  res.json({ ok: true });
});

app.get("/api/products", async (req, res) => {
  const result = await query("SELECT * FROM products ORDER BY id DESC");
  res.json(result.rows);
});

app.post("/api/products", upload.single("photo"), async (req, res) => {
  const { code, name, category, description, features, stock, entry_date, supplier, purchase_price, extra_costs, margin_percent } = req.body;
  const { totalRealCost, salePrice } = calcPricing(purchase_price || 0, extra_costs || 0, margin_percent || 30);
  const currentStock = Number(stock || 0);
  const photoPath = req.file ? `/uploads/${req.file.filename}` : null;
  const result = await query(
    `INSERT INTO products (code, name, category, description, features, stock, status, entry_date, supplier, photo_path, purchase_price, extra_costs, total_real_cost, margin_percent, sale_price) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
    [code, name, category || "", description || "", features || "", currentStock, productStatus(currentStock), entry_date || new Date().toISOString().slice(0, 10), supplier || "", photoPath, Number(purchase_price || 0), Number(extra_costs || 0), totalRealCost, Number(margin_percent || 30), salePrice]
  );
  res.json({ id: result.rows[0].id });
});

app.put("/api/products/:id", upload.single("photo"), async (req, res) => {
  const id = parseInt(req.params.id);
  const result = await query("SELECT * FROM products WHERE id = $1", [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "Producto no encontrado" });
  const product = result.rows[0];
  const { code, name, category, description, features, stock, entry_date, supplier, purchase_price, extra_costs, margin_percent } = req.body;
  const { totalRealCost, salePrice } = calcPricing(purchase_price ?? product.purchase_price, extra_costs ?? 0, margin_percent ?? product.margin_percent);
  const currentStock = Number(stock ?? product.stock);
  const photoPath = req.file ? `/uploads/${req.file.filename}` : product.photo_path;
  await query(
    `UPDATE products SET code = $1, name = $2, category = $3, description = $4, features = $5, stock = $6, status = $7, entry_date = $8, supplier = $9, photo_path = $10, purchase_price = $11, extra_costs = $12, total_real_cost = $13, margin_percent = $14, sale_price = $15 WHERE id = $16`,
    [code || product.code, name || product.name, category ?? product.category, description ?? product.description, features ?? product.features, currentStock, productStatus(currentStock), entry_date || product.entry_date, supplier ?? product.supplier, photoPath, Number(purchase_price ?? product.purchase_price), Number(extra_costs ?? product.extra_costs), totalRealCost, Number(margin_percent ?? product.margin_percent), salePrice, id]
  );
  res.json({ ok: true });
});

app.delete("/api/products/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await query("DELETE FROM products WHERE id = $1", [id]);
  res.json({ ok: true });
});

app.post("/api/purchases", async (req, res) => {
  const { product_id, quantity, purchase_price, supplier, shipping_cost, purchase_date } = req.body;
  const q = Number(quantity), price = Number(purchase_price), ship = Number(shipping_cost || 0), total = q * price + ship;
  const productResult = await query("SELECT * FROM products WHERE id = $1", [product_id]);
  if (productResult.rows.length === 0) return res.status(404).json({ error: "Producto no existe" });
  const product = productResult.rows[0];
  const result = await query(
    `INSERT INTO purchases (product_id, quantity, purchase_price, supplier, shipping_cost, purchase_date, total_invested) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [product_id, q, price, supplier || product.supplier || "", ship, purchase_date, total]
  );
  const newStock = product.stock + q;
  await query("UPDATE products SET stock = $1, status = $2, purchase_price = $3, extra_costs = $4 WHERE id = $5", [newStock, productStatus(newStock), price, ship, product_id]);
  await query("INSERT INTO cash_movements (movement_date, type, category, amount, notes) VALUES ($1, 'Egreso', 'Compra de productos', $2, $3)", [purchase_date, total, `Compra producto ${product.name}`]);
  res.json({ id: result.rows[0].id, total_invested: total });
});

app.get("/api/purchases", async (req, res) => {
  const result = await query("SELECT p.*, pr.name AS product_name FROM purchases p JOIN products pr ON pr.id = p.product_id ORDER BY p.id DESC");
  res.json(result.rows);
});

app.post("/api/clients", async (req, res) => {
  const { name, phone, address, city } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre es obligatorio" });
  const result = await query("INSERT INTO clients (name, phone, address, city) VALUES ($1, $2, $3, $4) RETURNING id", [name, phone || "", address || "", city || ""]);
  res.json({ id: result.rows[0].id });
});

app.get("/api/clients", async (req, res) => {
  const result = await query("SELECT * FROM clients ORDER BY id DESC");
  res.json(result.rows);
});

app.put("/api/clients/:id", async (req, res) => {
  const { name, phone, address, city } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre es obligatorio" });
  await query("UPDATE clients SET name = $1, phone = $2, address = $3, city = $4 WHERE id = $5", [name, phone || "", address || "", city || "", parseInt(req.params.id)]);
  res.json({ ok: true });
});

app.delete("/api/clients/:id", async (req, res) => {
  await query("DELETE FROM clients WHERE id = $1", [parseInt(req.params.id)]);
  res.json({ ok: true });
});

app.post("/api/sales", async (req, res) => {
  const { sale_date, product_id, quantity, sale_price, client_id, payment_method, includes_shipping, shipping_value } = req.body;
  const productResult = await query("SELECT * FROM products WHERE id = $1", [product_id]);
  if (productResult.rows.length === 0) return res.status(404).json({ error: "Producto no existe" });
  const product = productResult.rows[0];
  const q = Number(quantity);
  if (q <= 0) return res.status(400).json({ error: "Cantidad invalida" });
  if (product.stock < q) return res.status(400).json({ error: "Stock insuficiente" });
  const unitSale = Number(sale_price || product.sale_price), shipValue = Number(shipping_value || 0);
  const totalAmount = unitSale * q + (Number(includes_shipping) ? shipValue : 0);
  const totalCost = Number(product.total_real_cost) * q;
  const profit = totalAmount - totalCost;
  const result = await query(
    `INSERT INTO sales (sale_date, product_id, quantity, sale_price, client_id, payment_method, includes_shipping, shipping_value, total_amount, total_cost, profit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [sale_date, product_id, q, unitSale, client_id || null, payment_method, Number(includes_shipping) ? 1 : 0, shipValue, totalAmount, totalCost, profit]
  );
  const newStock = product.stock - q;
  await query("UPDATE products SET stock = $1, status = $2 WHERE id = $3", [newStock, productStatus(newStock), product_id]);
  await query("INSERT INTO cash_movements (movement_date, type, category, amount, notes) VALUES ($1, 'Ingreso', 'Ventas', $2, $3)", [sale_date, totalAmount, `Venta producto ${product.name}`]);
  res.json({ id: result.rows[0].id, profit, remaining_stock: newStock });
});

app.get("/api/sales", async (req, res) => {
  const result = await query(`SELECT s.*, p.name AS product_name, c.name AS client_name FROM sales s JOIN products p ON p.id = s.product_id LEFT JOIN clients c ON c.id = s.client_id ORDER BY s.id DESC`);
  res.json(result.rows);
});

app.delete("/api/sales/:id", async (req, res) => {
  await query("DELETE FROM sales WHERE id = $1", [parseInt(req.params.id)]);
  res.json({ ok: true });
});

app.post("/api/shipments", async (req, res) => {
  const { client_name, client_address, city, shipping_value, transport_company, status } = req.body;
  if (!client_name || !client_address || !city) return res.status(400).json({ error: "Cliente, direccion y ciudad son obligatorios" });
  const result = await query(
    `INSERT INTO shipments (client_name, client_address, city, shipping_value, transport_company, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [client_name, client_address, city, Number(shipping_value || 0), transport_company || "", status || "Pendiente"]
  );
  res.json({ id: result.rows[0].id });
});

app.get("/api/shipments", async (req, res) => {
  const result = await query("SELECT sh.*, s.total_amount as sale_total FROM shipments sh LEFT JOIN sales s ON s.id = sh.sale_id ORDER BY sh.id DESC");
  res.json(result.rows);
});

app.put("/api/shipments/:id", async (req, res) => {
  const { client_name, client_address, city, shipping_value, transport_company, status } = req.body;
  await query("UPDATE shipments SET client_name = $1, client_address = $2, city = $3, shipping_value = $4, transport_company = $5, status = $6 WHERE id = $7", [client_name, client_address, city, Number(shipping_value || 0), transport_company || "", status || "Pendiente", parseInt(req.params.id)]);
  res.json({ ok: true });
});

app.delete("/api/shipments/:id", async (req, res) => {
  await query("DELETE FROM shipments WHERE id = $1", [parseInt(req.params.id)]);
  res.json({ ok: true });
});

app.post("/api/cash-movements", async (req, res) => {
  const { movement_date, type, category, amount, notes } = req.body;
  if (!movement_date || !type || !category || !amount) return res.status(400).json({ error: "Todos los campos son obligatorios" });
  const result = await query("INSERT INTO cash_movements (movement_date, type, category, amount, notes) VALUES ($1, $2, $3, $4, $5) RETURNING id", [movement_date, type, category, Number(amount), notes || ""]);
  res.json({ id: result.rows[0].id });
});

app.get("/api/cash-movements", async (req, res) => {
  let sql = "SELECT * FROM cash_movements WHERE 1=1";
  const params = [];
  if (req.query.start_date) { sql += " AND movement_date >= $1"; params.push(req.query.start_date); }
  if (req.query.end_date) { sql += ` AND movement_date <= $${params.length + 1}`; params.push(req.query.end_date); }
  if (req.query.type && req.query.type !== "all") { sql += ` AND type = $${params.length + 1}`; params.push(req.query.type); }
  sql += " ORDER BY id DESC";
  const result = await query(sql, params);
  res.json(result.rows);
});

app.get("/api/reports/summary", async (req, res) => {
  const todayR = await query(`SELECT COALESCE(SUM(total_amount), 0) as v FROM sales WHERE DATE(sale_date) = CURRENT_DATE`);
  const weekR = await query(`SELECT COALESCE(SUM(total_amount), 0) as v FROM sales WHERE sale_date >= CURRENT_DATE - INTERVAL '6 days'`);
  const monthR = await query(`SELECT COALESCE(SUM(total_amount), 0) as v FROM sales WHERE DATE_TRUNC('month', sale_date::date) = DATE_TRUNC('month', CURRENT_DATE)`);
  const profitR = await query("SELECT COALESCE(SUM(profit), 0) as v FROM sales");
  const outR = await query("SELECT * FROM products WHERE stock <= 0 ORDER BY name");
  const incomeR = await query(`SELECT COALESCE(SUM(amount), 0) as v FROM cash_movements WHERE type = 'Ingreso'`);
  const expenseR = await query(`SELECT COALESCE(SUM(amount), 0) as v FROM cash_movements WHERE type = 'Egreso'`);
  const mostR = await query(`SELECT p.name, COALESCE(SUM(s.quantity), 0) as qty FROM products p LEFT JOIN sales s ON s.product_id = p.id GROUP BY p.id ORDER BY qty DESC LIMIT 5`);
  res.json({ today: parseFloat(todayR.rows[0].v), week: parseFloat(weekR.rows[0].v), month: parseFloat(monthR.rows[0].v), totalProfit: parseFloat(profitR.rows[0].v), mostSold: mostR.rows, outOfStock: outR.rows, income: parseFloat(incomeR.rows[0].v), expense: parseFloat(expenseR.rows[0].v) });
});

app.get("/api/reports/charts", async (req, res) => {
  const salesByMonth = await query(`SELECT TO_CHAR(sale_date::date, 'YYYY-MM') as month, COALESCE(SUM(total_amount),0) as total_sales, COALESCE(SUM(profit),0) as total_profit FROM sales GROUP BY TO_CHAR(sale_date::date, 'YYYY-MM') ORDER BY month`);
  const topProducts = await query(`SELECT p.name, COALESCE(SUM(s.quantity),0) as qty FROM products p LEFT JOIN sales s ON s.product_id = p.id GROUP BY p.id ORDER BY qty DESC LIMIT 10`);
  res.json({ salesByMonth: salesByMonth.rows, topProducts: topProducts.rows });
});

app.get("/api/reports/filtered", async (req, res) => {
  const { start_date, end_date } = req.query;
  let dateFilter = "";
  let params = [];
  if (start_date && end_date) { dateFilter = " WHERE sale_date >= $1 AND sale_date <= $2"; params = [start_date, end_date]; }
  else if (start_date) { dateFilter = " WHERE sale_date >= $1"; params = [start_date]; }
  else if (end_date) { dateFilter = " WHERE sale_date <= $1"; params = [end_date]; }
  
  const salesR = await query(`SELECT COALESCE(SUM(total_amount),0) as v FROM sales${dateFilter}`, params);
  const profitR = await query(`SELECT COALESCE(SUM(profit),0) as v FROM sales${dateFilter}`, params);
  const qtyR = await query(`SELECT COALESCE(SUM(quantity),0) as v FROM sales${dateFilter}`, params);
  const byDay = await query(`SELECT sale_date as day, COALESCE(SUM(total_amount),0) as total_sales, COALESCE(SUM(profit),0) as total_profit, COALESCE(SUM(quantity),0) as total_qty FROM sales${dateFilter} GROUP BY sale_date ORDER BY sale_date`, params);
  const topP = await query(`SELECT p.name, COALESCE(SUM(s.quantity),0) as qty, COALESCE(SUM(s.total_amount),0) as total FROM sales s JOIN products p ON p.id = s.product_id${dateFilter} GROUP BY p.id ORDER BY qty DESC LIMIT 10`, params);
  res.json({ totalSales: parseFloat(salesR.rows[0].v), totalProfit: parseFloat(profitR.rows[0].v), totalQty: parseInt(qtyR.rows[0].v), salesByDay: byDay.rows, topProducts: topP.rows });
});

app.get("/api/cash/summary", async (req, res) => {
  const settingsR = await query("SELECT * FROM settings WHERE id = 1");
  const incomesR = await query(`SELECT COALESCE(SUM(amount),0) as v FROM cash_movements WHERE type = 'Ingreso'`);
  const expensesR = await query(`SELECT COALESCE(SUM(amount),0) as v FROM cash_movements WHERE type = 'Egreso'`);
  const settings = settingsR.rows[0] || { initial_investment: 0 };
  const current = Number(settings.initial_investment || 0) + Number(incomesR.rows[0].v) - Number(expensesR.rows[0].v);
  res.json({ initial_investment: Number(settings.initial_investment || 0), incomes: Number(incomesR.rows[0].v), expenses: Number(expensesR.rows[0].v), current });
});

app.get("/api/backups", async (req, res) => {
  const BACKUP_DIR = path.join(__dirname, "backups");
  const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith(".db")).map(f => {
    const stat = fs.statSync(path.join(BACKUP_DIR, f));
    return { file: f, size: stat.size, updated_at: stat.mtime.toISOString(), url: `/backups/${f}` };
  }).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  res.json(backups);
});

function escapeCsv(val) {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function toCsv(headers, rows) {
  const headerLine = headers.map(escapeCsv).join(",");
  const dataLines = rows.map(row => headers.map(h => escapeCsv(row[h])).join(","));
  return [headerLine, ...dataLines].join("\n");
}

app.get("/api/export/:type", async (req, res) => {
  const type = req.params.type;
  const tables = {
    products: { headers: ["id", "code", "name", "category", "description", "features", "stock", "status", "entry_date", "supplier", "purchase_price", "extra_costs", "total_real_cost", "margin_percent", "sale_price"], query: "SELECT * FROM products ORDER BY id" },
    clients: { headers: ["id", "name", "phone", "address", "city", "created_at"], query: "SELECT * FROM clients ORDER BY id" },
    sales: { headers: ["id", "sale_date", "product_id", "quantity", "sale_price", "client_id", "payment_method", "includes_shipping", "shipping_value", "total_amount", "total_cost", "profit"], query: "SELECT * FROM sales ORDER BY id" },
    purchases: { headers: ["id", "product_id", "quantity", "purchase_price", "supplier", "shipping_cost", "purchase_date", "total_invested"], query: "SELECT * FROM purchases ORDER BY id" },
    shipments: { headers: ["id", "client_name", "client_address", "city", "shipping_value", "transport_company", "status", "created_at"], query: "SELECT * FROM shipments ORDER BY id" },
    cash_movements: { headers: ["id", "movement_date", "type", "category", "amount", "notes"], query: "SELECT * FROM cash_movements ORDER BY id" }
  };
  if (!tables[type]) return res.status(400).json({ error: "Tipo invalido" });
  const t = tables[type];
  const result = await query(t.query);
  const csv = toCsv(t.headers, result.rows);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${type}_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send("\ufeff" + csv);
});

app.post("/api/import/:type", async (req, res) => {
  const type = req.params.type;
  const { data } = req.body;
  if (!data || !Array.isArray(data)) return res.status(400).json({ error: "Datos invalidos" });
  let imported = 0;
  try {
    for (const row of data) {
      if (type === "products") {
        const exists = await query("SELECT id FROM products WHERE code = $1", [row.code]);
        if (exists.rows.length > 0) {
          await query(`UPDATE products SET name = $1, category = $2, stock = $3, purchase_price = $4, sale_price = $5 WHERE code = $6`,
            [row.name, row.category || "", row.stock || 0, row.purchase_price || 0, row.sale_price || 0, row.code]);
        } else {
          await query(`INSERT INTO products (code, name, category, stock, purchase_price, sale_price) VALUES ($1, $2, $3, $4, $5, $6)`,
            [row.code, row.name, row.category || "", row.stock || 0, row.purchase_price || 0, row.sale_price || 0]);
        }
        imported++;
      } else if (type === "clients") {
        await query("INSERT INTO clients (name, phone, address, city) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [row.name, row.phone || "", row.address || "", row.city || ""]);
        imported++;
      }
    }
  } catch (e) { console.error("Import error:", e); }
  res.json({ ok: true, imported });
});

app.use(express.static(path.join(__dirname, "public")));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) res.status(404).json({ error: "Ruta no encontrada" });
  else res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({ error: "Error interno del servidor" });
});

async function startServer() {
  try {
    if (!fs.existsSync(path.join(__dirname, "uploads"))) fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true });
    if (!fs.existsSync(path.join(__dirname, "backups"))) fs.mkdirSync(path.join(__dirname, "backups"), { recursive: true });
  } catch (e) { console.log("Dir error:", e.message); }
  
  try {
    await initDb();
    console.log("Database connected and initialized");
  } catch (e) {
    console.error("DB init error:", e);
  }
  
  app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
}

startServer().catch(console.error);

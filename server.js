// Zuvo — servidor
// - Sirve el frontend (carpeta /public)
// - Registro / login con base de datos (archivo JSON) y sesión por cookie (JWT)
// - Cartera de cada usuario guardada en el servidor
// - Precios en vivo desde Twelve Data (con caché y refresco automático)

import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = process.env.TWELVE_DATA_API_KEY || "";
const REFRESH_MS = Number(process.env.REFRESH_MS || 60_000);
const JWT_SECRET = process.env.JWT_SECRET || "zuvo-dev-secret-cambia-esto-en-produccion";

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

/* ============================ Base de datos (JSON) ============================
   Sencilla y sin dependencias nativas: guarda usuarios y carteras en data/db.json.
   Para producción real se recomienda migrar a PostgreSQL (p. ej. Supabase/Neon).
============================================================================== */
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return { users: [], portfolios: {} };
  }
}
function saveDB(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
let db = loadDB();

/* ============================ Autenticación ============================ */
function makeToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
}
function setAuthCookie(res, token) {
  res.cookie("zuvo_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}
function authMiddleware(req, res, next) {
  const token = req.cookies?.zuvo_token;
  if (!token) return res.status(401).json({ error: "no_auth" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

app.post("/api/register", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!validEmail(email)) return res.status(400).json({ error: "email_invalido" });
  if (password.length < 8) return res.status(400).json({ error: "password_corta" });
  if (db.users.find((u) => u.email === email)) return res.status(409).json({ error: "email_existe" });

  const passHash = await bcrypt.hash(password, 10);
  const user = { id: "u" + Date.now(), email, passHash };
  db.users.push(user);
  db.portfolios[user.id] = [];
  saveDB(db);
  setAuthCookie(res, makeToken(user));
  res.json({ email: user.email });
});

app.post("/api/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const user = db.users.find((u) => u.email === email);
  if (!user) return res.status(401).json({ error: "credenciales" });
  const ok = await bcrypt.compare(password, user.passHash);
  if (!ok) return res.status(401).json({ error: "credenciales" });
  setAuthCookie(res, makeToken(user));
  res.json({ email: user.email });
});

app.post("/api/logout", (_req, res) => {
  res.clearCookie("zuvo_token");
  res.json({ ok: true });
});

app.get("/api/me", authMiddleware, (req, res) => {
  res.json({ email: req.user.email });
});

/* ============================ Cartera del usuario ============================ */
app.get("/api/portfolio", authMiddleware, (req, res) => {
  res.json({ holdings: db.portfolios[req.user.id] || [] });
});

app.put("/api/portfolio", authMiddleware, (req, res) => {
  const holdings = Array.isArray(req.body?.holdings) ? req.body.holdings : [];
  // saneamos
  const clean = holdings.slice(0, 500).map((h, i) => ({
    id: String(h.id || "h" + Date.now() + i),
    name: String(h.name || "").slice(0, 80),
    ticker: String(h.ticker || "").toUpperCase().slice(0, 20),
    type: String(h.type || "Otros").slice(0, 20),
    qty: Number(h.qty) || 0,
    buyPrice: Number(h.buyPrice) || 0,
    price: Number(h.price) || 0,
  }));
  db.portfolios[req.user.id] = clean;
  saveDB(db);
  res.json({ ok: true, count: clean.length });
});

/* ============================ Precios (Twelve Data) ============================ */
const cache = new Map();
const watchlist = new Set();

async function fetchPrices(symbols) {
  if (!API_KEY) return { error: "no_api_key" };
  if (!symbols.length) return {};
  const url =
    "https://api.twelvedata.com/price?symbol=" +
    encodeURIComponent(symbols.join(",")) +
    "&apikey=" + encodeURIComponent(API_KEY);
  try {
    const r = await fetch(url);
    const data = await r.json();
    const out = {};
    if (symbols.length === 1) {
      if (data && data.price != null) out[symbols[0]] = Number(data.price);
    } else {
      for (const s of symbols) if (data[s]?.price != null) out[s] = Number(data[s].price);
    }
    return out;
  } catch (e) {
    console.error("Twelve Data error:", e.message);
    return { error: "fetch_failed" };
  }
}
async function refreshSymbols(symbols) {
  const now = Date.now();
  const stale = symbols.filter((s) => {
    const c = cache.get(s);
    return !c || now - c.ts > REFRESH_MS;
  });
  if (!stale.length) return;
  const fresh = await fetchPrices(stale);
  if (fresh.error) return fresh;
  for (const [s, p] of Object.entries(fresh)) {
    if (typeof p === "number" && !Number.isNaN(p)) cache.set(s, { price: p, ts: Date.now() });
  }
}
app.get("/api/prices", async (req, res) => {
  const symbols = String(req.query.symbols || "")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  symbols.forEach((s) => watchlist.add(s));
  const result = await refreshSymbols(symbols);
  if (result && result.error === "no_api_key") return res.json({ error: "no_api_key", prices: {} });
  const prices = {};
  for (const s of symbols) { const c = cache.get(s); if (c) prices[s] = { price: c.price, ts: c.ts }; }
  res.json({ prices, updatedAt: Date.now() });
});

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, hasApiKey: Boolean(API_KEY), users: db.users.length, cached: cache.size })
);

app.use(express.static(path.join(__dirname, "public")));

setInterval(() => {
  if (!API_KEY || watchlist.size === 0) return;
  refreshSymbols([...watchlist]);
}, REFRESH_MS);

app.listen(PORT, () => {
  console.log(`Zuvo escuchando en http://localhost:${PORT}`);
  console.log(API_KEY ? "API key detectada ✔" : "SIN API key: precios en modo demo");
  if (JWT_SECRET.startsWith("zuvo-dev-secret")) console.log("AVISO: define JWT_SECRET en producción.");
});

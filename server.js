const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// --- Ensure data directory and DB file exist ---
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({
    siteUrl: '',
    cookies: [],
    keys: [],
    sessions: []
  }, null, 2));
}

function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'supersecretsessionkey_changeme',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 1000 * 60 * 60 * 8 }
}));

// --- Admin credentials from env ---
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme123';

// --- Auth middleware ---
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// ==================== AUTH ROUTES ====================

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.isAdmin = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/admin/check', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// ==================== SITE URL ROUTES ====================

app.get('/api/admin/siteurl', requireAdmin, (req, res) => {
  const db = readDB();
  res.json({ siteUrl: db.siteUrl });
});

app.post('/api/admin/siteurl', requireAdmin, (req, res) => {
  const { siteUrl } = req.body;
  if (!siteUrl) return res.status(400).json({ error: 'siteUrl required' });
  const db = readDB();
  db.siteUrl = siteUrl.trim();
  writeDB(db);
  res.json({ success: true, siteUrl: db.siteUrl });
});

// ==================== COOKIES ROUTES ====================

app.get('/api/admin/cookies', requireAdmin, (req, res) => {
  const db = readDB();
  res.json({ cookies: db.cookies });
});

app.post('/api/admin/cookies', requireAdmin, (req, res) => {
  const { raw } = req.body;
  if (!raw) return res.status(400).json({ error: 'raw cookie string required' });

  // Parse cookie string: "name=value; name2=value2" or JSON array
  let parsed = [];
  try {
    parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error();
  } catch {
    // Try to parse as "name=value; name2=value2"
    parsed = raw.split(';').map(c => {
      const [name, ...rest] = c.trim().split('=');
      return { name: name.trim(), value: rest.join('=').trim() };
    }).filter(c => c.name);
  }

  const db = readDB();
  // Merge: overwrite existing same-name cookies, add new ones
  for (const newCookie of parsed) {
    const idx = db.cookies.findIndex(c => c.name === newCookie.name);
    if (idx >= 0) {
      db.cookies[idx] = newCookie;
    } else {
      db.cookies.push(newCookie);
    }
  }
  writeDB(db);
  res.json({ success: true, cookies: db.cookies });
});

app.delete('/api/admin/cookies', requireAdmin, (req, res) => {
  const db = readDB();
  db.cookies = [];
  writeDB(db);
  res.json({ success: true });
});

app.delete('/api/admin/cookies/:name', requireAdmin, (req, res) => {
  const db = readDB();
  db.cookies = db.cookies.filter(c => c.name !== req.params.name);
  writeDB(db);
  res.json({ success: true });
});

// ==================== KEY ROUTES ====================

function generateKey(length = 32) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let key = '';
  for (let i = 0; i < length; i++) {
    if (i > 0 && i % 8 === 0) key += '-';
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

app.get('/api/admin/keys', requireAdmin, (req, res) => {
  const db = readDB();
  res.json({ keys: db.keys });
});

app.post('/api/admin/keys/generate', requireAdmin, (req, res) => {
  const { count = 1 } = req.body;
  const n = Math.min(parseInt(count) || 1, 100);
  const db = readDB();
  const newKeys = [];
  for (let i = 0; i < n; i++) {
    const key = {
      id: require('uuid').v4(),
      key: generateKey(),
      used: false,
      usedAt: null,
      createdAt: new Date().toISOString(),
      sessionToken: null
    };
    db.keys.push(key);
    newKeys.push(key);
  }
  writeDB(db);
  res.json({ success: true, keys: newKeys });
});

app.delete('/api/admin/keys/:id', requireAdmin, (req, res) => {
  const db = readDB();
  db.keys = db.keys.filter(k => k.id !== req.params.id);
  writeDB(db);
  res.json({ success: true });
});

app.delete('/api/admin/keys', requireAdmin, (req, res) => {
  const db = readDB();
  db.keys = db.keys.filter(k => k.used); // keep used, delete unused
  writeDB(db);
  res.json({ success: true });
});

// ==================== CLIENT REDEEM ROUTE ====================

app.post('/api/redeem', (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'Key required' });

  const db = readDB();
  const keyObj = db.keys.find(k => k.key === key.trim().toUpperCase() && !k.used);
  if (!keyObj) return res.status(404).json({ error: 'Key not found or already used' });

  // Generate session token
  const sessionToken = require('uuid').v4().replace(/-/g, '') + require('uuid').v4().replace(/-/g, '');
  keyObj.used = true;
  keyObj.usedAt = new Date().toISOString();
  keyObj.sessionToken = sessionToken;

  // Build login URL with cookies embedded as query params
  const loginUrl = `${req.protocol}://${req.get('host')}/inject?token=${sessionToken}`;

  writeDB(db);
  res.json({
    success: true,
    loginUrl,
    message: 'Key redeemed. Use the login URL to access the site with your session.'
  });
});

// ==================== INJECT ROUTE ====================

app.get('/inject', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Missing token');

  const db = readDB();
  const keyObj = db.keys.find(k => k.sessionToken === token && k.used);
  if (!keyObj) return res.status(404).send('Invalid or expired token');

  if (!db.siteUrl) return res.status(500).send('Site URL not configured');

  const cookies = db.cookies;
  const siteUrl = db.siteUrl.trim().replace(/\/$/, '');

  // Serve an HTML page that sets cookies on the TARGET domain via a redirect trick
  // Since we can't set cookies on another domain from here, we build a redirect page
  // that uses document.cookie after redirecting to the target origin via an iframe/script
  // The correct approach: serve a script that injects cookies client-side after navigating to target
  const cookieScript = cookies.map(c =>
    `document.cookie = ${JSON.stringify(c.name + '=' + c.value + '; path=/')}; `
  ).join('\n    ');

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Redirecting...</title>
  <style>
    body { background: #0a0a0a; color: #ff2a2a; font-family: 'Courier New', monospace;
           display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .box { text-align: center; }
    .spinner { width: 40px; height: 40px; border: 3px solid #1a1a1a; border-top: 3px solid #ff2a2a;
               border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 20px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    p { color: #888; font-size: 13px; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="box">
    <div class="spinner"></div>
    <div>Injecting session...</div>
    <p>Redirecting to ${siteUrl}</p>
  </div>
  <script>
    // Open target in same window. Since cookies are domain-scoped,
    // we use a relay: navigate to a data: URL trick isn't viable cross-origin.
    // Instead we open target in an iframe, then postMessage is blocked by CORS.
    // Correct production approach: this server proxies a request TO the target site
    // with the cookies set, gets back a session, and redirects with that session.
    // For same-domain or subdomain deployments, this sets cookies directly.

    const targetUrl = ${JSON.stringify(siteUrl)};
    const cookies = ${JSON.stringify(cookies)};

    // If this injector runs on same domain as target (subdomain or same origin),
    // set cookies directly and redirect
    if (window.location.hostname === new URL(targetUrl).hostname ||
        targetUrl.includes(window.location.hostname)) {
      cookies.forEach(c => {
        document.cookie = c.name + '=' + c.value + '; path=/; domain=' + new URL(targetUrl).hostname;
      });
      setTimeout(() => window.location.href = targetUrl, 500);
    } else {
      // Cross-domain: open target in new tab, rely on user having target open
      // OR redirect to target with cookies in localStorage if target supports it
      // Best cross-domain approach: use target's own cookie endpoint if available
      // Fallback: open target and show instructions
      const params = new URLSearchParams();
      cookies.forEach(c => params.append('c', c.name + '=' + c.value));
      // Try to open target with a bookmarklet-style approach
      setTimeout(() => {
        window.location.href = targetUrl;
      }, 800);
    }
  </script>
</body>
</html>`);
});

// ==================== SESSIONS VIEW (admin) ====================

app.get('/api/admin/sessions', requireAdmin, (req, res) => {
  const db = readDB();
  const usedKeys = db.keys.filter(k => k.used).map(k => ({
    key: k.key,
    usedAt: k.usedAt,
    sessionToken: k.sessionToken ? k.sessionToken.substring(0, 16) + '...' : null
  }));
  res.json({ sessions: usedKeys });
});

// ==================== SERVE FRONTEND ====================

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Cookie Injector running on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});

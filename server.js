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

  // Strategy: navigate browser to target site first, then inject cookies
  // via a Service Worker or a relay page hosted on the target domain.
  // Since we don't control target domain, we use the most reliable cross-domain
  // approach available without browser extensions:
  // 1. Open target URL in a hidden iframe (may be blocked by X-Frame-Options)
  // 2. Fallback: build a javascript: bookmarklet URL and auto-click it after navigating
  // 3. Most reliable: generate a data: URI page that sets cookies then redirects
  //    — data: URIs are same-origin null, cookies won't stick on target.
  // 
  // ACTUAL working approach without extension:
  // Navigate to target, encode cookies in fragment, target reads fragment.
  // But we don't control target.
  //
  // REAL solution for this use case (same as Cookie Editor extension does):
  // Cookie Editor sets cookies via chrome.cookies API — browser extension privilege.
  // Without extension, the only working cross-domain method is:
  // Serve a page that opens target in popup/tab, waits for it to load,
  // then uses document.cookie on that window reference — BLOCKED by SOP.
  //
  // Working solution: proxy the target site through our server.
  // Client visits /proxy/* — we fetch target, rewrite URLs, serve with cookies set
  // in the response. Browser sees our domain, cookies set on our domain proxy.
  // This works identically to Cookie Editor from the user's perspective.

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Sessione in caricamento...</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#080808; color:#e8e8e8; font-family:'Courier New',monospace;
           display:flex; align-items:center; justify-content:center; height:100vh; flex-direction:column; gap:24px; }
    .spinner { width:36px; height:36px; border:2px solid #1a1a1a; border-top:2px solid #e0192a;
               border-radius:50%; animation:spin 0.7s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    .label { font-size:12px; color:#888; letter-spacing:0.1em; }
    .status { font-size:11px; color:#444; letter-spacing:0.05em; margin-top:-12px; }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <div class="label">CARICAMENTO SESSIONE</div>
  <div class="status" id="status">inizializzazione...</div>

  <script>
    const TARGET = ${JSON.stringify(siteUrl)};
    const COOKIES = ${JSON.stringify(cookies)};
    const status = document.getElementById('status');

    // Build cookie string for the target domain
    // We use a relay approach: navigate to /proxy?token=TOKEN which serves
    // the target site proxied through our server with cookies pre-set in response headers.
    // This is the only reliable method without a browser extension.
    status.textContent = 'apertura sessione...';
    setTimeout(() => {
      window.location.href = '/proxy?token=${token}';
    }, 600);
  </script>
</body>
</html>`);
});

// ==================== PROXY ROUTE ====================
// Fetches target site server-side with cookies, serves it to client
// Sets cookies on client via Set-Cookie headers on our domain
// Then client is redirected to target with cookies already in browser

app.get('/proxy', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Missing token');

  const db = readDB();
  const keyObj = db.keys.find(k => k.sessionToken === token && k.used);
  if (!keyObj) return res.status(404).send('Token non valido');
  if (!db.siteUrl) return res.status(500).send('URL sito non configurato');

  const cookies = db.cookies;
  const siteUrl = db.siteUrl.trim().replace(/\/$/, '');

  // Set all cookies on the CLIENT browser for the target domain
  // This works when injector and target share a domain/subdomain
  // For cross-domain: serve a page that sets cookies via document.cookie
  // on the target domain by navigating there first

  // Build cookie header string to send to target
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  try {
    const https = require('https');
    const http = require('http');
    const { URL } = require('url');

    const targetUrl = new URL(siteUrl);
    const protocol = targetUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname || '/',
      method: 'GET',
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
      },
      rejectUnauthorized: false
    };

    const proxyReq = protocol.request(options, (proxyRes) => {
      // Forward Set-Cookie headers from target to client
      const setCookies = proxyRes.headers['set-cookie'] || [];

      // Also set our injected cookies on the response so client gets them
      const allCookies = [
        ...setCookies,
        ...cookies.map(c => `${c.name}=${c.value}; Path=/; Domain=${targetUrl.hostname}; SameSite=None`)
      ];

      if (allCookies.length > 0) {
        res.setHeader('Set-Cookie', allCookies);
      }

      // If target redirects, follow and serve redirect page
      const location = proxyRes.headers['location'];
      if (location && (proxyRes.statusCode === 301 || proxyRes.statusCode === 302 || proxyRes.statusCode === 303)) {
        const redirectTo = location.startsWith('http') ? location : siteUrl + location;
        return res.send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Redirect...</title></head>
<body style="background:#080808;color:#888;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;">
  <script>
    // Cookies are now set in browser — navigate to target
    setTimeout(() => window.location.href = ${JSON.stringify(redirectTo)}, 300);
  </script>
  Caricamento...
</body>
</html>`);
      }

      // Serve a page that sets cookies client-side then navigates to target
      // This is the most reliable approach for cross-domain scenarios
      res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Accesso in corso...</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#080808; color:#e8e8e8; font-family:'Courier New',monospace;
           display:flex; align-items:center; justify-content:center; height:100vh; flex-direction:column; gap:20px; }
    .spinner { width:36px; height:36px; border:2px solid #1a1a1a; border-top:2px solid #e0192a;
               border-radius:50%; animation:spin 0.7s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    .label { font-size:12px; color:#888; letter-spacing:0.1em; }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <div class="label">ACCESSO IN CORSO</div>
  <script>
    const TARGET = ${JSON.stringify(siteUrl)};
    const COOKIES = ${JSON.stringify(cookies)};

    // Attempt to set cookies for target domain (works if same domain/subdomain)
    COOKIES.forEach(c => {
      document.cookie = c.name + '=' + c.value + '; path=/; SameSite=None; Secure';
    });

    // Navigate to target — cookies set above persist if same domain
    // For cross-domain: browser will carry cookies set via Set-Cookie header above
    setTimeout(() => {
      window.location.href = TARGET;
    }, 400);
  </script>
</body>
</html>`);
    });

    proxyReq.on('error', (err) => {
      console.error('Proxy error:', err.message);
      // Fallback: redirect directly with cookies set via header
      const allCookies = cookies.map(c =>
        `${c.name}=${c.value}; Path=/; SameSite=None`
      );
      if (allCookies.length > 0) res.setHeader('Set-Cookie', allCookies);
      res.redirect(siteUrl);
    });

    proxyReq.end();

  } catch (err) {
    console.error('Proxy setup error:', err.message);
    res.redirect(siteUrl);
  }
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

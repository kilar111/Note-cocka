// server.js
// Simple Express backend for a student study-materials website.
// Features:
// - Serves static frontend from /public
// - Stores posts in a simple JSON file (data/posts.json)
// - Image upload via multer to /public/uploads
// - Admin login via session auth + bcrypt password hash in .env
//
// To generate a bcrypt hash for a password (run in Node REPL):
//   node
//   > const bcrypt = require('bcrypt');
//   > bcrypt.hashSync('yourPasswordHere', 10)
// Then put the hash into ADMIN_PASSWORD_BCRYPT in your .env

const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const net = require('net');

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const multer = require('multer');
require('dotenv').config();

const app = express();

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_me';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD_BCRYPT = process.env.ADMIN_PASSWORD_BCRYPT || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function constantTimeEqual(a, b) {
  const aStr = String(a || '');
  const bStr = String(b || '');
  const aBuf = Buffer.from(aStr, 'utf8');
  const bBuf = Buffer.from(bStr, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

const DATA_DIR = path.join(__dirname, 'data');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const POSTS_EXAMPLE_FILE = path.join(DATA_DIR, 'posts.example.json');

const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Session cookie-based authentication.
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // secure: true, // enable this when serving over HTTPS
      maxAge: 1000 * 60 * 60 * 8 // 8 hours
    }
  })
);

// Serve frontend + uploaded images.
app.use(express.static(PUBLIC_DIR));

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

function requireAdminPage(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect('/admin-login');
}

async function readPostsDb() {
  // Read the whole JSON file as our simple DB.
  // On some hosts (or fresh deploys) the file may not exist.
  try {
    const raw = await fs.readFile(POSTS_FILE, 'utf8');
    const db = JSON.parse(raw);
    if (!db.posts || !Array.isArray(db.posts)) db.posts = [];
    return db;
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      // Fall back to example data if present, otherwise return empty.
      try {
        const rawExample = await fs.readFile(POSTS_EXAMPLE_FILE, 'utf8');
        const dbExample = JSON.parse(rawExample);
        if (!dbExample.posts || !Array.isArray(dbExample.posts)) dbExample.posts = [];
        return dbExample;
      } catch {
        return { posts: [] };
      }
    }
    throw err;
  }
}

async function writePostsDb(db) {
  // Atomic write to avoid corrupting JSON if the process crashes mid-write.
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tempFile = POSTS_FILE + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  await fs.writeFile(tempFile, JSON.stringify(db, null, 2), 'utf8');
  await fs.rename(tempFile, POSTS_FILE);
}

async function deleteLocalUpload(imagePath) {
  // Only delete files we created under /public/uploads.
  if (!imagePath) return;
  const p = String(imagePath);
  if (!p.startsWith('/uploads/')) return;
  const filename = p.replace('/uploads/', '');
  if (!filename) return;
  const abs = path.join(UPLOADS_DIR, filename);
  try {
    await fs.unlink(abs);
  } catch {
    // ignore missing file
  }
}

function safeString(value) {
  return String(value || '').trim();
}

function safeUrl(value) {
  // Accept only http(s) URLs.
  const raw = safeString(value);
  if (!raw) return '';
  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  try {
    const u = new URL(candidate);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {
    // ignore
  }
  return '';
}

function isPrivateIp(ip) {
  // Basic private-range checks to reduce SSRF risk.
  if (!ip) return true;
  if (ip === '127.0.0.1' || ip === '::1') return true;

  // IPv4
  if (net.isIP(ip) === 4) {
    const parts = ip.split('.').map((n) => Number(n));
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  // IPv6 (very rough): block local/link-local/unique-local
  const v = ip.toLowerCase();
  if (v.startsWith('fc') || v.startsWith('fd')) return true; // unique local
  if (v.startsWith('fe80')) return true; // link-local
  return false;
}

function isAllowedFacebookUrl(urlString) {
  // Only allow Facebook domains for the import feature.
  const url = safeUrl(urlString);
  if (!url) return false;
  const u = new URL(url);

  const host = (u.hostname || '').toLowerCase();
  const allowedHosts = [
    'facebook.com',
    'www.facebook.com',
    'web.facebook.com',
    'm.facebook.com',
    'fb.watch'
  ];

  const isAllowed = allowedHosts.includes(host) || host.endsWith('.facebook.com');
  if (!isAllowed) return false;

  // Block direct IP hosts.
  if (net.isIP(host)) return false;

  return true;
}

function decodeHtmlEntities(str) {
  // Tiny decoder for the most common entities in OG tags.
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractMeta(html, key) {
  // Tries: <meta property="og:key" content="..."> or <meta name="key" content="...">
  const safeHtml = String(html || '');
  const patterns = [
    new RegExp(`<meta[^>]+property=["']og:${key}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:${key}["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*name=["']${key}["'][^>]*>`, 'i')
  ];
  for (const re of patterns) {
    const m = safeHtml.match(re);
    if (m && m[1]) return decodeHtmlEntities(m[1].trim());
  }
  return '';
}

function extractJsonLdBlocks(html) {
  // Extract <script type="application/ld+json"> blocks.
  const blocks = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const raw = (m[1] || '').trim();
    if (raw) blocks.push(raw);
  }
  return blocks;
}

function findFirstStringDeep(value, keys, maxDepth = 6) {
  // Recursively search objects/arrays for the first non-empty string under any of the keys.
  const wanted = new Set(keys.map((k) => String(k).toLowerCase()));

  function walk(node, depth) {
    if (depth > maxDepth) return '';
    if (!node) return '';

    if (typeof node === 'string') return '';

    if (Array.isArray(node)) {
      for (const item of node) {
        const hit = walk(item, depth + 1);
        if (hit) return hit;
      }
      return '';
    }

    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (wanted.has(String(k).toLowerCase()) && typeof v === 'string') {
          const s = safeString(v);
          if (s) return s;
        }
      }
      for (const v of Object.values(node)) {
        const hit = walk(v, depth + 1);
        if (hit) return hit;
      }
    }

    return '';
  }

  return walk(value, 0);
}

function extractFromJsonLd(html) {
  // Some FB video/watch pages expose usable info via JSON-LD.
  const blocks = extractJsonLdBlocks(html);
  for (const raw of blocks) {
    try {
      const json = JSON.parse(raw);
      const title = findFirstStringDeep(json, ['headline', 'name', 'title']);
      const description = findFirstStringDeep(json, ['description', 'caption', 'articleBody']);
      const imageUrl = findFirstStringDeep(json, ['thumbnailUrl', 'contentUrl', 'image']);
      if (title || description || imageUrl) {
        return { title, description, imageUrl };
      }
    } catch {
      // ignore invalid JSON-LD
    }
  }
  return { title: '', description: '', imageUrl: '' };
}

async function fetchText(urlString, timeoutMs = 6500) {
  // Uses global fetch if available (Node 18+), otherwise falls back to http/https.
  if (typeof fetch === 'function') {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(urlString, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; NoteKokkaBot/1.0)',
          accept: 'text/html,application/xhtml+xml'
        }
      });
      return await res.text();
    } finally {
      clearTimeout(t);
    }
  }

  return await new Promise((resolve, reject) => {
    try {
      const u = new URL(urlString);
      const mod = u.protocol === 'http:' ? http : https;
      const req = mod.request(
        urlString,
        {
          method: 'GET',
          headers: {
            'user-agent': 'Mozilla/5.0 (compatible; NoteKokkaBot/1.0)',
            accept: 'text/html,application/xhtml+xml'
          }
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve(data));
        }
      );
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timeout')));
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

function normalizeDriveLinks(input) {
  // Accept either array or a comma/newline-separated string.
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .map((s) => safeString(s))
      .filter(Boolean);
  }
  const raw = String(input);
  return raw
    .split(/\r?\n|,/g)
    .map((s) => safeString(s))
    .filter(Boolean);
}

// Configure multer for image uploads.
const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (_req, file, cb) {
    // Create a unique filename while keeping extension.
    const ext = path.extname(file.originalname || '').toLowerCase();
    const base = crypto.randomBytes(12).toString('hex');
    cb(null, `${base}${ext || '.jpg'}`);
  }
});

function imageFileFilter(_req, file, cb) {
  // Basic check: allow common image types.
  const ok = /^(image\/png|image\/jpeg|image\/jpg|image\/webp|image\/gif)$/i.test(file.mimetype);
  cb(ok ? null : new Error('Only image files are allowed'), ok);
}

const upload = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 3 * 1024 * 1024 } // 3MB
});

// ---------- API: public ----------

// List all posts (newest first)
app.get('/api/posts', async (_req, res) => {
  try {
    const db = await readPostsDb();
    const posts = [...db.posts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ posts });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read posts' });
  }
});

// Get a single post by id
app.get('/api/posts/:id', async (req, res) => {
  try {
    const id = safeString(req.params.id);
    const db = await readPostsDb();
    const post = db.posts.find((p) => String(p.id) === id);
    if (!post) return res.status(404).json({ error: 'Not found' });
    res.json({ post });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read post' });
  }
});

// ---------- API: admin/auth ----------

app.get('/api/admin/me', (req, res) => {
  // Used by the frontend to decide whether to show dashboard UI.
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const username = safeString(req.body.username);
    const password = safeString(req.body.password);

    const userOk = username === ADMIN_USERNAME;
    let passOk = false;

    if (ADMIN_PASSWORD_BCRYPT) {
      passOk = await bcrypt.compare(password, ADMIN_PASSWORD_BCRYPT);
    } else if (ADMIN_PASSWORD) {
      // Fallback for hosts like Vercel: set ADMIN_PASSWORD as a secret env var.
      // (Recommended is still ADMIN_PASSWORD_BCRYPT.)
      passOk = constantTimeEqual(password, ADMIN_PASSWORD);
    } else {
      return res.status(500).json({
        error:
          'Admin password not configured. Set ADMIN_PASSWORD_BCRYPT (recommended) or ADMIN_PASSWORD in environment variables.'
      });
    }

    if (!userOk || !passOk) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.isAdmin = true;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// Create a new post (admin only)
app.post('/api/admin/posts', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const title = safeString(req.body.title);
    const description = safeString(req.body.description);
    const category = safeString(req.body.category);
    const driveLinks = normalizeDriveLinks(req.body.driveLinks);
    const sourceUrl = safeUrl(req.body.sourceUrl);
    const imageUrl = safeUrl(req.body.imageUrl);

    if (!title || !description || !category) {
      return res.status(400).json({ error: 'Title, description, and category are required' });
    }

    // Prefer uploaded file; otherwise allow an external image URL (useful for FB import).
    const imagePath = req.file ? `/uploads/${req.file.filename}` : (imageUrl || '');

    const post = {
      id: crypto.randomUUID(),
      title,
      description,
      imagePath,
      category,
      driveLinks,
      sourceUrl,
      createdAt: new Date().toISOString()
    };

    const db = await readPostsDb();
    db.posts.push(post);
    await writePostsDb(db);

    res.status(201).json({ post });
  } catch (err) {
    // Multer file filter errors end up here too.
    res.status(400).json({ error: err.message || 'Failed to create post' });
  }
});

// List all posts for admin (newest first)
app.get('/api/admin/posts', requireAdmin, async (_req, res) => {
  try {
    const db = await readPostsDb();
    const posts = [...db.posts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ posts });
  } catch {
    res.status(500).json({ error: 'Failed to read posts' });
  }
});

// Update a post (admin only)
app.put('/api/admin/posts/:id', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const id = safeString(req.params.id);
    const title = safeString(req.body.title);
    const description = safeString(req.body.description);
    const category = safeString(req.body.category);
    const driveLinks = normalizeDriveLinks(req.body.driveLinks);
    const sourceUrl = safeUrl(req.body.sourceUrl);
    const imageUrl = safeUrl(req.body.imageUrl);
    const clearImage = safeString(req.body.clearImage).toLowerCase() === 'true';

    if (!title || !description || !category) {
      return res.status(400).json({ error: 'Title, description, and category are required' });
    }

    const db = await readPostsDb();
    const idx = db.posts.findIndex((p) => String(p.id) === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    const prev = db.posts[idx];
    let imagePath = prev.imagePath || '';

    if (req.file) {
      // Replace with newly uploaded image.
      await deleteLocalUpload(imagePath);
      imagePath = `/uploads/${req.file.filename}`;
    } else if (clearImage) {
      await deleteLocalUpload(imagePath);
      imagePath = '';
    } else if (imageUrl) {
      // Replace with external image URL.
      await deleteLocalUpload(imagePath);
      imagePath = imageUrl;
    }

    const updated = {
      ...prev,
      title,
      description,
      category,
      driveLinks,
      imagePath,
      sourceUrl
    };

    db.posts[idx] = updated;
    await writePostsDb(db);

    res.json({ post: updated });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to update post' });
  }
});

// Delete a post (admin only)
app.delete('/api/admin/posts/:id', requireAdmin, async (req, res) => {
  try {
    const id = safeString(req.params.id);
    const db = await readPostsDb();
    const idx = db.posts.findIndex((p) => String(p.id) === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    const removed = db.posts.splice(idx, 1)[0];
    await deleteLocalUpload(removed.imagePath);
    await writePostsDb(db);

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

// Preview metadata from a Facebook post link (admin only)
// This helps auto-fill title/description/image when admin pastes a FB post URL.
app.get('/api/admin/fb-preview', requireAdmin, async (req, res) => {
  try {
    const url = safeUrl(req.query.url);
    if (!url) return res.status(400).json({ error: 'Missing url' });
    if (!isAllowedFacebookUrl(url)) {
      return res.status(400).json({ error: 'Only Facebook links are allowed for preview' });
    }

    const u = new URL(url);
    // Block IP-literal hosts (extra SSRF guard).
    if (net.isIP(u.hostname) && isPrivateIp(u.hostname)) {
      return res.status(400).json({ error: 'Blocked host' });
    }

    const html = await fetchText(url);

    // Primary (works on many public FB links): OpenGraph
    let title = extractMeta(html, 'title') || extractMeta(html, 'site_name') || extractMeta(html, 'twitter:title');
    let description = extractMeta(html, 'description') || extractMeta(html, 'twitter:description') || extractMeta(html, 'description');
    let imageUrl = extractMeta(html, 'image') || extractMeta(html, 'image:url') || extractMeta(html, 'twitter:image');

    // Fallback (helps for some FB video/watch pages): JSON-LD
    if (!title || !description || !imageUrl) {
      const ld = extractFromJsonLd(html);
      if (!title && ld.title) title = ld.title;
      if (!description && ld.description) description = ld.description;
      if (!imageUrl && ld.imageUrl) imageUrl = ld.imageUrl;
    }

    if (!title && !description && !imageUrl) {
      // Facebook sometimes returns login/interstitial pages depending on privacy.
      return res.status(422).json({
        error: 'Could not read preview details from this link. Try a public post link or fill fields manually.'
      });
    }

    res.json({
      title: safeString(title),
      description: safeString(description),
      imageUrl: safeUrl(imageUrl),
      sourceUrl: url
    });
  } catch (err) {
    res.status(400).json({ error: 'Failed to preview link' });
  }
});

// ---------- Admin route ----------

// Admin login page (shows login UI when not authenticated)
app.get('/admin-login', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

// Admin dashboard (only reachable when authenticated)
app.get('/admin', requireAdminPage, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

// Prevent direct access to the static admin file path.
app.get('/admin.html', (_req, res) => {
  res.redirect('/admin-login');
});

// Convenience: home + post details are static HTML
app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/post', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'post.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

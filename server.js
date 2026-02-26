require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const drillRoutes = require('./routes/drill');
const statsRoutes = require('./routes/stats');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Railway's proxy for correct client IP + secure cookies
app.set('trust proxy', 1);

// Security headers (only upgrade-insecure-requests in production)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'media-src': ["'self'", 'blob:'],
      'upgrade-insecure-requests': process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
  },
}));

// Protect HTML pages (except login.html) before static serving
app.use((req, res, next) => {
  // Let non-GET requests through (handled by route handlers)
  if (req.method !== 'GET') return next();
  // Allow login page, CSS, JS, and other static assets
  if (req.path === '/login.html' || req.path.startsWith('/css/') || req.path.startsWith('/js/') || req.path.startsWith('/images/')) {
    return next();
  }
  // For HTML page requests, require auth
  const isPageRequest = req.path === '/' || req.path.endsWith('.html');
  if (isPageRequest && (!req.session || !req.session.authenticated)) {
    return res.redirect('/login.html');
  }
  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// --- Auth routes (no auth middleware) ---

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const authUser = process.env.AUTH_USER;
    const authHash = process.env.AUTH_PASS_HASH;

    if (!authUser || !authHash) {
      return res.status(500).json({ error: 'Server authentication not configured' });
    }

    if (username !== authUser) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, authHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.authenticated = true;
    res.json({ ok: true });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// --- Auth middleware for all API routes ---

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// Rate limiting on API routes: 30 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

app.use('/api/', requireAuth, apiLimiter);

app.use('/api/drill', drillRoutes);
app.use('/api/stats', statsRoutes);

// Auto-seed if database is empty (first deploy)
const { getDb } = require('./db/index');
try {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) as n FROM vocabulary_status').get().n;
  if (count === 0) {
    console.log('Empty database detected, running seed...');
    require('./db/seed');
  }
} catch (err) {
  console.error('Auto-seed check failed:', err.message);
}

// Pre-generate drill queue for instant first drills
const { fillQueue } = require('./lib/drillQueue');
fillQueue();

app.listen(PORT, () => {
  console.log(`Japanese Trainer running at http://localhost:${PORT}`);
});

/**
 * PIN auth + /admin/pins API + protected data routes.
 */
const {
    initPinStore,
    authenticatePin,
    resolveSession,
    signToken,
    listPins,
    createPin,
    updatePin,
    deletePin,
    randomPin,
    isUniqueViolation,
    pool,
    TOKEN_TTL_MS,
} = require('./pins');
const { renderAdminPage } = require('./adminPage');

function tokenFrom(req) {
    const header = req.get('authorization') || '';
    if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
    if (typeof req.query.token === 'string') return req.query.token.trim();
    if (req.headers.cookie) {
        const match = req.headers.cookie.match(/(?:^|;\s*)welearn_pin_token=([^;]+)/);
        if (match) return decodeURIComponent(match[1]).trim();
    }
    return '';
}

// --- rate limiting for PIN guesses (in-memory, per IP) ---
const attempts = new Map();
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const ATTEMPT_MAX = 15;

function tooManyAttempts(key) {
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || now - entry.first > ATTEMPT_WINDOW_MS) {
        attempts.set(key, { first: now, count: 1 });
        return 0;
    }
    entry.count += 1;
    if (attempts.size > 5000) {
        for (const [k, v] of attempts) {
            if (now - v.first > ATTEMPT_WINDOW_MS) attempts.delete(k);
        }
    }
    return entry.count > ATTEMPT_MAX ? Math.ceil((ATTEMPT_WINDOW_MS - (now - entry.first)) / 1000) : 0;
}

function clearAttempts(key) {
    attempts.delete(key);
}

// --- middlewares ---

async function requirePin(req, res, next) {
    try {
        const pin = await resolveSession(tokenFrom(req));
        if (!pin) return res.status(401).json({ error: 'PIN required' });
        req.pin = pin;
        next();
    } catch (err) {
        console.error('PIN session check failed:', err.message);
        res.status(503).json({ error: 'Auth service unavailable' });
    }
}

function requireAdmin(req, res, next) {
    requirePin(req, res, () => {
        if (req.pin.role !== 'admin') {
            return res.status(403).json({ error: 'Admin PIN required' });
        }
        next();
    });
}

const PROTECTED = [
    /^\/api\/subjects\/?$/,
    /^\/api\/questions(\/|$)/,
    /^\/questions(\/|$)/,
    /^\/view(\/|$)/,
];

function pinGuard(req, res, next) {
    if (PROTECTED.some(re => re.test(req.path))) return requirePin(req, res, next);
    next();
}

function asyncHandler(fn) {
    return async (req, res) => {
        try {
            await fn(req, res);
        } catch (err) {
            const status = err.status || 500;
            if (status >= 500) console.error(err);
            res.status(status).json({ error: status >= 500 ? 'Internal error' : err.message });
        }
    };
}

function registerPinRoutes(app) {
    // Public health probe (Railway healthcheck) — never touches the PIN store.
    app.get('/api/health', async (req, res) => {
        let db = 'unknown';
        try {
            await pool.query('select 1');
            db = 'up';
        } catch (err) {
            db = 'down';
        }
        res.json({ ok: true, db, time: new Date().toISOString() });
    });

    // Unlock with a PIN -> session token
    app.post('/api/auth/pin', asyncHandler(async (req, res) => {
        const ip = (req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
        const retryAfter = tooManyAttempts(`pin:${ip}`);
        if (retryAfter) {
            res.set('Retry-After', String(retryAfter));
            return res.status(429).json({ error: `Too many attempts. Try again in ${retryAfter}s` });
        }
        const pin = await authenticatePin(req.body && req.body.pin);
        if (!pin) return res.status(401).json({ error: 'Wrong PIN' });
        clearAttempts(`pin:${ip}`);
        const token = await signToken(pin);
        res.json({
            token,
            expiresIn: TOKEN_TTL_MS,
            username: pin.username,
            role: pin.role,
        });
    }));

    // Self-registration for user role accounts
    app.post('/api/auth/register', asyncHandler(async (req, res) => {
        const body = req.body || {};
        const username = String(body.username || '').trim();
        const pin = String(body.pin || '').trim() || randomPin(6);
        if (!username) return res.status(400).json({ error: 'Username is required' });
        if (!/^[0-9]{4,10}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4 to 10 digits' });

        try {
            const created = await createPin({
                username,
                pin,
                role: 'user',
                note: 'Self-registered user',
            });
            const token = await signToken(created);
            res.status(201).json({
                token,
                expiresIn: TOKEN_TTL_MS,
                username: created.username,
                role: created.role,
                pin: created.pin,
            });
        } catch (err) {
            if (isUniqueViolation(err)) {
                return res.status(409).json({ error: `Username "${username}" already exists` });
            }
            throw err;
        }
    }));

    // Validate a stored token on boot
    app.get('/api/auth/me', asyncHandler(async (req, res) => {
        const pin = await resolveSession(tokenFrom(req));
        if (!pin) return res.status(401).json({ error: 'PIN required' });
        res.json({ username: pin.username, role: pin.role });
    }));

    // ---- admin: manage PIN accounts ----
    app.get('/api/admin/pins', requireAdmin, asyncHandler(async (req, res) => {
        res.json({ pins: await listPins(), actor: { id: req.pin.id, username: req.pin.username } });
    }));

    app.post('/api/admin/pins', requireAdmin, asyncHandler(async (req, res) => {
        const body = req.body || {};
        const pin = String(body.pin || '').trim() || randomPin();
        try {
            const created = await createPin({
                username: body.username,
                pin,
                role: body.role === 'admin' ? 'admin' : 'user',
                note: body.note,
            });
            res.status(201).json({ pin: created });
        } catch (err) {
            if (isUniqueViolation(err)) {
                return res.status(409).json({ error: `Username "${body.username}" already exists` });
            }
            throw err;
        }
    }));

    app.patch('/api/admin/pins/:id', requireAdmin, asyncHandler(async (req, res) => {
        try {
            res.json({ pin: await updatePin(req.params.id, req.body || {}, req.pin.id) });
        } catch (err) {
            if (isUniqueViolation(err)) {
                return res.status(409).json({ error: `Username "${(req.body || {}).username}" already exists` });
            }
            throw err;
        }
    }));

    app.delete('/api/admin/pins/:id', requireAdmin, asyncHandler(async (req, res) => {
        res.json({ deleted: await deletePin(req.params.id, req.pin.id) });
    }));

    // ---- admin UI ----
    app.get(['/admin', '/admin/'], (req, res) => res.redirect('/admin/pins'));
    app.get('/admin/pins', (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.send(renderAdminPage());
    });
}

module.exports = {
    registerPinRoutes,
    pinGuard,
    requirePin,
    requireAdmin,
    initPinStore,
};

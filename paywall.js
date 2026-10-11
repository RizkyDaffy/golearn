const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ADMIN_CODE = process.env.ADMIN_ACCESS_CODE || 'R130109D';
const SESSION_COOKIE = 'golearn_session';
const SESSION_IDLE_MS = 60 * 60 * 1000;
const PAYMENT_TTL_MS = 5 * 60 * 1000;
const CODE_TTL_MS = 2 * 24 * 60 * 60 * 1000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '.data');
const STORE_FILE = path.join(DATA_DIR, 'paywall-store.json');

let store;
let loading;
let saveChain = Promise.resolve();

async function getStore() {
    if (store) return store;
    if (!loading) {
        loading = (async () => {
            await fs.promises.mkdir(DATA_DIR, { recursive: true });
            try {
                store = JSON.parse(await fs.promises.readFile(STORE_FILE, 'utf8'));
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
                store = { keys: {}, sessions: {}, payments: {} };
            }
            store.keys ||= {};
            store.sessions ||= {};
            store.payments ||= {};
            return store;
        })();
    }
    return loading;
}

function saveStore() {
    const snapshot = JSON.stringify(store, null, 2);
    saveChain = saveChain.then(async () => {
        await fs.promises.mkdir(DATA_DIR, { recursive: true });
        const tempFile = `${STORE_FILE}.tmp`;
        await fs.promises.writeFile(tempFile, snapshot, { mode: 0o600 });
        await fs.promises.rename(tempFile, STORE_FILE);
    });
    return saveChain;
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function cookieValue(req, name) {
    for (const cookie of (req.headers.cookie || '').split(';')) {
        const separator = cookie.indexOf('=');
        if (separator >= 0 && cookie.slice(0, separator).trim() === name) {
            return decodeURIComponent(cookie.slice(separator + 1).trim());
        }
    }
    return null;
}

function setSessionCookie(res, token) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
}

function clearSessionCookie(res) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function createKey(code, now = Date.now()) {
    return { code, createdAt: now, expiresAt: now + CODE_TTL_MS, redeemedAt: null, active: true, activeSessionHash: null, admin: false };
}

function generateCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function publicKey(key) {
    return { code: key.code, createdAt: key.createdAt, expiresAt: key.expiresAt, redeemedAt: key.redeemedAt, active: key.active, activeSession: Boolean(key.activeSessionHash) };
}

async function authenticate(req, res, next) {
    try {
        const token = cookieValue(req, SESSION_COOKIE);
        if (!token) return res.status(401).json({ error: 'Silakan masukkan access code.' });
        const db = await getStore();
        const tokenHash = hashToken(token);
        const session = db.sessions[tokenHash];
        const key = session && db.keys[session.code];
        const now = Date.now();
        if (!session || !key || !key.active || key.activeSessionHash !== tokenHash) {
            clearSessionCookie(res);
            return res.status(401).json({ error: 'Sesi tidak valid. Masukkan kembali access code.' });
        }
        if (!key.admin && now - session.lastSeenAt > SESSION_IDLE_MS) {
            delete db.sessions[tokenHash];
            key.activeSessionHash = null;
            await saveStore();
            clearSessionCookie(res);
            return res.status(401).json({ error: 'Sesi berakhir karena tidak aktif selama satu jam.' });
        }
        req.access = { key, session, tokenHash };
        next();
    } catch (error) {
        console.error('Paywall authentication failed:', error);
        res.status(500).json({ error: 'Gagal memeriksa sesi.' });
    }
}

function requireAdmin(req, res, next) {
    if (!req.access?.key.admin) return res.status(403).json({ error: 'Akses admin diperlukan.' });
    next();
}

function normalizeProviderStatus(payload) {
    const status = String(payload?.payment?.status || payload?.transaction?.status || payload?.status || '').toLowerCase();
    if (['completed', 'success', 'paid', 'settlement'].includes(status)) return 'paid';
    if (['failed', 'expired', 'cancelled', 'canceled', 'deny'].includes(status)) return 'failed';
    return 'pending';
}

async function checkPakasirPayment(payment) {
    const url = new URL('https://app.pakasir.com/api/transactiondetail');
    url.search = new URLSearchParams({
        project: process.env.PAKASIR_PROJECT,
        order_id: payment.orderId,
        amount: String(payment.amount),
        api_key: process.env.PAKASIR_API_KEY,
    });
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(body.message || 'Pakasir gagal memeriksa transaksi.');
        error.status = 502;
        throw error;
    }
    return normalizeProviderStatus(body);
}

function asyncRoute(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function registerPaywallRoutes(app) {
    app.get('/api/paywall/config', (req, res) => {
        const amount = Number(process.env.PAKASIR_AMOUNT || 5000);
        const validAmount = Number.isSafeInteger(amount) && amount > 0;
        res.json({ amount: validAmount ? amount : null, currency: process.env.PAKASIR_CURRENCY || 'IDR', configured: Boolean(process.env.PAKASIR_PROJECT && process.env.PAKASIR_API_KEY && validAmount) });
    });

    app.post('/api/paywall/payment', asyncRoute(async (req, res) => {
        const amount = Number(process.env.PAKASIR_AMOUNT || 5000);
        if (!process.env.PAKASIR_PROJECT || !process.env.PAKASIR_API_KEY || !Number.isSafeInteger(amount) || amount <= 0) {
            return res.status(503).json({ error: 'Pembayaran belum dikonfigurasi oleh admin.' });
        }
        const orderId = `GL${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const response = await fetch('https://app.pakasir.com/api/transactioncreate', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ project: process.env.PAKASIR_PROJECT, order_id: orderId, amount, method: process.env.PAKASIR_METHOD || 'qris', api_key: process.env.PAKASIR_API_KEY }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.error) return res.status(502).json({ error: body.message || body.error || 'Pakasir gagal membuat pembayaran.' });

        const id = crypto.randomUUID();
        const providerPayment = body.payment || body;
        const now = Date.now();
        const db = await getStore();
        db.payments[id] = {
            id, orderId, amount, createdAt: now, expiresAt: now + PAYMENT_TTL_MS, status: 'pending',
            paymentNumber: providerPayment.payment_number || providerPayment.qr_string || providerPayment.payment_code || null,
            paymentMethod: providerPayment.payment_method || providerPayment.method || 'QRIS',
            paymentUrl: providerPayment.payment_url || providerPayment.checkout_url || null,
            code: null,
        };
        await saveStore();
        res.status(201).json({ id, amount, expiresAt: db.payments[id].expiresAt, paymentNumber: db.payments[id].paymentNumber, paymentMethod: db.payments[id].paymentMethod, paymentUrl: db.payments[id].paymentUrl });
    }));

    app.get('/api/paywall/payment/:id', asyncRoute(async (req, res) => {
        const db = await getStore();
        const payment = db.payments[req.params.id];
        if (!payment) return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
        if (payment.status === 'pending' && Date.now() >= payment.expiresAt) {
            payment.status = 'expired';
            await saveStore();
        }
        if (payment.status === 'pending') {
            const providerStatus = await checkPakasirPayment(payment);
            if (providerStatus === 'paid') {
                let code;
                do { code = generateCode(); } while (db.keys[code]);
                db.keys[code] = createKey(code);
                payment.status = 'paid';
                payment.code = code;
                payment.paidAt = Date.now();
                await saveStore();
            } else if (providerStatus === 'failed') {
                payment.status = 'failed';
                await saveStore();
            }
        }
        res.json({
            status: payment.status,
            code: payment.status === 'paid' ? payment.code : null,
            expiresAt: payment.expiresAt,
            paymentNumber: payment.paymentNumber,
            paymentMethod: payment.paymentMethod,
            paymentUrl: payment.paymentUrl,
        });
    }));

    app.delete('/api/paywall/payment/:id', asyncRoute(async (req, res) => {
        const db = await getStore();
        const payment = db.payments[req.params.id];
        if (!payment) return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
        if (payment.status === 'pending') {
            payment.status = 'cancelled';
            await saveStore();
        }
        res.json({ status: payment.status });
    }));

    app.post('/api/auth/redeem', asyncRoute(async (req, res) => {
        const submittedCode = String(req.body?.code || '').trim().toUpperCase();
        if (!submittedCode || submittedCode.length > 80) return res.status(400).json({ error: 'Masukkan access code.' });
        const db = await getStore();
        const now = Date.now();
        let key;
        if (submittedCode === ADMIN_CODE.toUpperCase()) {
            key = db.keys[submittedCode] || { code: submittedCode, createdAt: now, expiresAt: null, redeemedAt: null, active: true, activeSessionHash: null, admin: true };
            key.admin = true;
            key.active = true;
            key.expiresAt = null;
            db.keys[submittedCode] = key;
        } else {
            key = db.keys[submittedCode];
            if (!key || !key.active || (!key.redeemedAt && key.expiresAt <= now)) return res.status(401).json({ error: 'Access code tidak valid atau sudah kedaluwarsa.' });
        }
        if (key.activeSessionHash) delete db.sessions[key.activeSessionHash];
        const token = crypto.randomBytes(32).toString('base64url');
        const tokenHash = hashToken(token);
        key.redeemedAt ||= now;
        key.activeSessionHash = tokenHash;
        db.sessions[tokenHash] = { code: key.code, lastSeenAt: now, admin: Boolean(key.admin) };
        await saveStore();
        setSessionCookie(res, token);
        res.json({ admin: Boolean(key.admin), code: key.admin ? null : key.code, expiresAt: key.expiresAt });
    }));

    app.get('/api/auth/session', authenticate, (req, res) => {
        res.json({ authenticated: true, admin: Boolean(req.access.key.admin), expiresAt: req.access.key.expiresAt });
    });

    app.post('/api/auth/touch', authenticate, asyncRoute(async (req, res) => {
        req.access.session.lastSeenAt = Date.now();
        await saveStore();
        res.json({ ok: true });
    }));

    app.post('/api/auth/logout', asyncRoute(async (req, res) => {
        const token = cookieValue(req, SESSION_COOKIE);
        if (token) {
            const db = await getStore();
            const tokenHash = hashToken(token);
            const session = db.sessions[tokenHash];
            if (session) {
                delete db.sessions[tokenHash];
                const key = db.keys[session.code];
                if (key?.activeSessionHash === tokenHash) key.activeSessionHash = null;
                await saveStore();
            }
        }
        clearSessionCookie(res);
        res.json({ ok: true });
    }));

    app.get('/api/admin/keys', authenticate, requireAdmin, asyncRoute(async (req, res) => {
        const db = await getStore();
        res.json({ keys: Object.values(db.keys).filter(key => !key.admin).map(publicKey) });
    }));

    app.post('/api/admin/keys', authenticate, requireAdmin, asyncRoute(async (req, res) => {
        const db = await getStore();
        const code = String(req.body?.code || generateCode()).trim().toUpperCase();
        if (!/^[A-Z0-9-]{4,40}$/.test(code) || code === ADMIN_CODE.toUpperCase()) return res.status(400).json({ error: 'Kode harus 4-40 karakter (A-Z, 0-9, tanda hubung).' });
        if (db.keys[code]) return res.status(409).json({ error: 'Kode sudah digunakan.' });
        const days = Number(req.body?.expiresInDays ?? 2);
        if (!Number.isFinite(days) || days < 1 || days > 3650) return res.status(400).json({ error: 'Masa berlaku harus 1 sampai 3650 hari.' });
        const key = createKey(code);
        key.expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
        db.keys[code] = key;
        await saveStore();
        res.status(201).json({ key: publicKey(key) });
    }));

    app.patch('/api/admin/keys/:code', authenticate, requireAdmin, asyncRoute(async (req, res) => {
        const db = await getStore();
        const key = db.keys[String(req.params.code).toUpperCase()];
        if (!key || key.admin) return res.status(404).json({ error: 'Kode tidak ditemukan.' });
        if (typeof req.body?.active === 'boolean') {
            key.active = req.body.active;
            if (!key.active && key.activeSessionHash) {
                delete db.sessions[key.activeSessionHash];
                key.activeSessionHash = null;
            }
        }
        if (req.body?.expiresAt !== undefined) {
            const expiresAt = req.body.expiresAt === null ? null : Date.parse(req.body.expiresAt);
            if (expiresAt !== null && !Number.isFinite(expiresAt)) return res.status(400).json({ error: 'Tanggal kedaluwarsa tidak valid.' });
            key.expiresAt = expiresAt;
        }
        await saveStore();
        res.json({ key: publicKey(key) });
    }));

    app.delete('/api/admin/keys/:code', authenticate, requireAdmin, asyncRoute(async (req, res) => {
        const db = await getStore();
        const code = String(req.params.code).toUpperCase();
        const key = db.keys[code];
        if (!key || key.admin) return res.status(404).json({ error: 'Kode tidak ditemukan.' });
        if (key.activeSessionHash) delete db.sessions[key.activeSessionHash];
        delete db.keys[code];
        await saveStore();
        res.json({ deleted: true });
    }));
}

module.exports = { registerPaywallRoutes, authenticate };
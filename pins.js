/**
 * PIN accounts store (Neon Postgres).
 * 1 row = 1 account = 1 PIN + a username. Roles: 'user' | 'admin'.
 *
 * PINs are never stored in plain text:
 *  - pin_hash   : scrypt(pin, randomSalt)  -> verified on login
 *  - pin_lookup : HMAC(pepper, pin)        -> lets us find the row for a typed PIN
 * The pepper and the token signing key live in app_settings (created on first boot),
 * so nothing sensitive is committed to git.
 */
const crypto = require('crypto');
const { Pool } = require('pg');

// Set DATABASE_URL on Railway to avoid using the committed default.
const DEFAULT_DATABASE_URL = 'postgresql://neondb_owner:npg_IT51xrmvAgkP@ep-wandering-lab-a7qnso58-pooler.ap-southeast-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX || 5),
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
});

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PIN_PATTERN = /^[0-9]{4,10}$/;

const SCHEMA = `
create table if not exists pins (
    id           uuid primary key default gen_random_uuid(),
    username     text not null,
    pin_hash     text not null,
    pin_lookup   text not null,
    role         text not null default 'user' check (role in ('user', 'admin')),
    active       boolean not null default true,
    note         text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    last_used_at timestamptz
);
create unique index if not exists pins_username_lower_key on pins (lower(username));
create unique index if not exists pins_pin_lookup_key on pins (pin_lookup);
create table if not exists app_settings (
    key        text primary key,
    value      text not null,
    updated_at timestamptz not null default now()
);
`;

// ---------------------------------------------------------------- helpers

function b64url(input) {
    return Buffer.from(input).toString('base64url');
}

function fromB64url(input) {
    return Buffer.from(input, 'base64url').toString('utf8');
}

function randomPin(len = 6) {
    let out = '';
    while (out.length < len) out += crypto.randomInt(0, 10).toString();
    return out;
}

function hashPin(pin, salt) {
    const hash = crypto.scryptSync(String(pin), salt, 64, { N: 16384, r: 8, p: 1 });
    return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPin(pin, stored) {
    const parts = String(stored || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const actual = crypto.scryptSync(String(pin), salt, expected.length, { N: 16384, r: 8, p: 1 });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------- settings

const settingCache = new Map();

async function getSetting(key, generate) {
    if (settingCache.has(key)) return settingCache.get(key);
    const found = await pool.query('select value from app_settings where key = $1', [key]);
    if (found.rowCount) {
        settingCache.set(key, found.rows[0].value);
        return found.rows[0].value;
    }
    const value = generate();
    await pool.query(
        'insert into app_settings (key, value) values ($1, $2) on conflict (key) do nothing',
        [key, value]
    );
    const stored = await pool.query('select value from app_settings where key = $1', [key]);
    const resolved = stored.rows[0].value;
    settingCache.set(key, resolved);
    return resolved;
}

const getPepper = () => getSetting('pin_pepper', () => crypto.randomBytes(32).toString('hex'));
const getTokenSecret = () => getSetting('token_secret', () => crypto.randomBytes(32).toString('hex'));

function pinLookup(pin, pepper) {
    return crypto.createHmac('sha256', pepper).update(String(pin)).digest('base64url');
}

// ---------------------------------------------------------------- boot

async function initPinStore() {
    await pool.query(SCHEMA);
    await getPepper();
    await getTokenSecret();

    const admins = await pool.query("select 1 from pins where role = 'admin' limit 1");
    if (admins.rowCount) return null;

    const pin = (process.env.ADMIN_PIN || '').trim();
    const generated = !PIN_PATTERN.test(pin);
    const finalPin = generated ? randomPin() : pin;
    const username = (process.env.ADMIN_USERNAME || 'admin').trim() || 'admin';
    const row = await createPin({ username, pin: finalPin, role: 'admin', note: 'seeded on first boot' });
    return { username: row.username, pin: finalPin, generated };
}

// ---------------------------------------------------------------- tokens

async function signToken(pinRow) {
    const secret = await getTokenSecret();
    const body = {
        pid: pinRow.id,
        username: pinRow.username,
        role: pinRow.role,
        exp: Date.now() + TOKEN_TTL_MS,
    };
    const payload = b64url(JSON.stringify(body));
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
}

async function verifyToken(token) {
    if (typeof token !== 'string' || !token.includes('.')) return null;
    const [payload, sig] = token.split('.');
    const secret = await getTokenSecret();
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const a = Buffer.from(sig || '', 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    let body;
    try {
        body = JSON.parse(fromB64url(payload));
    } catch (_) {
        return null;
    }
    if (!body || typeof body.pid !== 'string' || Date.now() > Number(body.exp)) return null;
    return body;
}

// ---------------------------------------------------------------- auth

async function authenticatePin(pin) {
    const value = String(pin || '');
    if (!PIN_PATTERN.test(value)) return null;
    const pepper = await getPepper();
    const found = await pool.query(
        'select * from pins where pin_lookup = $1 and active = true limit 1',
        [pinLookup(value, pepper)]
    );
    const row = found.rows[0];
    if (!row || !verifyPin(value, row.pin_hash)) return null;
    await pool.query('update pins set last_used_at = now() where id = $1', [row.id]);
    return row;
}

// Resolve a token to a live, still-active account (cached so we don't hit Neon per request).
const sessionCache = new Map();
const SESSION_CACHE_MS = 60 * 1000;

async function resolveSession(token) {
    const body = await verifyToken(token);
    if (!body) return null;
    const cached = sessionCache.get(body.pid);
    if (cached && Date.now() - cached.at < SESSION_CACHE_MS) return cached.pin;
    const found = await pool.query(
        'select id, username, role, active from pins where id = $1 limit 1',
        [body.pid]
    );
    const row = found.rows[0];
    if (!row || !row.active) return null;
    const pin = { id: row.id, username: row.username, role: row.role };
    sessionCache.set(body.pid, { at: Date.now(), pin });
    return pin;
}

function invalidateSession(pinId) {
    sessionCache.delete(pinId);
}

// ---------------------------------------------------------------- CRUD

function publicRow(row) {
    return {
        id: row.id,
        username: row.username,
        role: row.role,
        active: row.active,
        note: row.note ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_used_at: row.last_used_at ?? null,
    };
}

async function listPins() {
    const res = await pool.query(
        'select id, username, role, active, note, created_at, updated_at, last_used_at from pins order by (role = \'admin\') desc, lower(username)'
    );
    return res.rows.map(publicRow);
}

async function createPin({ username, pin, role = 'user', note = null }) {
    const cleanName = String(username || '').trim();
    if (!cleanName || cleanName.length > 40) throw badRequest('Username must be 1-40 characters');
    if (!PIN_PATTERN.test(String(pin || ''))) throw badRequest('PIN must be 4-10 digits');
    if (!['user', 'admin'].includes(role)) throw badRequest('Role must be user or admin');

    const pepper = await getPepper();
    const res = await pool.query(
        `insert into pins (username, pin_hash, pin_lookup, role, note)
         values ($1, $2, $3, $4, $5)
         returning id, username, role, active, note, created_at, updated_at, last_used_at`,
        [cleanName, hashPin(pin, crypto.randomBytes(16)), pinLookup(pin, pepper), role, note]
    );
    return { ...publicRow(res.rows[0]), pin };
}

async function updatePin(id, changes, actorId) {
    const current = await pool.query('select * from pins where id = $1 limit 1', [id]);
    const row = current.rows[0];
    if (!row) {
        const err = new Error('PIN not found');
        err.status = 404;
        throw err;
    }

    const updates = [];
    const values = [];
    const set = (column, value) => {
        values.push(value);
        updates.push(`${column} = $${values.length}`);
    };

    const nextUsername = changes.username !== undefined ? String(changes.username).trim() : row.username;
    if (nextUsername !== row.username) {
        if (!nextUsername || nextUsername.length > 40) throw badRequest('Username must be 1-40 characters');
        set('username', nextUsername);
    }

    let revealPin = null;
    if (changes.pin !== undefined && changes.pin !== null && changes.pin !== '') {
        if (!PIN_PATTERN.test(String(changes.pin))) throw badRequest('PIN must be 4-10 digits');
        const pepper = await getPepper();
        set('pin_hash', hashPin(changes.pin, crypto.randomBytes(16)));
        set('pin_lookup', pinLookup(changes.pin, pepper));
        revealPin = String(changes.pin);
    }

    if (changes.role !== undefined && changes.role !== row.role) {
        if (!['user', 'admin'].includes(changes.role)) throw badRequest('Role must be user or admin');
        if (id === actorId) throw badRequest('You cannot change your own role');
        set('role', changes.role);
    }

    if (changes.active !== undefined && Boolean(changes.active) !== row.active) {
        if (id === actorId) throw badRequest('You cannot disable your own PIN');
        set('active', Boolean(changes.active));
    }

    if (changes.note !== undefined) set('note', changes.note === null ? null : String(changes.note).slice(0, 200));

    if (!updates.length) return publicRow(row);

    set('updated_at', new Date());
    values.push(id);
    const res = await pool.query(
        `update pins set ${updates.join(', ')} where id = $${values.length}
         returning id, username, role, active, note, created_at, updated_at, last_used_at`,
        values
    );
    invalidateSession(id);
    const out = publicRow(res.rows[0]);
    if (revealPin) out.pin = revealPin;
    return out;
}

async function deletePin(id, actorId) {
    if (id === actorId) throw badRequest('You cannot delete the PIN you are signed in with');
    const res = await pool.query('delete from pins where id = $1 returning id', [id]);
    if (!res.rowCount) {
        const err = new Error('PIN not found');
        err.status = 404;
        throw err;
    }
    invalidateSession(id);
    return { id };
}

function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

function isUniqueViolation(err) {
    return err && err.code === '23505';
}

async function closePinStore() {
    await pool.end();
}

module.exports = {
    pool,
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
    closePinStore,
    PIN_PATTERN,
    TOKEN_TTL_MS,
};

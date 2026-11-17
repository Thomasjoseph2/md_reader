// Shared helpers for the API functions (no database code here: see api/_repo). Files starting with "_" are not routes.
const crypto = require('crypto');

const LIMITS = {
  maxBytes: 2 * 1024 * 1024,   // all Markdown text in one link
  maxFiles: 300,
  maxPathLen: 300,
  maxPassword: 200,
  maxEmails: 50,
  perUserPerHour: 20,
  maxFailed: 5,
  lockMinutes: 10,
  expiryDays: [1, 7, 30],
  sessionDays: 30,
};

const send = (res, code, body) => { res.setHeader('Cache-Control', 'no-store'); res.status(code).json(body); };

// All callers are our own pages on the same origin, so there is no CORS. Cookie-authenticated POSTs must come from
// our own site (Origin check) and be JSON (which browsers will not send cross-site without a preflight).
function guardPost(req, res) {
  if (req.method !== 'POST') { send(res, 405, { error: 'Use POST.' }); return true; }
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) { send(res, 403, { error: 'Not allowed.' }); return true; }
  if (!/^application\/json/i.test(req.headers['content-type'] || '')) { send(res, 415, { error: 'Send JSON.' }); return true; }
  return false;
}

function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (/^localhost|^127\./.test(host) ? 'http' : 'https');
  return `${proto.split(',')[0]}://${host}`;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = (n = 32) => crypto.randomBytes(n).toString('base64url');
const newId = () => randomToken(16);
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{22}$/.test(id);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${crypto.scryptSync(pw, salt, 64).toString('base64')}`;
}
function checkPassword(pw, stored) {
  const [kind, s, k] = String(stored).split('$');
  if (kind !== 'scrypt' || typeof pw !== 'string') return false;
  const key = crypto.scryptSync(pw, Buffer.from(s, 'base64'), 64), want = Buffer.from(k, 'base64');
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
function cleanEmails(list) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > LIMITS.maxEmails * 4) return null;
  const out = new Set();
  for (const e of list) {
    const v = String(e).trim().toLowerCase();
    if (!v) continue;
    if (v.length > 254 || !EMAIL_RE.test(v)) return null;
    out.add(v);
  }
  return out.size > LIMITS.maxEmails ? null : [...out];
}

module.exports = { LIMITS, send, guardPost, appUrl, sha256, randomToken, newId, validId, hashPassword, checkPassword, cleanEmails };

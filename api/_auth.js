// Cookie sessions. The cookie holds a random token; only its hash is stored (see repo.sessions).
const repo = require('./_repo');
const { sha256, randomToken, LIMITS } = require('./_lib');

const SID = 'mdv_sid';

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(req, res, name, value, { maxAgeSec, httpOnly = true } = {}) {
  const secure = (req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https' || process.env.NODE_ENV === 'production';
  const c = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax${httpOnly ? '; HttpOnly' : ''}${secure ? '; Secure' : ''}; Max-Age=${maxAgeSec}`;
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
}

async function currentUser(req) {
  const tok = parseCookies(req)[SID];
  return tok ? repo.sessions.getUser(sha256(tok)) : null;
}
async function startSession(req, res, userId) {
  const tok = randomToken(32);
  await repo.sessions.create(userId, sha256(tok), new Date(Date.now() + LIMITS.sessionDays * 864e5));
  setCookie(req, res, SID, tok, { maxAgeSec: LIMITS.sessionDays * 86400 });
}
async function endSession(req, res) {
  const tok = parseCookies(req)[SID];
  if (tok) await repo.sessions.remove(sha256(tok));
  setCookie(req, res, SID, '', { maxAgeSec: 0 });
}

module.exports = { parseCookies, setCookie, currentUser, startSession, endSession };

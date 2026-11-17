// Who may open a shared doc. Used by /api/doc (read) and /api/save (edit), so both apply the same rules.
// Resolves to { ok: true } or { ok: false, status, body }.
const L = require('./_lib');
const repo = require('./_repo');

module.exports = async function authorize(doc, user, password) {
  const no = (status, body) => ({ ok: false, status, body });
  if (user && user.id === doc.ownerId) return { ok: true };
  if (doc.visibility === 'restricted') {
    if (!user) return no(401, { needsLogin: true });
    if (!doc.emails.includes(user.email)) return no(403, { error: 'This doc is not shared with you. Ask the owner to add you, or sign in with a different Google account.' });
    return { ok: true };
  }
  if (doc.passwordHash) {
    if (doc.lockedUntil && new Date(doc.lockedUntil) > new Date()) return no(429, { error: 'Too many wrong passwords. Try again in a few minutes.', needsPassword: true });
    if (password == null || password === '') return no(401, { needsPassword: true });
    if (!L.checkPassword(password, doc.passwordHash)) {
      await repo.docs.registerFailedAttempt(doc.id, L.LIMITS.maxFailed, L.LIMITS.lockMinutes);
      return no(401, { needsPassword: true, wrong: true });
    }
    if (doc.failedAttempts) await repo.docs.clearFailedAttempts(doc.id);
  }
  return { ok: true };
};

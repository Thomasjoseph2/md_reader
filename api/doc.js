// POST /api/doc  { id, password? }  ->  { title, files, expiresAt, isOwner }
//   401 { needsLogin }     restricted doc, not signed in
//   403 { error }          signed in, but not on the list
//   401 { needsPassword }  link doc with a password
const L = require('./_lib');
const repo = require('./_repo');
const { currentUser } = require('./_auth');

module.exports = async (req, res) => {
  if (L.guardPost(req, res)) return;
  try {
    const { id, password } = req.body || {};
    const gone = () => L.send(res, 404, { error: 'This link does not exist or has expired.' });
    if (!L.validId(id)) return gone();
    const doc = await repo.docs.get(id);
    if (!doc) return gone();
    const user = await currentUser(req);
    const out = () => L.send(res, 200, { title: doc.title, files: doc.files, expiresAt: doc.expiresAt, isOwner: !!user && user.id === doc.ownerId, role: doc.role, allowExport: doc.allowExport });

    if (user && user.id === doc.ownerId) return out();

    if (doc.visibility === 'restricted') {
      if (!user) return L.send(res, 401, { needsLogin: true });
      if (!doc.emails.includes(user.email)) return L.send(res, 403, { error: 'This doc is not shared with you. Ask the owner to add you, or sign in with a different Google account.' });
      return out();
    }

    if (doc.passwordHash) {
      if (doc.lockedUntil && new Date(doc.lockedUntil) > new Date()) return L.send(res, 429, { error: 'Too many wrong passwords. Try again in a few minutes.', needsPassword: true });
      if (password == null || password === '') return L.send(res, 401, { needsPassword: true });
      if (!L.checkPassword(password, doc.passwordHash)) {
        await repo.docs.registerFailedAttempt(id, L.LIMITS.maxFailed, L.LIMITS.lockMinutes);
        return L.send(res, 401, { needsPassword: true, wrong: true });
      }
      if (doc.failedAttempts) await repo.docs.clearFailedAttempts(id);
    }
    out();
  } catch (e) {
    console.error('doc failed', e.message);
    L.send(res, 500, { error: 'Could not open the link.' });
  }
};

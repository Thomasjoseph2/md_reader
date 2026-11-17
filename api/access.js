// POST /api/access { id, visibility, emails?, password?, removePassword? }  (owner only)
const L = require('./_lib');
const repo = require('./_repo');
const { currentUser } = require('./_auth');

module.exports = async (req, res) => {
  if (L.guardPost(req, res)) return;
  try {
    const user = await currentUser(req);
    if (!user) return L.send(res, 401, { needsLogin: true });
    const b = req.body || {};
    if (!L.validId(b.id)) return L.send(res, 404, { error: 'Link not found.' });
    const visibility = b.visibility === 'restricted' ? 'restricted' : 'link';
    const emails = L.cleanEmails(b.emails);
    if (!emails) return L.send(res, 400, { error: `Check the email addresses (up to ${L.LIMITS.maxEmails}).` });
    let passwordHash;                                   // undefined = keep the current password
    if (visibility === 'restricted' || b.removePassword) passwordHash = null;
    else if (b.password) {
      if (typeof b.password !== 'string' || b.password.length > L.LIMITS.maxPassword) return L.send(res, 400, { error: 'Password is too long.' });
      passwordHash = L.hashPassword(b.password);
    }
    const ok = await repo.docs.updateAccess(b.id, user.id, { visibility, emails: visibility === 'restricted' ? emails : [], passwordHash });
    ok ? L.send(res, 200, { ok: true }) : L.send(res, 404, { error: 'Link not found.' });
  } catch (e) { console.error('access failed', e.message); L.send(res, 500, { error: 'Could not update the link.' }); }
};

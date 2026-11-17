// POST /api/unshare { id }  (owner only) deletes the link and its content
const L = require('./_lib');
const repo = require('./_repo');
const { currentUser } = require('./_auth');

module.exports = async (req, res) => {
  if (L.guardPost(req, res)) return;
  try {
    const user = await currentUser(req);
    if (!user) return L.send(res, 401, { needsLogin: true });
    const { id } = req.body || {};
    if (!L.validId(id)) return L.send(res, 404, { error: 'Link not found.' });
    await repo.docs.remove(id, user.id);
    L.send(res, 200, { ok: true });
  } catch (e) { console.error('unshare failed', e.message); L.send(res, 500, { error: 'Could not remove the link.' }); }
};

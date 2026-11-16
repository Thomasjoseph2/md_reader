// POST /api/mylinks -> { links: [...] }   the signed-in user's own links
const L = require('./_lib');
const repo = require('./_repo');
const { currentUser } = require('./_auth');

module.exports = async (req, res) => {
  if (L.guardPost(req, res)) return;
  try {
    const user = await currentUser(req);
    if (!user) return L.send(res, 401, { needsLogin: true });
    L.send(res, 200, { links: await repo.docs.listByOwner(user.id) });
  } catch (e) { console.error('mylinks failed', e.message); L.send(res, 500, { error: 'Could not load your links.' }); }
};

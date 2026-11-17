// POST /api/versions { id, password?, version? }   (signed in; owner or an editor)
//   without version -> { versions: [{ version, savedAt, by, current }] }   newest first
//   with version    -> { files }   the saved copy of that version (to restore it, save these files again)
const L = require('./_lib');
const repo = require('./_repo');
const authorize = require('./_access');
const { currentUser } = require('./_auth');

module.exports = async (req, res) => {
  if (L.guardPost(req, res)) return;
  try {
    const user = await currentUser(req);
    if (!user) return L.send(res, 401, { needsLogin: true });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (!L.validId(b.id)) return L.send(res, 404, { error: 'Link not found.' });
    const doc = await repo.docs.get(b.id);
    if (!doc) return L.send(res, 404, { error: 'This link does not exist or has expired.' });
    const a = await authorize(doc, user, b.password);
    if (!a.ok) return L.send(res, a.status, a.body);
    if (user.id !== doc.ownerId && doc.role !== 'editor') return L.send(res, 403, { error: 'Only people who can edit this doc can see its history.' });
    if (b.version === undefined) return L.send(res, 200, { versions: await repo.docs.listVersions(b.id) });
    if (!Number.isInteger(b.version)) return L.send(res, 400, { error: 'Bad version.' });
    const files = b.version === doc.version ? doc.files : await repo.docs.getVersion(b.id, b.version);
    files ? L.send(res, 200, { files }) : L.send(res, 404, { error: 'That version is no longer kept.' });
  } catch (e) { console.error('versions failed', e.message); L.send(res, 500, { error: 'Could not load the history.' }); }
};

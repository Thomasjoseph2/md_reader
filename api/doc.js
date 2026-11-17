// POST /api/doc  { id, password? }  ->  { title, files, expiresAt, isOwner, role, allowExport, version, canEdit }
//   401 { needsLogin }     restricted doc, not signed in
//   403 { error }          signed in, but not on the list
//   401 { needsPassword }  link doc with a password
const L = require('./_lib');
const repo = require('./_repo');
const authorize = require('./_access');
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
    const a = await authorize(doc, user, password);
    if (!a.ok) return L.send(res, a.status, a.body);
    const isOwner = !!user && user.id === doc.ownerId;
    L.send(res, 200, {
      title: doc.title, files: doc.files, expiresAt: doc.expiresAt, isOwner, role: doc.role, allowExport: doc.allowExport,
      version: doc.version, canEdit: !!user && (isOwner || doc.role === 'editor'),
    });
  } catch (e) {
    console.error('doc failed', e.message);
    L.send(res, 500, { error: 'Could not open the link.' });
  }
};

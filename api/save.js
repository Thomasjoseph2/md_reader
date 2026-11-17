// POST /api/save { id, password?, files: {path: text}, baseVersion, title? }  (signed in; owner or an editor of the doc)
//   -> { version }                 saved
//   409 { conflict, version, files }   someone saved after you opened it (nothing was changed)
// Encrypted docs arrive already encrypted (one file holding the scrambled data); the server cannot tell the difference.
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
    if (user.id !== doc.ownerId && doc.role !== 'editor') return L.send(res, 403, { error: 'You can view this doc but not change it.' });

    const files = b.files;
    if (!files || typeof files !== 'object' || Array.isArray(files)) return L.send(res, 400, { error: 'Nothing to save.' });
    const paths = Object.keys(files);
    if (!paths.length || paths.length > L.LIMITS.maxFiles) return L.send(res, 400, { error: 'Check the number of files.' });
    let size = 0;
    for (const p of paths) {
      if (typeof files[p] !== 'string' || p.length > L.LIMITS.maxPathLen || p.startsWith('/') || p.split('/').includes('..')) return L.send(res, 400, { error: 'A file in the list is not valid.' });
      size += Buffer.byteLength(files[p]);
    }
    if (size > L.LIMITS.maxBytes) return L.send(res, 413, { error: `Too large. Limit is ${L.LIMITS.maxBytes / 1048576} MB of Markdown text.` });
    if (!Number.isInteger(b.baseVersion)) return L.send(res, 400, { error: 'Missing version.' });

    const r = await repo.docs.save(b.id, { files, fileCount: paths.length, sizeBytes: size, baseVersion: b.baseVersion, userId: user.id });
    if (r.conflict) return L.send(res, 409, { conflict: true, version: r.version, files: r.files });
    L.send(res, 200, { version: r.version });
  } catch (e) {
    console.error('save failed', e.message);
    L.send(res, 500, { error: 'Could not save.' });
  }
};

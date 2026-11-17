// POST /api/share  { title, files: {path: text}, visibility: 'link'|'restricted', emails?, password?, days? }
//   -> { id, expiresAt }       (requires sign-in)
const L = require('./_lib');
const repo = require('./_repo');
const { currentUser } = require('./_auth');

module.exports = async (req, res) => {
  if (L.guardPost(req, res)) return;
  try {
    const user = await currentUser(req);
    if (!user) return L.send(res, 401, { needsLogin: true });

    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const files = b.files;
    if (!files || typeof files !== 'object' || Array.isArray(files)) return L.send(res, 400, { error: 'No files to share.' });
    const paths = Object.keys(files);
    if (!paths.length) return L.send(res, 400, { error: 'No files to share.' });
    if (paths.length > L.LIMITS.maxFiles) return L.send(res, 413, { error: `Too many files (limit ${L.LIMITS.maxFiles}).` });
    let size = 0;
    for (const p of paths) {
      if (typeof files[p] !== 'string' || p.length > L.LIMITS.maxPathLen || p.startsWith('/') || p.split('/').includes('..')) {
        return L.send(res, 400, { error: 'A file in the list is not valid.' });
      }
      size += Buffer.byteLength(files[p]);
    }
    if (size > L.LIMITS.maxBytes) return L.send(res, 413, { error: `Too large. Limit is ${L.LIMITS.maxBytes / 1048576} MB of Markdown text.` });

    const visibility = b.visibility === 'restricted' ? 'restricted' : 'link';
    const emails = L.cleanEmails(b.emails);
    if (!emails) return L.send(res, 400, { error: `Check the email addresses (up to ${L.LIMITS.maxEmails}).` });
    let passwordHash = null;
    if (visibility === 'link' && b.password) {
      if (typeof b.password !== 'string' || b.password.length > L.LIMITS.maxPassword) return L.send(res, 400, { error: 'Password is too long.' });
      passwordHash = L.hashPassword(b.password);
    }
    const role = b.role === 'commenter' ? 'commenter' : 'viewer', allowExport = b.allowExport === true;
    if (await repo.docs.countRecentByOwner(user.id) >= L.LIMITS.perUserPerHour) return L.send(res, 429, { error: 'Too many links created. Try again later.' });

    const id = L.newId();
    const { expiresAt } = await repo.docs.create({
      id, ownerId: user.id, title: String(b.title || 'Shared docs').slice(0, 120), files, fileCount: paths.length, sizeBytes: size,
      passwordHash, visibility, role, allowExport, emails: visibility === 'restricted' ? emails : [], days: L.LIMITS.expiryDays.includes(b.days) ? b.days : 30,
    });
    L.send(res, 200, { id, expiresAt });
  } catch (e) {
    console.error('share failed', e.message);
    L.send(res, 500, { error: 'Could not create the link.' });
  }
};

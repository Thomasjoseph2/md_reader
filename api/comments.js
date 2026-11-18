// POST /api/comments { id, password?, action, ... }   (signed in)
//   action "list"                -> { comments: [{ id, authorId, author, data, updatedAt }], userId, canModerate }
//   action "put"    { cid, data} -> add a comment, or change one (your own; owner and editors may change any)
//   action "delete" { cid }      -> remove one (your own; owner and editors may remove any)
// Who can do what: viewers cannot see or write comments; commenters add and manage their own;
// editors and the owner can also remove other people's comments.
const L = require('./_lib');
const repo = require('./_repo');
const authorize = require('./_access');
const { currentUser } = require('./_auth');

const MAX_COMMENT = 20000, MAX_PER_DOC = 500, CID = /^[A-Za-z0-9_-]{1,40}$/;

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
    const owner = user.id === doc.ownerId;
    if (!owner && doc.role === 'viewer') return L.send(res, 403, { error: 'This link is view only, so comments are off.' });
    const moderator = owner || doc.role === 'editor';

    if (b.action === 'list') {
      const rows = await repo.comments.list(b.id);
      return L.send(res, 200, { comments: rows.map((r) => ({ id: r.id, authorId: r.authorId, author: r.author, data: r.data, updatedAt: r.updatedAt })), userId: user.id, canModerate: moderator });
    }
    if (typeof b.cid !== 'string' || !CID.test(b.cid)) return L.send(res, 400, { error: 'Bad comment id.' });
    const cur = await repo.comments.get(b.id, b.cid);
    if (cur && cur.authorId !== user.id && !moderator) return L.send(res, 403, { error: 'You can only change your own comments.' });

    if (b.action === 'put') {
      if (typeof b.data !== 'string' || !b.data || b.data.length > MAX_COMMENT) return L.send(res, 400, { error: 'That comment is empty or too long.' });
      if (cur && cur.authorId !== user.id) return L.send(res, 403, { error: 'Only the author can edit a comment.' });
      if (!cur && (await repo.comments.count(b.id)) >= MAX_PER_DOC) return L.send(res, 429, { error: 'This doc has reached its comment limit.' });
      await repo.comments.upsert(b.id, b.cid, user.id, String(user.name || user.email).slice(0, 100), b.data);
      return L.send(res, 200, { ok: true });
    }
    if (b.action === 'delete') {
      await repo.comments.remove(b.id, b.cid);
      return L.send(res, 200, { ok: true });
    }
    L.send(res, 400, { error: 'Unknown action.' });
  } catch (e) { console.error('comments failed', e.message); L.send(res, 500, { error: 'Could not reach the comments.' }); }
};

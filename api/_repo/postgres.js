// Postgres implementation of the repository (works with Supabase, Neon, RDS, a local server...).
const { Pool } = require('pg');

let pool;
function db() {
  const conn = process.env.DATABASE_URL || process.env.SUPABASE_URL; // SUPABASE_URL: legacy name
  if (!conn) throw new Error('DATABASE_URL is not set');
  if (!pool) pool = new Pool({ connectionString: conn, max: 2, idleTimeoutMillis: 10000, ssl: { rejectUnauthorized: false } });
  return pool;
}
const q = (text, params) => db().query(text, params);

const publicUser = (r) => ({ id: r.id, email: r.email, name: r.name, picture: r.picture });

const users = {
  async upsertGoogle({ sub, email, name, picture }) {
    const r = await q(
      `insert into users (google_sub, email, name, picture) values ($1, $2, $3, $4)
       on conflict (google_sub) do update set email = excluded.email, name = excluded.name, picture = excluded.picture, last_login_at = now()
       returning id, email, name, picture`, [sub, email, name || null, picture || null]);
    return publicUser(r.rows[0]);
  },
};

const sessions = {
  async create(userId, tokenHash, expiresAt) {
    await q('insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)', [tokenHash, userId, expiresAt]);
  },
  async getUser(tokenHash) {
    const r = await q(
      `select u.id, u.email, u.name, u.picture from sessions s join users u on u.id = s.user_id
        where s.token_hash = $1 and s.expires_at > now()`, [tokenHash]);
    return r.rows[0] ? publicUser(r.rows[0]) : null;
  },
  async remove(tokenHash) { await q('delete from sessions where token_hash = $1', [tokenHash]); },
};

const docs = {
  async create(d) {
    const c = await db().connect();
    try {
      await c.query('begin');
      const r = await c.query(
        `insert into shared_docs (id, owner_id, title, files, file_count, size_bytes, password_hash, visibility, role, allow_export, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() + make_interval(days => $11)) returning expires_at`,
        [d.id, d.ownerId, d.title, JSON.stringify(d.files), d.fileCount, d.sizeBytes, d.passwordHash, d.visibility, d.role, d.allowExport, d.days]);
      for (const email of d.emails) await c.query('insert into doc_access (doc_id, email) values ($1, $2) on conflict do nothing', [d.id, email]);
      await c.query('commit');
      return { expiresAt: r.rows[0].expires_at };
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  },
  async get(id) {
    const r = await q(
      `select id, owner_id, title, files, password_hash, visibility, role, allow_export, version, expires_at, failed_attempts, locked_until,
              array(select email from doc_access where doc_id = shared_docs.id order by email) as emails
         from shared_docs where id = $1 and expires_at > now()`, [id]);
    const x = r.rows[0];
    return x && { id: x.id, ownerId: x.owner_id, title: x.title, files: x.files, passwordHash: x.password_hash, visibility: x.visibility, role: x.role, allowExport: x.allow_export, version: x.version,
      emails: x.emails, expiresAt: x.expires_at, failedAttempts: x.failed_attempts, lockedUntil: x.locked_until };
  },
  async listByOwner(ownerId) {
    const r = await q(
      `select id, title, file_count, visibility, role, allow_export, password_hash is not null as protected, expires_at,
              array(select email from doc_access where doc_id = shared_docs.id order by email) as emails
         from shared_docs where owner_id = $1 and expires_at > now() order by created_at desc limit 100`, [ownerId]);
    return r.rows.map((x) => ({ id: x.id, title: x.title, fileCount: x.file_count, visibility: x.visibility, role: x.role, allowExport: x.allow_export, protected: x.protected, emails: x.emails, expiresAt: x.expires_at }));
  },
  async updateAccess(id, ownerId, { visibility, emails, passwordHash, role, allowExport }) {
    const c = await db().connect();
    try {
      await c.query('begin');
      const sets = ['visibility = $3', 'role = $4', 'allow_export = $5'], params = [id, ownerId, visibility, role, allowExport];
      if (passwordHash !== undefined) { params.push(passwordHash); sets.push(`password_hash = $${params.length}`, 'failed_attempts = 0', 'locked_until = null'); }
      const r = await c.query(`update shared_docs set ${sets.join(', ')} where id = $1 and owner_id = $2 and expires_at > now()`, params);
      if (!r.rowCount) { await c.query('rollback'); return false; }
      await c.query('delete from doc_access where doc_id = $1', [id]);
      for (const email of emails) await c.query('insert into doc_access (doc_id, email) values ($1, $2) on conflict do nothing', [id, email]);
      await c.query('commit');
      return true;
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  },
  // Saves a new version unless someone else saved first (baseVersion is the version the editor opened).
  async save(id, { files, fileCount, sizeBytes, baseVersion, userId }) {
    const c = await db().connect();
    try {
      await c.query('begin');
      const cur = (await c.query('select version, files from shared_docs where id = $1 and expires_at > now() for update', [id])).rows[0];
      if (!cur) { await c.query('rollback'); return { conflict: true, version: 0, files: {} }; }
      if (cur.version !== baseVersion) { await c.query('rollback'); return { conflict: true, version: cur.version, files: cur.files }; }
      await c.query('insert into doc_versions (doc_id, version, files, saved_by) values ($1,$2,$3,$4) on conflict do nothing', [id, cur.version, JSON.stringify(cur.files), userId]);
      const next = cur.version + 1;
      await c.query('update shared_docs set files = $2, file_count = $3, size_bytes = $4, version = $5, updated_at = now(), updated_by = $6 where id = $1',
        [id, JSON.stringify(files), fileCount, sizeBytes, next, userId]);
      await c.query('delete from doc_versions where doc_id = $1 and version <= $2', [id, next - 6]);   // keep the last 5 old versions
      await c.query('commit');
      return { version: next };
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  },
  async remove(id, ownerId) {
    return (await q('delete from shared_docs where id = $1 and owner_id = $2', [id, ownerId])).rowCount > 0;
  },
  async countRecentByOwner(ownerId) {
    return (await q(`select count(*)::int n from shared_docs where owner_id = $1 and created_at > now() - interval '1 hour'`, [ownerId])).rows[0].n;
  },
  async registerFailedAttempt(id, maxFailed, lockMinutes) {
    await q(
      `update shared_docs set
         failed_attempts = case when failed_attempts + 1 >= $2 then 0 else failed_attempts + 1 end,
         locked_until = case when failed_attempts + 1 >= $2 then now() + make_interval(mins => $3) else locked_until end
       where id = $1`, [id, maxFailed, lockMinutes]);
  },
  async clearFailedAttempts(id) { await q('update shared_docs set failed_attempts = 0 where id = $1 and failed_attempts <> 0', [id]); },
};

const housekeeping = {
  async purge() {
    await q(`delete from shared_docs where expires_at < now() - interval '1 day'`);
    await q('delete from sessions where expires_at < now()');
  },
};

module.exports = { users, sessions, docs, housekeeping };

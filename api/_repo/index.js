/*
 * Repository: the only place the API talks to a database.
 * To use another database, add a file next to postgres.js that exports the same functions
 * and register it below. Select it with DB_DRIVER (default "postgres").
 *
 * users.upsertGoogle({ sub, email, name, picture })                -> user { id, email, name, picture }
 * sessions.create(userId, tokenHash, expiresAt)                    -> void
 * sessions.getUser(tokenHash)                                      -> user | null   (null if expired)
 * sessions.remove(tokenHash)                                       -> void
 * docs.create({ id, ownerId, title, files, fileCount, sizeBytes,
 *               passwordHash, visibility, emails, days })          -> { expiresAt }
 * docs.get(id)                                                     -> doc | null    (null if missing or expired)
 *     doc = { id, ownerId, title, files, passwordHash, visibility, emails, expiresAt, failedAttempts, lockedUntil }
 * docs.listByOwner(ownerId)                                        -> [{ id, title, fileCount, visibility, protected, emails, expiresAt }]
 * docs.updateAccess(id, ownerId, { visibility, emails, passwordHash? }) -> boolean  (passwordHash undefined = keep, null = remove)
 * docs.remove(id, ownerId)                                         -> boolean
 * docs.countRecentByOwner(ownerId)                                 -> number (links created in the last hour)
 * docs.registerFailedAttempt(id, maxFailed, lockMinutes)           -> void
 * docs.clearFailedAttempts(id)                                     -> void
 * housekeeping.purge()                                             -> void   (expired docs and sessions)
 */
const drivers = {
  postgres: () => require('./postgres'),
};
const name = process.env.DB_DRIVER || 'postgres';
if (!drivers[name]) throw new Error(`Unknown DB_DRIVER "${name}"`);
module.exports = drivers[name]();

#!/usr/bin/env node
// Applies db/migrations/*.sql in order, once each. Usage: DATABASE_URL=... node scripts/migrate.js
const fs = require('fs'), path = require('path');
const { Client } = require('pg');

(async () => {
  const conn = process.env.DATABASE_URL || process.env.SUPABASE_URL;
  if (!conn) throw new Error('DATABASE_URL is not set');
  const c = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if ((await c.query('select 1 from schema_migrations where name = $1', [f])).rowCount) continue;
    await c.query('begin');
    try {
      await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await c.query('insert into schema_migrations (name) values ($1)', [f]);
      await c.query('commit');
      console.log('applied', f);
    } catch (e) { await c.query('rollback'); throw new Error(`${f}: ${e.message}`); }
  }
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

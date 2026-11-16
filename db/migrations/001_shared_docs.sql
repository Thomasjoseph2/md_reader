-- Shared links: a folder of Markdown files uploaded on request, read-only for now.
-- Only the server (direct Postgres connection) touches this table. RLS is on with no
-- policies, so the Supabase public API (anon / authenticated keys) can never read or write it.

create table if not exists public.shared_docs (
  id              text primary key,                  -- random, unguessable (128-bit, base64url)
  title           text not null,
  files           jsonb not null,                    -- { "path/to/file.md": "markdown text", ... }
  file_count      int  not null,
  size_bytes      int  not null,
  password_hash   text,                              -- scrypt, null = no password
  owner_token_hash text not null,                    -- sha256 of the owner token (lets the creator delete/change)
  version         int  not null default 1,           -- for future editing / version history
  workspace_id    uuid,                              -- for future teams
  creator_ip_hash text,                              -- sha256(ip + salt), only used to limit abuse
  failed_attempts int  not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null
);

create index if not exists shared_docs_expires_idx on public.shared_docs (expires_at);
create index if not exists shared_docs_ip_idx on public.shared_docs (creator_ip_hash, created_at);

alter table public.shared_docs enable row level security;
revoke all on public.shared_docs from anon, authenticated;

-- Accounts (direct Google sign-in), sessions, and per-doc access lists.
create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  google_sub    text not null unique,                 -- Google's stable user id
  email         text not null unique,                 -- verified by Google, stored lowercase
  name          text,
  picture       text,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

create table if not exists public.sessions (
  token_hash text primary key,                        -- sha256 of the cookie value; the raw value is never stored
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_user_idx on public.sessions (user_id);
create index if not exists sessions_expires_idx on public.sessions (expires_at);

-- Owner replaces the anonymous owner token; visibility is Google-Docs style.
alter table public.shared_docs drop column if exists owner_token_hash;
alter table public.shared_docs drop column if exists creator_ip_hash;
alter table public.shared_docs add column if not exists owner_id uuid references public.users(id) on delete cascade;
alter table public.shared_docs add column if not exists visibility text not null default 'link';
do $$ begin
  alter table public.shared_docs add constraint shared_docs_visibility_chk check (visibility in ('link','restricted'));
exception when duplicate_object then null; end $$;
create index if not exists shared_docs_owner_idx on public.shared_docs (owner_id, created_at);

create table if not exists public.doc_access (
  doc_id  text not null references public.shared_docs(id) on delete cascade,
  email   text not null,                              -- lowercase
  role    text not null default 'viewer' check (role in ('viewer')),  -- 'editor' arrives with editing
  added_at timestamptz not null default now(),
  primary key (doc_id, email)
);

alter table public.users      enable row level security;
alter table public.sessions   enable row level security;
alter table public.doc_access enable row level security;
revoke all on public.users, public.sessions, public.doc_access from anon, authenticated;

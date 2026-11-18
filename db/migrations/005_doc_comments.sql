-- Comments on shared docs, saved on the server so everyone with access sees them.
-- "data" is the comment as JSON text; for encrypted docs it is already encrypted in the browser.
create table if not exists public.doc_comments (
  doc_id     text not null references public.shared_docs(id) on delete cascade,
  id         text not null,
  author_id  uuid references public.users(id) on delete set null,
  author     text,
  data       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (doc_id, id)
);
alter table public.doc_comments enable row level security;
revoke all on public.doc_comments from anon, authenticated;

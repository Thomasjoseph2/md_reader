-- Editing shared docs: an 'editor' role, and the last few saved versions of each doc (shared_docs.version counts saves).
alter table public.shared_docs drop constraint if exists shared_docs_role_chk;
alter table public.shared_docs add constraint shared_docs_role_chk check (role in ('viewer','commenter','editor'));
alter table public.shared_docs add column if not exists updated_at timestamptz;
alter table public.shared_docs add column if not exists updated_by uuid references public.users(id) on delete set null;

create table if not exists public.doc_versions (
  doc_id   text not null references public.shared_docs(id) on delete cascade,
  version  int  not null,
  files    jsonb not null,
  saved_by uuid references public.users(id) on delete set null,
  saved_at timestamptz not null default now(),
  primary key (doc_id, version)
);
alter table public.doc_versions enable row level security;
revoke all on public.doc_versions from anon, authenticated;

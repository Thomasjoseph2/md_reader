-- What people who open a link may do: 'viewer' (read only) or 'commenter'; printing / saving as PDF is a separate switch.
alter table public.shared_docs add column if not exists role text not null default 'viewer';
alter table public.shared_docs add column if not exists allow_export boolean not null default false;
do $$ begin
  alter table public.shared_docs add constraint shared_docs_role_chk check (role in ('viewer','commenter'));
exception when duplicate_object then null; end $$;

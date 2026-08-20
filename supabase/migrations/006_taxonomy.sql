-- Shared editorial taxonomy for the CMS.
-- Idempotent: safe to run more than once in the Supabase SQL editor.

create table if not exists taxonomy_terms (
  id         bigint generated always as identity primary key,
  name       text        not null,
  kind       text        not null default 'category' check (kind in ('category', 'tag')),
  created_at timestamptz not null default now(),
  constraint taxonomy_terms_name_kind_unique unique (name, kind)
);

-- Only the service role can read/write; no public access.
alter table taxonomy_terms enable row level security;

create index if not exists taxonomy_terms_kind_name_idx
  on taxonomy_terms (kind, name);

-- Seed the current editorial categories and tags (no-op when already present).
insert into taxonomy_terms (name, kind)
select unnest(array['Discussion', 'Analysis', 'News', 'Strategy', 'Psychology', 'Brokers', 'Signals', 'Education', 'Results']), 'category'
on conflict (name, kind) do nothing;

insert into taxonomy_terms (name, kind)
select unnest(array['Analysis', 'News', 'Educational']), 'tag'
on conflict (name, kind) do nothing;

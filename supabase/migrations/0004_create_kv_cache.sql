-- =============================================================================
-- Cache
-- =============================================================================

create table if not exists kv_cache (
  key text primary key,
  value jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table kv_cache enable row level security;

create policy "authenticated full access" on kv_cache
  for all
  to authenticated
  using (true)
  with check (true);

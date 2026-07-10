-- =============================================================================
-- Integração WordPress por projeto
-- =============================================================================
-- O código (UI e edge function publish-wordpress) passou a ler/gravar as
-- credenciais na tabela wordpress_integrations, mas ela nunca foi criada —
-- por isso a senha não era salva e nada era publicado (nem como rascunho).
-- Esta migração cria a tabela, copia os dados legados das colunas em
-- projects e aplica o mesmo modelo de RLS das demais tabelas.
-- =============================================================================

create table if not exists wordpress_integrations (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references projects(id) on delete cascade,
  url                  text not null,
  username             text not null,
  application_password text not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (project_id) -- exigido pelo upsert com onConflict: "project_id"
);

-- Copia credenciais legadas que já estavam em projects (se houver).
insert into wordpress_integrations (project_id, url, username, application_password)
select id, wordpress_base_url, wordpress_username, wordpress_app_password_secret
from projects
where wordpress_base_url is not null
  and wordpress_username is not null
  and wordpress_app_password_secret is not null
on conflict (project_id) do nothing;

create trigger trg_wp_integrations_updated
  before update on wordpress_integrations
  for each row execute function set_updated_at();

alter table wordpress_integrations enable row level security;

create policy "authenticated full access" on wordpress_integrations
  for all to authenticated
  using (true) with check (true);

-- =============================================================================
-- Deserto de Notícias — Schema inicial
-- =============================================================================
-- Convenções:
--   * Todas as tabelas em snake_case.
--   * Timestamps em timestamptz, default now().
--   * Soft references via FK com ON DELETE CASCADE onde faz sentido.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- ENUMS
-- -----------------------------------------------------------------------------

-- Tipo de fonte que o sistema sabe captar.
create type source_type as enum (
  'youtube',      -- canal ou vídeo do YouTube (faz transcrição)
  'instagram',    -- perfil ou post
  'tiktok',       -- perfil ou vídeo
  'diario_oficial', -- diário oficial (detecta nova edição e interpreta)
  'website'       -- site público genérico (RSS ou scraping)
);

-- Etapas do pipeline. A ordem importa.
create type pipeline_step as enum (
  'understand',   -- 1: entendimento/transcrição
  'rank',         -- 2: ranking de pautas
  'write',        -- 3: escrita
  'polish'        -- 4: polimento editorial + SEO
);

-- Estado de um item de conteúdo ao longo do pipeline.
create type content_status as enum (
  'captured',     -- recém-captado da fonte
  'understanding',
  'understood',
  'ranking',
  'ranked',
  'discarded',    -- pauta descartada no ranking (baixo potencial)
  'writing',
  'written',
  'polishing',
  'polished',
  'ready',        -- pronto para publicação
  'publishing',
  'published',
  'error'
);

-- Provedor de IA (preparado para multi-provedor; default Gemini).
create type ai_provider as enum ('gemini');

-- -----------------------------------------------------------------------------
-- PROJETOS e REGIÕES
-- -----------------------------------------------------------------------------

-- Um projeto cobre uma região. (1 projeto : 1 região, mas modelado como tabelas
-- separadas para permitir evolução futura — ex. múltiplas regiões por projeto.)
create table projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  description text,
  is_active   boolean not null default true,
  -- Configuração do conector WordPress (destino de publicação) deste projeto.
  wordpress_base_url   text,
  wordpress_username   text,
  -- Senha de aplicação do WordPress: guardada como secret; aqui só a referência.
  wordpress_app_password_secret text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table regions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,          -- ex.: "Vale do Jaguaribe - CE"
  state       text,                   -- UF
  ibge_code   text,                   -- código IBGE do município (opcional)
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, name)
);

-- -----------------------------------------------------------------------------
-- FONTES
-- -----------------------------------------------------------------------------

-- Fontes cadastradas por URL. O sistema detecta novidades em cada uma.
create table sources (
  id            uuid primary key default gen_random_uuid(),
  region_id     uuid not null references regions(id) on delete cascade,
  type          source_type not null,
  name          text not null,        -- rótulo amigável
  url           text not null,        -- URL canônica da fonte (canal, perfil, RSS, página do DO)
  is_active     boolean not null default true,
  -- Cadência de verificação em minutos (cron decide quando varrer).
  check_interval_minutes int not null default 60,
  -- Config específica por tipo (ex.: { "rss": true } ou { "channel_id": "..." }).
  config        jsonb not null default '{}'::jsonb,
  -- Marcador da última novidade vista, para detectar o que é novo.
  -- Ex.: último video_id, último hash de página, última data de edição do DO.
  last_seen_marker text,
  last_checked_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index on sources (region_id);
create index on sources (is_active, check_interval_minutes);

-- -----------------------------------------------------------------------------
-- ITENS DE CONTEÚDO (unidade que percorre o pipeline)
-- -----------------------------------------------------------------------------

create table content_items (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references sources(id) on delete cascade,
  region_id     uuid not null references regions(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  status        content_status not null default 'captured',
  -- Identidade única do item dentro da fonte (video_id, url do post, edição do DO...).
  external_id   text not null,
  external_url  text,
  title         text,
  -- Conteúdo bruto captado (legenda, descrição, texto extraído, metadados).
  raw_payload   jsonb not null default '{}'::jsonb,
  -- Saídas do pipeline (preenchidas etapa a etapa):
  transcript        text,             -- etapa 1
  understanding     jsonb,            -- etapa 1: resumo estruturado, entidades, fatos
  rank_score        numeric,          -- etapa 2: 0-100 potencial Discover/Search
  rank_rationale    jsonb,            -- etapa 2: justificativa, keywords, ângulos
  draft             text,             -- etapa 3
  final_article     text,             -- etapa 4 (markdown/HTML)
  seo               jsonb,            -- etapa 4: title, meta, slug, tags
  error_message     text,
  captured_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (source_id, external_id)
);

create index on content_items (status);
create index on content_items (project_id, status);
create index on content_items (region_id);

-- -----------------------------------------------------------------------------
-- CONFIGURAÇÃO DE ETAPAS (modelo + prompt por etapa, controlável pelo admin)
-- -----------------------------------------------------------------------------
-- Cada etapa do pipeline tem uma config. Pode ser global (project_id null,
-- usada como default) ou específica por projeto (override). O resolver escolhe
-- a config do projeto se existir, senão a global.

create table step_configs (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid references projects(id) on delete cascade, -- null = default global
  step          pipeline_step not null,
  provider      ai_provider not null default 'gemini',
  model         text not null default 'gemini-2.5-flash',
  system_prompt text not null,        -- instruções/papel do modelo nesta etapa
  -- Template do prompt do usuário; suporta placeholders {{transcript}}, {{title}}, etc.
  user_prompt_template text not null,
  temperature   numeric not null default 0.7,
  max_output_tokens int not null default 4096,
  -- Parâmetros extras (ex.: response_mime_type, safety settings).
  extra         jsonb not null default '{}'::jsonb,
  is_active     boolean not null default true,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  -- Um config por (projeto, etapa). project_id null = global.
  unique (project_id, step)
);

create index on step_configs (step, is_active);

-- -----------------------------------------------------------------------------
-- LOG DE EXECUÇÕES DO PIPELINE (auditoria + debug de prompts)
-- -----------------------------------------------------------------------------

create table pipeline_runs (
  id              uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references content_items(id) on delete cascade,
  step            pipeline_step not null,
  step_config_id  uuid references step_configs(id) on delete set null,
  provider        ai_provider not null,
  model           text not null,
  prompt_sent     text,               -- prompt final enviado (para auditoria)
  output_raw      text,               -- resposta crua do modelo
  tokens_input    int,
  tokens_output   int,
  duration_ms     int,
  status          text not null default 'ok', -- ok | error
  error_message   text,
  created_at      timestamptz not null default now()
);

create index on pipeline_runs (content_item_id, step);

-- -----------------------------------------------------------------------------
-- PUBLICAÇÕES (resultado do conector WordPress)
-- -----------------------------------------------------------------------------

create table publications (
  id              uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references content_items(id) on delete cascade,
  project_id      uuid not null references projects(id) on delete cascade,
  wordpress_post_id text,
  wordpress_url   text,
  status          text not null default 'pending', -- pending | published | failed
  response        jsonb,
  published_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index on publications (content_item_id);

-- -----------------------------------------------------------------------------
-- TRIGGERS: updated_at automático
-- -----------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

create trigger trg_projects_updated   before update on projects      for each row execute function set_updated_at();
create trigger trg_regions_updated    before update on regions       for each row execute function set_updated_at();
create trigger trg_sources_updated    before update on sources       for each row execute function set_updated_at();
create trigger trg_content_updated    before update on content_items for each row execute function set_updated_at();
create trigger trg_stepcfg_updated    before update on step_configs  for each row execute function set_updated_at();

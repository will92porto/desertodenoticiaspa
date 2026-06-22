-- =============================================================================
-- SETUP COMPLETO — cole no SQL Editor do Supabase e clique em RUN.
-- Seguro rodar mais de uma vez. Cria schema + RLS + prompts default.
-- =============================================================================

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
do $$ begin
create type source_type as enum (
  'youtube',      -- canal ou vídeo do YouTube (faz transcrição)
  'instagram',    -- perfil ou post
  'tiktok',       -- perfil ou vídeo
  'diario_oficial', -- diário oficial (detecta nova edição e interpreta)
  'website'       -- site público genérico (RSS ou scraping)
);
exception when duplicate_object then null; end $$;

-- Etapas do pipeline. A ordem importa.
do $$ begin
create type pipeline_step as enum (
  'understand',   -- 1: entendimento/transcrição
  'rank',         -- 2: ranking de pautas
  'write',        -- 3: escrita
  'polish'        -- 4: polimento editorial + SEO
);
exception when duplicate_object then null; end $$;

-- Estado de um item de conteúdo ao longo do pipeline.
do $$ begin
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
exception when duplicate_object then null; end $$;

-- Provedor de IA (preparado para multi-provedor; default Gemini).
do $$ begin
create type ai_provider as enum ('gemini');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- PROJETOS e REGIÕES
-- -----------------------------------------------------------------------------

-- Um projeto cobre uma região. (1 projeto : 1 região, mas modelado como tabelas
-- separadas para permitir evolução futura — ex. múltiplas regiões por projeto.)
create table if not exists projects (
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

create table if not exists regions (
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
create table if not exists sources (
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

create table if not exists content_items (
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

create table if not exists step_configs (
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
-- TREINAMENTO DO NEGÓCIO (Guias de Jornalismo / Treinador de Notícias)
-- -----------------------------------------------------------------------------
-- Regras gerais de jornalismo que são injetadas em todas as etapas de IA.
-- project_id null = default global.

create table if not exists business_training (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid references projects(id) on delete cascade,
  content       text not null default '',
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (project_id)
);

-- -----------------------------------------------------------------------------
-- LOG DE EXECUÇÕES DO PIPELINE (auditoria + debug de prompts)
-- -----------------------------------------------------------------------------

create table if not exists pipeline_runs (
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

create table if not exists publications (
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

create table if not exists kv_cache (
  key text primary key,
  value jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- -----------------------------------------------------------------------------
-- TRIGGERS: updated_at automático
-- -----------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists trg_projects_updated on projects;
create trigger trg_projects_updated before update on projects for each row execute function set_updated_at();
drop trigger if exists trg_regions_updated on regions;
create trigger trg_regions_updated before update on regions for each row execute function set_updated_at();
drop trigger if exists trg_sources_updated on sources;
create trigger trg_sources_updated before update on sources for each row execute function set_updated_at();
drop trigger if exists trg_content_updated on content_items;
create trigger trg_content_updated before update on content_items for each row execute function set_updated_at();
drop trigger if exists trg_stepcfg_updated on step_configs;
create trigger trg_stepcfg_updated before update on step_configs for each row execute function set_updated_at();
drop trigger if exists trg_businesstr_updated on business_training;
create trigger trg_businesstr_updated before update on business_training for each row execute function set_updated_at();

-- =============================================================================
-- Row Level Security
-- =============================================================================
-- Modelo simples para a iteração 1:
--   * Edge Functions usam a SERVICE ROLE (bypassa RLS) — todo o pipeline.
--   * Usuários autenticados (admins) têm acesso total de leitura/escrita.
--   * Anônimos não têm acesso.
-- Refinar com papéis/multi-tenant por projeto em iteração futura.
-- =============================================================================

alter table projects       enable row level security;
alter table regions        enable row level security;
alter table sources        enable row level security;
alter table content_items  enable row level security;
alter table step_configs   enable row level security;
alter table business_training enable row level security;
alter table pipeline_runs  enable row level security;
alter table publications   enable row level security;
alter table kv_cache       enable row level security;

-- Política reutilizável: usuários autenticados podem tudo.
-- (A service role das Edge Functions ignora RLS por padrão.)

do $$
declare t text;
begin
  foreach t in array array[
    'projects','regions','sources','content_items',
    'step_configs','business_training','pipeline_runs','publications','kv_cache'
  ] loop
    execute format('drop policy if exists "authenticated full access" on %I;', t);
    execute format($f$
      create policy "authenticated full access" on %I
        for all
        to authenticated
        using (true)
        with check (true);
    $f$, t);
  end loop;
end $$;

-- =============================================================================
-- Seed: configurações default das 4 etapas do pipeline (project_id = null)
-- =============================================================================
-- Estes são prompts iniciais. O admin pode editá-los no painel a qualquer momento,
-- ou criar overrides por projeto. Placeholders disponíveis no user_prompt_template
-- são substituídos pelo orquestrador (ver supabase/functions/_shared/prompt.ts).
-- =============================================================================

-- Limpa defaults globais antes de reinserir (idempotente).
delete from step_configs where project_id is null;
delete from business_training where project_id is null;

-- ---- TREINAMENTO DO NEGÓCIO -------------------------------------------------
insert into business_training (project_id, content) values (
  null,
$md$# O que é uma boa notícia no jornalismo local
Uma boa notícia inspira, educa e fortalece o sentimento de pertencimento da comunidade. Toda informação verídica e útil é uma boa notícia, mas ela ganha força quando:
- **Foco em Soluções:** Mostra como um problema local foi resolvido ou ações de moradores, em vez de focar apenas no conflito.
- **Utilidade Pública:** Traz serviços, vagas, mudanças no trânsito ou infraestrutura.
- **Histórias e Talentos:** Valoriza figuras inspiradoras da região.

# Como fazer jornalismo local
- **Proximidade:** Cubra o que afeta o dia a dia das pessoas. O buraco na rua importa mais que a crise internacional.
- **Independência:** Não seja refém de releases oficiais ou assessorias. Vá além e busque a visão da população.
- **Empatia e Verificação:** Não publique boatos de redes sociais sem checar. A credibilidade é o seu maior ativo na região.

# Cuidados na Produção do Texto
- **Pirâmide Invertida:** Vá direto ao ponto. O primeiro parágrafo (Lide) deve responder: O que, Quem, Quando, Onde e Como.
- **Clareza e Concisão:** Escreva frases curtas. Use a ordem direta (Sujeito + Verbo + Predicado). Sem enrolação.
- **Linguagem Objetiva:** Evite adjetivos emocionais, julgamentos, gírias e a primeira pessoa (eu/nós). Mantenha o tom denotativo.

# Exemplos do que FAZER
- **FAZER:** "Aulas na escola X são suspensas após enchente" (Claro, direto e útil).
- **FAZER:** Checar datas, nomes, cargos e números antes de avançar qualquer texto.

# Exemplos do que NÃO FAZER
- **NÃO FAZER:** Transformar a notícia em opinião disfarçada ou ataque sem provas.
- **NÃO FAZER:** Títulos confusos ("Aconteceu um negócio na prefeitura" em vez de "Prefeitura suspende licitação").
- **NÃO FAZER:** Escrever parágrafos com mais de 6 linhas ou abusar de palavras difíceis (rebuscamento).$md$
);

-- ---- ETAPA 1: ENTENDIMENTO / TRANSCRIÇÃO ------------------------------------
insert into step_configs (project_id, step, provider, model, temperature, system_prompt, user_prompt_template, extra)
values (
  null, 'understand', 'gemini', 'gemini-2.5-flash', 0.3,
$sys$Você é um editor de jornalismo local especializado em compreender material bruto de diversas fontes (vídeos, posts, diários oficiais, páginas web) e transformá-lo numa base factual limpa e confiável.

Seu trabalho NÃO é escrever a matéria ainda. É:
- Transcrever/extrair o conteúdo fielmente quando houver áudio ou texto.
- Identificar os fatos verificáveis, datas, valores, pessoas, órgãos e locais.
- Sinalizar o que é afirmação não confirmada, opinião ou propaganda.
- Não inventar nada. Se algo não está claro, marque como incerto.

Responda SEMPRE em JSON válido no formato:
{
  "transcript": "transcrição/extração fiel do conteúdo, em pt-BR",
  "summary": "resumo objetivo em 3-5 frases",
  "facts": ["fato verificável 1", "..."],
  "entities": { "pessoas": [], "orgaos": [], "locais": [], "valores": [] },
  "uncertainties": ["pontos a verificar"],
  "language": "pt-BR"
}$sys$,
$usr$FONTE: {{source_type}} — {{source_name}}
TÍTULO: {{title}}
URL: {{external_url}}

CONTEÚDO BRUTO CAPTADO:
{{raw_content}}

Compreenda e estruture o conteúdo acima conforme as instruções.$usr$,
'{"response_mime_type":"application/json"}'::jsonb
);

-- ---- ETAPA 2: RANKING DE PAUTAS ---------------------------------------------
insert into step_configs (project_id, step, provider, model, temperature, system_prompt, user_prompt_template, extra)
values (
  null, 'rank', 'gemini', 'gemini-2.5-flash', 0.4,
$sys$Você é um estrategista de conteúdo focado em Google Discover e Google Pesquisa para jornalismo regional.

Identifique TODAS as pautas (artigos) em potencial presentes no conteúdo fornecido. Para cada pauta encontrada, avalie seu potencial considerando:
- Relevância e interesse local genuíno para a região.
- Atualidade e gancho noticioso.
- Potencial de aparecer no Discover (interesse, originalidade, apelo visual).
- Potencial de ranqueamento em buscas (intenção de pesquisa, termos com volume).
- Risco editorial / sensibilidade (não inflar pautas problemáticas).

Dê uma nota de 0 a 100 e justifique cada pauta. Responda SEMPRE com um array de objetos JSON dentro de "pautas":
{
  "pautas": [
    {
      "score": 0-100,
      "recommend": true|false,
      "rationale": "por que essa nota",
      "search_keywords": ["palavra-chave com intenção de busca"],
      "discover_angle": "ângulo/headline que funcionaria no Discover",
      "suggested_headline": "manchete sugerida"
    }
  ]
}$sys$,
$usr$REGIÃO: {{region_name}}
RESUMO DO CONTEÚDO: {{summary}}
FATOS: {{facts}}

Identifique e avalie o potencial de todas as pautas possíveis neste conteúdo para Google Discover e Pesquisa.$usr$,
'{"response_mime_type":"application/json"}'::jsonb
);

-- ---- ETAPA 3: ESCRITA -------------------------------------------------------
insert into step_configs (project_id, step, provider, model, temperature, system_prompt, user_prompt_template, extra)
values (
  null, 'write', 'gemini', 'gemini-2.5-pro', 0.7,
$sys$Você é um repórter de jornalismo local. Escreva uma matéria em pt-BR a partir da base factual fornecida.

Regras:
- Use APENAS os fatos fornecidos. Não invente dados, falas ou números.
- Estrutura jornalística: lide forte na abertura, pirâmide invertida, parágrafos curtos.
- Tom informativo, claro e acessível ao leitor local. Sem sensacionalismo.
- Inclua contexto regional quando relevante.
- Se faltar informação essencial, escreva o que é possível e indique [VERIFICAR] nos pontos abertos.
- Saída em Markdown: comece com um título H1, depois o corpo.$sys$,
$usr$REGIÃO: {{region_name}}
MANCHETE SUGERIDA: {{suggested_headline}}
ÂNGULO: {{discover_angle}}

BASE FACTUAL:
Resumo: {{summary}}
Fatos: {{facts}}
Transcrição/origem: {{transcript}}

Escreva a matéria completa.$usr$,
'{}'::jsonb
);

-- ---- ETAPA 4: POLIMENTO EDITORIAL + SEO -------------------------------------
insert into step_configs (project_id, step, provider, model, temperature, system_prompt, user_prompt_template, extra)
values (
  null, 'polish', 'gemini', 'gemini-2.5-pro', 0.5,
$sys$Você é um editor-chefe e especialista em SEO. Receba um rascunho e entregue a versão final pronta para publicação.

Faça:
- Revisão de gramática, clareza, fluidez e padronização (pt-BR).
- Ajuste de título para equilibrar atratividade (Discover) e SEO (Pesquisa).
- Garantir que nada factual foi inventado em relação ao rascunho.
- Otimização SEO: meta description, slug, tags, intertítulos com palavras-chave.

Responda SEMPRE em JSON:
{
  "article_markdown": "matéria final em Markdown, pronta para publicar",
  "seo": {
    "title": "título SEO (<= 60 chars idealmente)",
    "meta_description": "<= 155 chars",
    "slug": "slug-amigavel",
    "tags": ["tag1","tag2"],
    "focus_keyword": "palavra-chave principal"
  }
}$sys$,
$usr$REGIÃO: {{region_name}}
PALAVRAS-CHAVE ALVO: {{search_keywords}}

RASCUNHO:
{{draft}}

Polir e otimizar conforme as instruções.$usr$,
'{"response_mime_type":"application/json"}'::jsonb
);

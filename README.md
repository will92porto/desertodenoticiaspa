# Deserto de Notícias

Plataforma para captar notícias de múltiplas fontes e produzir conteúdo jornalístico para regiões com escassez de cobertura ("desertos de notícias").

Stack: **GitHub + Supabase + Vercel + Gemini**.

## Visão geral

- **Projetos**: cada projeto cobre uma **região** específica.
- **Fontes**: cadastradas por URL. Suportam redes sociais (YouTube, Instagram, TikTok), Diário Oficial, sites públicos. O sistema detecta novidades em cada fonte.
- **Pipeline de 4 etapas**, cada uma com modelo e prompt configuráveis pelo admin:
  1. **Entendimento** — transcreve e compreende o conteúdo captado.
  2. **Ranking de pautas** — avalia e ranqueia pautas com potencial em Google Discover e Pesquisa.
  3. **Escrita** — redige a matéria.
  4. **Polimento editorial + SEO** — revisa, ajusta tom e otimiza para busca.
- Após a etapa 4, a matéria fica **pronta para publicação** via conector **WordPress**.

## Arquitetura

```
┌─────────────┐     ┌──────────────────────┐     ┌─────────────┐
│  Next.js    │────▶│      Supabase        │◀────│   Gemini    │
│ (Vercel)    │     │  Postgres + Edge Fns │     │   API       │
│ Painel Admin│     │  + Cron + Storage    │     └─────────────┘
└─────────────┘     └──────────┬───────────┘
                               │
                               ▼  (após etapa 4)
                        ┌─────────────┐
                        │  WordPress  │
                        │  REST API   │
                        └─────────────┘
```

O pipeline roda inteiramente como **Supabase Edge Functions** (Deno), acionadas por:
- **Cron** (`ingest-cron`): varre fontes ativas e detecta novidades por URL.
- **Mudança de status** no banco: cada item de conteúdo avança pelos estágios `captured → understood → ranked → written → polished → ready → published`. Um orquestrador processa itens prontos para a próxima etapa.

Detalhes em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Estrutura do repositório

```
.
├── web/                      # App Next.js (App Router) — painel admin (deploy na Vercel)
├── supabase/
│   ├── migrations/           # Schema SQL versionado
│   ├── functions/            # Edge Functions (Deno)
│   │   ├── _shared/          # Código compartilhado (Gemini, DB, tipos)
│   │   ├── ingest-cron/      # Detecção de novidades nas fontes
│   │   ├── pipeline-orchestrator/  # Avança itens pelas etapas
│   │   ├── step-understand/  # Etapa 1
│   │   ├── step-rank/        # Etapa 2
│   │   ├── step-write/       # Etapa 3
│   │   ├── step-polish/      # Etapa 4
│   │   └── publish-wordpress/# Publicação no WordPress
│   ├── seed.sql              # Dados iniciais (prompts default por etapa)
│   └── config.toml
├── docs/
│   ├── ARCHITECTURE.md
│   └── DEPLOY.md
└── README.md
```

## Setup rápido

Veja [`docs/DEPLOY.md`](docs/DEPLOY.md) para o passo a passo de GitHub → Supabase → Vercel.

Resumo:

```bash
# 1. Supabase
supabase link --project-ref <seu-ref>
supabase db push                 # aplica migrations
supabase db execute -f supabase/seed.sql
supabase functions deploy        # deploya todas as edge functions

# 2. Secrets das functions
supabase secrets set GEMINI_API_KEY=...

# 3. Web (Vercel)
cd web && vercel
```

## Status

Andaime completo (iteração 1): schema, pipeline com Gemini, painel admin e conector WordPress prontos para evoluir. Pontos marcados com `TODO` indicam onde plugar credenciais e refinar prompts.

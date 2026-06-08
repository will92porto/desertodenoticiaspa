# Deploy: GitHub → Supabase → Vercel

## 0. Pré-requisitos
- Conta Supabase, Vercel e uma chave da API Gemini ([Google AI Studio](https://aistudio.google.com)).
- `supabase` CLI instalado (`npm i -g supabase`).
- Repositório no GitHub: **DesertodeNoticias** (push na `main`).

## 1. Supabase

```bash
# Login e link com o projeto
supabase login
supabase link --project-ref <SEU_PROJECT_REF>

# Aplica o schema (migrations 0001, 0002, 0003)
supabase db push

# Carrega os prompts default das 4 etapas
supabase db execute -f supabase/seed.sql

# Configura os secrets das functions
supabase secrets set GEMINI_API_KEY=<sua-chave>
# (opcional) senha global do WordPress
supabase secrets set WORDPRESS_APP_PASSWORD=<application-password>

# Deploya todas as Edge Functions
supabase functions deploy ingest-cron
supabase functions deploy pipeline-orchestrator
supabase functions deploy step-understand
supabase functions deploy step-rank
supabase functions deploy step-write
supabase functions deploy step-polish
supabase functions deploy publish-wordpress
```

### Ativar o cron
A migration `0003_cron.sql` agenda `ingest-cron` (15 min) e `pipeline-orchestrator` (5 min).
Defina os parâmetros usados pelo helper SQL (no SQL Editor do Supabase):

```sql
alter database postgres set app.settings.functions_url = 'https://<REF>.supabase.co/functions/v1';
alter database postgres set app.settings.service_role_key = '<SERVICE_ROLE_KEY>';
```

## 2. Vercel (painel admin)

```bash
cd web
vercel
```

Variáveis de ambiente na Vercel (Project Settings → Environment Variables):

| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<REF>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key |

> **Proteja o painel** antes de uso real: ative Vercel Password Protection ou
> implemente Supabase Auth. O painel usa a service role no servidor.

## 3. WordPress

No WordPress de destino, crie uma **Application Password** (Usuários → Perfil) e:
- Guarde-a como secret no Supabase (ex.: `supabase secrets set WP_APP_PW_PROJETO1=...`).
- No painel, ao criar o projeto, informe a URL base, o usuário e o **nome do secret**.

A função `publish-wordpress` cria o post como **draft** por padrão (revisão humana). Mude para `publish` quando confiar no fluxo.

## 4. Primeiro teste
1. No painel: crie um projeto → uma região → uma fonte (ex.: um canal YouTube com `channel_id` no campo config, ou um site com RSS).
2. Clique em **Captar fontes agora** na aba Pipeline.
3. Clique em **Avançar pipeline** algumas vezes (ou aguarde o cron) e acompanhe o item percorrer as 4 etapas.
4. Quando chegar em **pronto**, clique em **Publicar**.

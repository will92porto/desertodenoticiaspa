# Funções standalone (deploy pelo editor web do Supabase)

O editor web do Dashboard sobe **apenas o arquivo da função**, sem a pasta `_shared`.
Por isso o erro `Module not found ".../_shared/db.ts"`.

Estes arquivos são versões **single-file** (tudo embutido, sem imports `../_shared`).
Cada um corresponde a uma função.

## Como deployar

No Dashboard → **Edge Functions** → crie/abra a função com o nome exato e cole o conteúdo:

| Função no Dashboard | Arquivo para colar |
|---|---|
| `step-understand` | `step-understand.ts` |
| `step-rank` | `step-rank.ts` |
| `step-write` | `step-write.ts` |
| `step-polish` | `step-polish.ts` |
| `pipeline-orchestrator` | `pipeline-orchestrator.ts` |
| `ingest-cron` | `ingest-cron.ts` |
| `publish-wordpress` | `publish-wordpress.ts` |

## Secrets necessários (Dashboard → Edge Functions → Secrets)

- `GEMINI_API_KEY` — obrigatório.
- `WORDPRESS_APP_PASSWORD` — para publicar (ou um secret por projeto, ex.: `WP_APP_PW_PROJETO1`).

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já são injetados automaticamente pelo Supabase.

## Importante: desative a verificação de JWT

Como o orquestrador e o cron chamam as funções entre si com a service role, em cada
função (aba **Details** / configurações) marque **"Verify JWT"** como **desativado**
para `ingest-cron`, `pipeline-orchestrator` e as 4 `step-*` (ou mantenha ativo e sempre
envie o header Authorization Bearer com a service role).

> As versões em `../<nome>/index.ts` (com imports `_shared`) continuam válidas para
> deploy via **CLI** (`supabase functions deploy`). Use estas standalone só no editor web.

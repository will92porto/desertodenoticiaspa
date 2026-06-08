# Arquitetura

## Princípios

1. **Projetos → Regiões → Fontes**: hierarquia que permite múltiplos projetos, cada um focado numa região, cada região com várias fontes distintas.
2. **Pipeline desacoplado em 4 etapas**, cada uma uma Edge Function independente, com modelo e prompt configuráveis pelo admin via `step_configs`.
3. **Estado no banco**: o `content_item.status` é a fonte da verdade. O orquestrador apenas empurra itens para a próxima etapa. Isso torna o sistema resiliente (reprocessável) e auditável (`pipeline_runs`).

## Fluxo de dados

```
Fonte (URL) ──[ingest-cron]──▶ content_item (captured)
                                      │
                    [pipeline-orchestrator] a cada 5 min
                                      │
   captured ─▶ step-understand ─▶ understood
   understood ─▶ step-rank ─────▶ ranked  (ou discarded se nota < 50)
   ranked ─▶ step-write ────────▶ written
   written ─▶ step-polish ──────▶ ready
                                      │
                      [publish-wordpress] (admin ou auto)
                                      ▼
                                 published
```

## Detecção de novidades

Cada fonte guarda `last_seen_marker`. O adaptador (`_shared/adapters.ts`) compara o estado atual com o marcador:

- **YouTube**: usa o feed XML do canal (`feeds/videos.xml?channel_id=...`) — não exige API key. O marcador é o `video_id` mais recente.
- **Site público / Diário Oficial**: se a URL é um feed (RSS/Atom), trata como feed; senão, hash SHA-256 da página — novidade = hash mudou.
- **Instagram / TikTok**: stub. Exigem provedor externo (ex.: Apify); retornam vazio até a credencial ser configurada (`config.provider_token`). Ponto marcado como `TODO`.

A transcrição de áudio/vídeo do YouTube na iteração 1 usa o texto disponível (legendas/descrição via feed) como `raw_content` e o Gemini estrutura na etapa 1. Para transcrição de áudio real, plugar Gemini multimodal ou Whisper no adaptador YouTube (ponto de extensão isolado).

## Configurável pelo admin

Tudo que muda o comportamento do modelo vive em `step_configs`:
`model`, `system_prompt`, `user_prompt_template`, `temperature`, `max_output_tokens`, `extra`.

Há um default global (`project_id IS NULL`) e overrides por projeto. O resolver (`_shared/prompt.ts → resolveStepConfig`) prioriza o override do projeto.

## Multi-provedor

O enum `ai_provider` e a coluna `provider` já existem. Hoje só `gemini` está implementado (`_shared/gemini.ts`). Adicionar outro provedor = nova função no estilo de `callGemini` e um switch em `runStep`.

## Segurança

- Edge Functions usam a **service role** (bypassa RLS).
- O painel admin usa service role apenas no servidor (Server Actions). Proteja o deploy da Vercel com autenticação (Vercel Password Protection ou Supabase Auth) antes de produção — ponto marcado em DEPLOY.md.
- Senhas do WordPress ficam como **secrets** das functions, referenciadas por nome no projeto.

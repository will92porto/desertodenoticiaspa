-- =============================================================================
-- Agendamento via pg_cron + pg_net (chamam as Edge Functions periodicamente).
-- =============================================================================
-- Requer as extensões pg_cron e pg_net (disponíveis no Supabase).
-- IMPORTANTE: defina os GUCs abaixo com a URL do projeto e a service role key
-- ANTES de aplicar, ou edite os valores diretamente:
--
--   alter database postgres set app.settings.functions_url = 'https://<ref>.supabase.co/functions/v1';
--   alter database postgres set app.settings.service_role_key = '<SERVICE_ROLE_KEY>';
--
-- (Em produção, prefira Supabase Vault para a key.)
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Helper para invocar uma Edge Function via HTTP POST.
create or replace function invoke_edge_function(fn text, payload jsonb default '{}'::jsonb)
returns void language plpgsql security definer as $$
declare
  base text := current_setting('app.settings.functions_url', true);
  key  text := current_setting('app.settings.service_role_key', true);
begin
  if base is null then
    raise notice 'app.settings.functions_url não configurado; cron inativo';
    return;
  end if;
  perform net.http_post(
    url     := base || '/' || fn,
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || coalesce(key,'')),
    body    := payload
  );
end $$;

-- Captura de fontes a cada 15 minutos.
select cron.schedule(
  'ingest-sources',
  '*/15 * * * *',
  $$ select invoke_edge_function('ingest-cron'); $$
);

-- Orquestrador a cada 5 minutos (avança itens pelo pipeline).
select cron.schedule(
  'run-pipeline',
  '*/5 * * * *',
  $$ select invoke_edge_function('pipeline-orchestrator'); $$
);

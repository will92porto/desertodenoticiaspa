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
alter table pipeline_runs  enable row level security;
alter table publications   enable row level security;

-- Política reutilizável: usuários autenticados podem tudo.
-- (A service role das Edge Functions ignora RLS por padrão.)

do $$
declare t text;
begin
  foreach t in array array[
    'projects','regions','sources','content_items',
    'step_configs','pipeline_runs','publications'
  ] loop
    execute format($f$
      create policy "authenticated full access" on %I
        for all
        to authenticated
        using (true)
        with check (true);
    $f$, t);
  end loop;
end $$;

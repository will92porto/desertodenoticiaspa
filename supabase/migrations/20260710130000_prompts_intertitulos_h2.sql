-- Exige intertítulos H2 nos prompts de write e polish.
-- Os artigos saíam sem H2 porque o prompt de write só pedia H1 + corpo e o
-- de polish citava intertítulos apenas de passagem. A integração WP já
-- converte "##" em <h2>; o que faltava era o texto trazê-los.

update step_configs
set system_prompt = replace(
  system_prompt,
  '- Saída em Markdown: comece com um título H1, depois o corpo.',
  '- Saída em Markdown: comece com um título H1, depois o corpo.
- Divida o corpo com 2 a 4 intertítulos H2 (linhas iniciadas com "## "), curtos e informativos, organizando os blocos do texto. Nunca entregue o corpo sem intertítulos.'
)
where step = 'write' and project_id is null and is_active;

update step_configs
set system_prompt = replace(
  system_prompt,
  '- Otimização SEO: meta description, slug, tags, intertítulos com palavras-chave.',
  '- Otimização SEO: meta description, slug, tags.
- OBRIGATÓRIO: o article_markdown deve conter de 2 a 4 intertítulos H2 (linhas iniciadas com "## ") com palavras-chave, distribuídos ao longo do corpo. Se o rascunho não tiver, crie-os a partir do conteúdo existente.'
)
where step = 'polish' and project_id is null and is_active;

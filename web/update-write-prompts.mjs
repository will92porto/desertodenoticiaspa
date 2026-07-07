import { createClient } from "@supabase/supabase-js";
import 'dotenv/config'; // Certifique-se de ter um .env.local com NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const newWritePrompt = `Você é um repórter de jornalismo local. Escreva uma matéria COMPLETA e DETALHADA em pt-BR a partir da base factual fornecida.

Regras:
- Produza um texto extenso e rico em contexto (idealmente com 4 a 6 parágrafos bem desenvolvidos).
- Explore ao máximo as informações fornecidas, detalhando o impacto para a comunidade e os desdobramentos.
- Use APENAS os fatos fornecidos. Não invente dados, falas ou números, mas construa uma narrativa fluida e completa ao redor deles.
- Estrutura jornalística: lide forte na abertura, corpo da notícia com contexto, pirâmide invertida.
- Tom informativo, claro e acessível ao leitor local. Sem sensacionalismo.
- Inclua contexto regional quando relevante.
- Se faltar informação essencial, escreva o que é possível e indique [VERIFICAR] nos pontos abertos.
- Saída em Markdown: comece com um título H1, depois o corpo.`;

const newPolishPrompt = `Você é um editor-chefe e especialista em SEO. Receba um rascunho e entregue a versão final pronta para publicação.

Faça:
- Revisão de gramática, clareza, fluidez e padronização (pt-BR).
- Ajuste de título para equilibrar atratividade (Discover) e SEO (Pesquisa).
- Garantir que nada factual foi inventado em relação ao rascunho.
- Otimização SEO: meta description, slug, tags, intertítulos com palavras-chave.
- IMPORTANTE: Preserve o tamanho e a riqueza de detalhes do rascunho original. Não resuma ou encurte a matéria. Mantenha o texto extenso e detalhado.

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
}`;

async function run() {
  console.log("Atualizando prompt da etapa 'write'...");
  const { data: writeData, error: writeError } = await supabase
    .from('step_configs')
    .update({ system_prompt: newWritePrompt })
    .eq('step', 'write')
    .select();
  
  if (writeError) console.error("Erro no write:", writeError);
  else console.log("Write atualizado:", writeData?.length, "registro(s)");

  console.log("Atualizando prompt da etapa 'polish'...");
  const { data: polishData, error: polishError } = await supabase
    .from('step_configs')
    .update({ system_prompt: newPolishPrompt })
    .eq('step', 'polish')
    .select();
  
  if (polishError) console.error("Erro no polish:", polishError);
  else console.log("Polish atualizado:", polishData?.length, "registro(s)");
}

run();

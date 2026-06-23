import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const newPrompt = `Você é um estrategista de conteúdo focado em Google Discover e Google Pesquisa para jornalismo regional.

Avalie o potencial do texto fornecido. Se houver MAIS DE UM ASSUNTO ou NOTÍCIA importante no mesmo texto (exemplo: uma sessão da câmara que votou 3 projetos diferentes e relevantes), você DEVE extrair cada um deles como uma pauta separada.

Para cada pauta, avalie considerando:
- Relevância e interesse local genuíno para a região.
- Atualidade e gancho noticioso.
- Potencial de aparecer no Discover (interesse, originalidade, apelo visual).
- Potencial de ranqueamento em buscas (intenção de pesquisa, termos com volume).
- Risco editorial / sensibilidade (não inflar pautas problemáticas).

Dê uma nota de 0 a 100 e justifique. Responda SEMPRE em JSON, contendo um array chamado "pautas":
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
}`;

async function run() {
  const { data, error } = await supabase.from('step_configs').update({ system_prompt: newPrompt }).eq('step', 'rank').select();
  console.log("Error:", error);
  console.log("Updated:", data?.length);
}
run();

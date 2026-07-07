// Cliente da API OpenRouter (substitui o antigo cliente Gemini direto).
// Mantido simples e sem dependências para rodar em Deno/Edge Functions.

export interface GeminiCallParams {
  model?: string; // Mantido para compatibilidade, mas sobrescrito internamente pelo array de fallback
  modelsToTry?: string[]; // Array dinâmico de modelos priorizados
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  youtubeUrl?: string;
}

export interface GeminiResult {
  text: string;
  tokensInput?: number;
  tokensOutput?: number;
  raw: unknown;
}

const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";

export async function callGemini(p: GeminiCallParams): Promise<GeminiResult> {
  const apiKey = Deno.env.get("OPEN_KEY");
  if (!apiKey) throw new Error("OPEN_KEY não configurada.");

  // Fallback configurado dinamicamente pelo banco ou padrão
  const modelsToTry = p.modelsToTry && p.modelsToTry.length > 0
    ? p.modelsToTry
    : [
        "google/gemma-3-27b-it",
        "google/gemini-2.5-flash-lite"
      ];

  let finalUserPrompt = p.userPrompt;

  const body: any = {
    models: modelsToTry,
    messages: [
      { role: "system", content: p.systemPrompt },
      { role: "user", content: finalUserPrompt }
    ],
    temperature: p.temperature ?? 0.7,
    max_tokens: p.maxOutputTokens ?? 4096,
  };

  if (p.responseMimeType === "application/json") {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(OPENROUTER_BASE, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://desertodenoticias.com",
      "X-Title": "Deserto de Noticias"
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${errText}`);
  }

  const json = await res.json();
  const text: string = json?.choices?.[0]?.message?.content ?? "";

  return {
    text,
    tokensInput: json?.usage?.prompt_tokens,
    tokensOutput: json?.usage?.completion_tokens,
    raw: json,
  };
}

// Helper: tenta parsear JSON da resposta, tolerando cercas de código.
export function parseJsonLoose<T = unknown>(text: string): T {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  return JSON.parse(t) as T;
}

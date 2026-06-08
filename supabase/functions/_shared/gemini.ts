// Cliente mínimo da API Gemini (generateContent) via REST.
// Mantido simples e sem dependências para rodar em Deno/Edge Functions.

export interface GeminiCallParams {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  // Quando "application/json", força saída JSON.
  responseMimeType?: string;
}

export interface GeminiResult {
  text: string;
  tokensInput?: number;
  tokensOutput?: number;
  raw: unknown;
}

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export async function callGemini(p: GeminiCallParams): Promise<GeminiResult> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada.");

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: p.systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: p.userPrompt }] }],
    generationConfig: {
      temperature: p.temperature ?? 0.7,
      maxOutputTokens: p.maxOutputTokens ?? 4096,
      ...(p.responseMimeType ? { responseMimeType: p.responseMimeType } : {}),
    },
  };

  const url = `${BASE}/${p.model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini ${res.status}: ${errText}`);
  }

  const json = await res.json();
  const text: string =
    json?.candidates?.[0]?.content?.parts?.map((x: { text?: string }) => x.text ?? "").join("") ?? "";

  return {
    text,
    tokensInput: json?.usageMetadata?.promptTokenCount,
    tokensOutput: json?.usageMetadata?.candidatesTokenCount,
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

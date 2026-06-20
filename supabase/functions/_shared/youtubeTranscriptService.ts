import { YoutubeTranscript } from "npm:youtube-transcript";
import { adminClient } from "./db.ts";

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)));
}

export async function fetchYoutubeTranscript(videoId: string): Promise<string | null> {
  const db = adminClient();
  const cacheKey = `youtube_transcript_v1_${videoId}`;

  try {
    // 1. Tenta buscar no cache
    const { data: cacheHit } = await db
      .from('kv_cache')
      .select('value, created_at')
      .eq('key', cacheKey)
      .single();

    if (cacheHit) {
      const createdAt = new Date(cacheHit.created_at);
      const now = new Date();
      const diffMs = now.getTime() - createdAt.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      // TTL de 7 dias
      if (diffDays <= 7) {
        return (cacheHit.value as { transcript: string }).transcript;
      }
    }

    // 2. Extrai usando npm:youtube-transcript
    // Tenta priorizar o idioma português; se não houver, faz fallback para a legenda padrão
    const segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'pt' })
      .catch(() => YoutubeTranscript.fetchTranscript(videoId));

    if (!segments || segments.length === 0) return null;

    // 3. Limpeza e montagem do texto
    const transcript = segments
      .map((s) => decodeEntities(s.text).trim())
      .filter(Boolean)
      .join(' ');

    // 4. Salva no cache usando upsert (para renovar data em caso de atualização)
    await db.from('kv_cache').upsert({
      key: cacheKey,
      value: { transcript },
      created_at: new Date().toISOString()
    });

    return transcript;
  } catch (error) {
    console.warn(`[youtube-transcript] Falha ao extrair vídeo ${videoId}:`, error);
    return null;
  }
}

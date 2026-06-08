// Adaptadores de fonte. Cada adaptador recebe a Source e o último marcador visto
// e retorna os NOVOS itens encontrados, mais o novo marcador.
//
// Iteração 1:
//   * website / diario_oficial / youtube: implementação real via RSS quando a
//     URL é um feed; senão, detecção por hash da página (novidade = mudança).
//   * youtube: tenta o feed XML de canal (videos.xml) sem precisar de API key.
//   * instagram / tiktok: STUB — exigem API paga (ex.: Apify). Marcados como TODO.
//
// O contrato é estável; trocar a implementação interna depois não muda o cron.

import type { Source, SourceType } from "./types.ts";

export interface NewItem {
  external_id: string;        // identidade única dentro da fonte
  external_url: string;
  title: string;
  raw_payload: Record<string, unknown>;
}

export interface FetchResult {
  items: NewItem[];
  newMarker: string | null;   // marcador a salvar em sources.last_seen_marker
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- RSS/Atom mínimo (sem libs externas) -----------------------------------
function parseFeed(xml: string): NewItem[] {
  const items: NewItem[] = [];
  // Suporta <item> (RSS) e <entry> (Atom). Parsing tolerante por regex.
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/\1>/g) ?? [];
  for (const b of blocks) {
    const get = (tag: string) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
    };
    // link pode ser <link>url</link> (RSS) ou <link href="url"/> (Atom)
    let link = get("link");
    if (!link) {
      const m = b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = m ? m[1] : "";
    }
    const id = get("guid") || get("id") || link;
    const title = get("title");
    const desc = get("description") || get("summary") || get("content");
    if (!id) continue;
    items.push({
      external_id: id,
      external_url: link || id,
      title,
      raw_payload: { description: desc, link, source_format: "feed" },
    });
  }
  return items;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "DesertoDeNoticiasBot/1.0" } });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return await res.text();
}

// Converte URL de canal do YouTube em feed XML quando possível.
function youtubeFeedUrl(source: Source): string | null {
  const channelId = source.config?.channel_id as string | undefined;
  if (channelId) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  }
  // Se a URL já for um feed, usa direto.
  if (source.url.includes("feeds/videos.xml")) return source.url;
  return null; // sem channel_id não dá para montar o feed sem API
}

// --- Adaptadores ------------------------------------------------------------

async function fromFeedLike(source: Source, lastMarker: string | null, feedUrl: string): Promise<FetchResult> {
  const xml = await fetchText(feedUrl);
  const all = parseFeed(xml);
  // Novidade = itens cujo external_id ainda não foi visto. Usamos o primeiro
  // external_id como marcador (feeds vêm em ordem cronológica decrescente).
  const newMarker = all[0]?.external_id ?? lastMarker;
  let fresh = all;
  if (lastMarker) {
    const idx = all.findIndex((i) => i.external_id === lastMarker);
    fresh = idx === -1 ? all : all.slice(0, idx);
  }
  return { items: fresh, newMarker };
}

async function fromWebsite(source: Source, lastMarker: string | null): Promise<FetchResult> {
  // Se for um feed, trata como feed. Senão, detecta mudança por hash.
  if (source.config?.rss || source.url.match(/\.(xml|rss)(\?|$)/) || source.url.includes("/feed")) {
    return fromFeedLike(source, lastMarker, source.url);
  }
  const html = await fetchText(source.url);
  const hash = await sha256(html);
  if (hash === lastMarker) {
    return { items: [], newMarker: hash }; // página inalterada
  }
  // Mudou: cria um item com o snapshot. A extração fina fica para a etapa 1.
  return {
    items: [{
      external_id: `${source.url}#${hash.slice(0, 12)}`,
      external_url: source.url,
      title: source.name,
      raw_payload: { body: html.slice(0, 200_000), source_format: "html_snapshot" },
    }],
    newMarker: hash,
  };
}

// Instagram / TikTok: requerem provedor externo (API paga). Stub explícito.
async function fromUnsupportedSocial(source: Source, _lastMarker: string | null, type: SourceType): Promise<FetchResult> {
  // TODO: plugar provedor (ex.: Apify actor) usando source.config.provider_token.
  // Retorna vazio para não quebrar o cron até a credencial ser configurada.
  console.warn(`[adapter:${type}] não implementado sem provedor externo: ${source.url}`);
  return { items: [], newMarker: _lastMarker ?? null };
}

export async function fetchNewItems(source: Source): Promise<FetchResult> {
  const last = source.last_seen_marker;
  switch (source.type) {
    case "youtube": {
      const feed = youtubeFeedUrl(source);
      if (!feed) {
        console.warn(`[adapter:youtube] sem channel_id/feed para ${source.url}`);
        return { items: [], newMarker: last };
      }
      return fromFeedLike(source, last, feed);
    }
    case "diario_oficial":
    case "website":
      return fromWebsite(source, last);
    case "instagram":
      return fromUnsupportedSocial(source, last, "instagram");
    case "tiktok":
      return fromUnsupportedSocial(source, last, "tiktok");
    default:
      return { items: [], newMarker: last };
  }
}

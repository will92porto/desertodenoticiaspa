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
import pdf from "npm:pdf-parse";
import { Buffer } from "node:buffer";

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

async function fromDiarioMunicipal(source: Source, lastMarker: string | null): Promise<FetchResult> {
  try {
    const sourceUrl = new URL(source.url);
    const baseUrl = sourceUrl.origin + sourceUrl.pathname;

    // 1. Acesso inicial para pegar o Cookie e o Token
    const initRes = await fetch(baseUrl, { headers: { "User-Agent": "DesertoDeNoticiasBot/1.0" } });
    const cookies = initRes.headers.get("set-cookie") || "";
    const initHtml = await initRes.text();

    const tokenMatch = initHtml.match(/name=["']busca_avancada\[_token\]["']\s+value=["']([^"']+)["']/i);
    if (!tokenMatch) {
      console.warn("[adapter:diario_municipal] Token CSRF não encontrado");
      return { items: [], newMarker: lastMarker };
    }
    const token = tokenMatch[1];

    // 2. Construir a URL de busca automatizada para o dia de hoje
    // Formato pt-BR: DD/MM/YYYY
    const todayStr = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    
    const searchUrl = new URL(source.url);
    searchUrl.searchParams.set("busca_avancada[dataInicio]", todayStr);
    searchUrl.searchParams.set("busca_avancada[dataFim]", todayStr);
    searchUrl.searchParams.set("busca_avancada[_token]", token);
    searchUrl.searchParams.set("busca_avancada[page]", "");

    // 3. Fazer a busca
    const searchRes = await fetch(searchUrl.toString(), {
      headers: {
        "User-Agent": "DesertoDeNoticiasBot/1.0",
        "Cookie": cookies,
        "Referer": baseUrl
      }
    });

    const searchHtml = await searchRes.text();

    // 4. Extrair os links das matérias (geralmente href=".../materia/hash")
    const regex = /href=["']([^"']+\/materia\/[a-zA-Z0-9]+)["']/ig;
    const links = new Set<string>();
    let match;
    while ((match = regex.exec(searchHtml)) !== null) {
      const link = new URL(match[1], baseUrl).toString();
      links.add(link);
    }

    const linksArr = Array.from(links);
    if (linksArr.length === 0) return { items: [], newMarker: lastMarker };

    // Marcador de hoje: "DD/MM/YYYY-qtdLinks" (assim se subirem novas matérias hoje, ele reprocessa ou detecta)
    const newMarker = `${todayStr}-${linksArr.length}`;
    if (newMarker === lastMarker) return { items: [], newMarker };

    const items: NewItem[] = [];
    // 5. Para cada link, extrair a matéria
    for (const link of linksArr) {
      try {
        const matRes = await fetch(link, { headers: { "User-Agent": "DesertoDeNoticiasBot/1.0", "Cookie": cookies } });
        const matHtml = await matRes.text();
        
        items.push({
          external_id: link, // a própria URL serve como ID única
          external_url: link,
          title: `Publicação Diário Municipal`,
          raw_payload: { body: matHtml.slice(0, 200_000), source_format: "diario_municipal_materia" }
        });
      } catch (e) {
        console.error(`[adapter:diario_municipal] Erro ao baixar matéria ${link}:`, e);
      }
    }

    return { items, newMarker };
  } catch (e) {
    console.error(`[adapter:diario_municipal] Erro geral:`, e);
    return { items: [], newMarker: lastMarker };
  }
}

async function fromDiarioOficial(source: Source, lastMarker: string | null): Promise<FetchResult> {
  // Delegação específica para o portal Diário Municipal
  if (source.url.includes("diariomunicipal.com.br/")) {
    return fromDiarioMunicipal(source, lastMarker);
  }

  // Tenta achar um link de PDF na URL ou extrair direto se for PDF.
  let pdfUrl = source.url;
  
  if (!pdfUrl.toLowerCase().endsWith(".pdf")) {
    const html = await fetchText(source.url);
    // Tenta encontrar o primeiro link para .pdf
    const match = html.match(/href=["']([^"']+\.pdf)["']/i);
    if (match && match[1]) {
      const extractedUrl = match[1];
      // Resolve URL relativa
      pdfUrl = new URL(extractedUrl, source.url).toString();
    } else {
      // Se não achar PDF, processa como website comum (fallback)
      return fromWebsite(source, lastMarker);
    }
  }

  // Verifica se o PDF mudou pela URL (ou usando a própria URL como marcador temporário)
  // Como Diários podem mudar todos os dias mas o link direto pode ter hash/data:
  if (pdfUrl === lastMarker) {
    return { items: [], newMarker: pdfUrl };
  }

  // Baixa o PDF
  try {
    const res = await fetch(pdfUrl, { headers: { "User-Agent": "DesertoDeNoticiasBot/1.0" } });
    if (!res.ok) throw new Error(`Falha ao baixar PDF: ${res.status}`);
    const ab = await res.arrayBuffer();
    
    // Extrai texto com pdf-parse
    const data = await pdf(Buffer.from(ab));
    const extractedText = data.text || "";

    return {
      items: [{
        external_id: pdfUrl,
        external_url: pdfUrl,
        title: `Diário Oficial - ${source.name}`,
        raw_payload: { body: extractedText, source_format: "pdf" },
      }],
      newMarker: pdfUrl,
    };
  } catch (e) {
    console.error(`[adapter:diario_oficial] Erro ao extrair PDF de ${pdfUrl}:`, e);
    // Em caso de erro, tenta fallback como html snapshot
    return fromWebsite(source, lastMarker);
  }
}

// Instagram / TikTok: requerem provedor externo (API paga). Stub explícito.
async function fromUnsupportedSocial(source: Source, _lastMarker: string | null, type: SourceType): Promise<FetchResult> {
  if (type === "instagram" && source.config?.rapidapi_key) {
    return fromInstagramRapidAPI(source, _lastMarker);
  }
  // TODO: plugar provedor (ex.: Apify actor) usando source.config.provider_token.
  // Retorna vazio para não quebrar o cron até a credencial ser configurada.
  console.warn(`[adapter:${type}] não implementado sem provedor externo: ${source.url}`);
  return { items: [], newMarker: _lastMarker ?? null };
}

async function fromInstagramRapidAPI(source: Source, lastMarker: string | null): Promise<FetchResult> {
  const apiKey = source.config?.rapidapi_key as string;
  // Extrai o username da URL
  const usernameMatch = source.url.match(/instagram\.com\/([a-zA-Z0-9_.-]+)/);
  const username = usernameMatch ? usernameMatch[1] : source.url.replace(/[^a-zA-Z0-9_.-]/g, "");

  // Utiliza a API "Instagram Bulk Scraper Latest" do RapidAPI como exemplo de endpoint gratuito viável
  const apiUrl = `https://instagram-bulk-scraper-latest.p.rapidapi.com/webuser_info/${username}`;
  
  try {
    const res = await fetch(apiUrl, {
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": "instagram-bulk-scraper-latest.p.rapidapi.com"
      }
    });

    if (!res.ok) {
       console.error(`[adapter:instagram] Erro na API do RapidAPI: ${res.status}`);
       return { items: [], newMarker: lastMarker };
    }

    const data = await res.json();
    const edges = data?.data?.user?.edge_owner_to_timeline_media?.edges ?? [];
    if (edges.length === 0) return { items: [], newMarker: lastMarker };
    
    const newMarker = edges[0].node.id ?? lastMarker;
    let fresh = edges;
    if (lastMarker) {
      const idx = edges.findIndex((e: any) => e.node.id === lastMarker);
      fresh = idx === -1 ? edges : edges.slice(0, idx);
    }

    const items: NewItem[] = [];
    for (const edge of fresh) {
      const node = edge.node;
      const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text || "";
      const shortcode = node.shortcode;
      const imageUrl = node.display_url;

      items.push({
        external_id: node.id,
        external_url: `https://www.instagram.com/p/${shortcode}/`,
        title: caption ? `${caption.slice(0, 50)}...` : `Post do Instagram (${shortcode})`,
        raw_payload: {
          caption,
          imageUrl,
          source_format: "instagram"
        }
      });
    }

    return { items, newMarker };
  } catch (e) {
    console.error(`[adapter:instagram] Erro na request RapidAPI:`, e);
    return { items: [], newMarker: lastMarker };
  }
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
      return fromDiarioOficial(source, last);
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

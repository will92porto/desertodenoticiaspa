// supabase/functions/_shared/db.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY s\xE3o obrigat\xF3rios.");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

// supabase/functions/_shared/http.ts
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
function handleOptions(req) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}

// supabase/functions/_shared/adapters.ts
async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/\1>/g) ?? [];
  for (const b of blocks) {
    const get = (tag) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
    };
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
      raw_payload: { description: desc, link, source_format: "feed" }
    });
  }
  return items;
}
async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "DesertoDeNoticiasBot/1.0" } });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return await res.text();
}
function youtubeFeedUrl(source) {
  const channelId = source.config?.channel_id;
  if (channelId) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  }
  if (source.url.includes("feeds/videos.xml")) return source.url;
  return null;
}
async function fromFeedLike(source, lastMarker, feedUrl) {
  const xml = await fetchText(feedUrl);
  const all = parseFeed(xml);
  const newMarker = all[0]?.external_id ?? lastMarker;
  let fresh = all;
  if (lastMarker) {
    const idx = all.findIndex((i) => i.external_id === lastMarker);
    fresh = idx === -1 ? all : all.slice(0, idx);
  }
  return { items: fresh, newMarker };
}
async function fromWebsite(source, lastMarker) {
  if (source.config?.rss || source.url.match(/\.(xml|rss)(\?|$)/) || source.url.includes("/feed")) {
    return fromFeedLike(source, lastMarker, source.url);
  }
  const html = await fetchText(source.url);
  const hash = await sha256(html);
  if (hash === lastMarker) {
    return { items: [], newMarker: hash };
  }
  return {
    items: [{
      external_id: `${source.url}#${hash.slice(0, 12)}`,
      external_url: source.url,
      title: source.name,
      raw_payload: { body: html.slice(0, 2e5), source_format: "html_snapshot" }
    }],
    newMarker: hash
  };
}
async function fromDiarioMunicipal(source, lastMarker) {
  try {
    const sourceUrl = new URL(source.url);
    const baseUrl = sourceUrl.origin + sourceUrl.pathname;
    const initRes = await fetch(baseUrl, { headers: { "User-Agent": "DesertoDeNoticiasBot/1.0" } });
    const cookies = initRes.headers.get("set-cookie") || "";
    const initHtml = await initRes.text();
    const tokenMatch = initHtml.match(/name=["']busca_avancada\[_token\]["']\s+value=["']([^"']+)["']/i);
    if (!tokenMatch) {
      console.warn("[adapter:diario_municipal] Token CSRF n\xE3o encontrado");
      return { items: [], newMarker: lastMarker };
    }
    const token = tokenMatch[1];
    const todayStr = (/* @__PURE__ */ new Date()).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const searchUrl = new URL(source.url);
    searchUrl.searchParams.set("busca_avancada[dataInicio]", todayStr);
    searchUrl.searchParams.set("busca_avancada[dataFim]", todayStr);
    searchUrl.searchParams.set("busca_avancada[_token]", token);
    searchUrl.searchParams.set("busca_avancada[page]", "");
    const searchRes = await fetch(searchUrl.toString(), {
      headers: {
        "User-Agent": "DesertoDeNoticiasBot/1.0",
        "Cookie": cookies,
        "Referer": baseUrl
      }
    });
    const searchHtml = await searchRes.text();
    const regex = /href=["']([^"']+\/(?:materia|load)\/[a-zA-Z0-9]+)["']/ig;
    const links = /* @__PURE__ */ new Set();
    let match;
    while ((match = regex.exec(searchHtml)) !== null) {
      const link = new URL(match[1], baseUrl).toString();
      links.add(link);
    }
    const linksArr = Array.from(links);
    if (linksArr.length === 0) return { items: [], newMarker: lastMarker };
    const newMarker = `${todayStr}-${linksArr.length}`;
    if (newMarker === lastMarker) return { items: [], newMarker };
    const items = [];
    for (const link of linksArr) {
      try {
        const matRes = await fetch(link, { headers: { "User-Agent": "DesertoDeNoticiasBot/1.0", "Cookie": cookies } });
        const matHtml = await matRes.text();
        items.push({
          external_id: link,
          // a própria URL serve como ID única
          external_url: link,
          title: `Publica\xE7\xE3o Di\xE1rio Municipal`,
          raw_payload: { body: matHtml.slice(0, 2e5), source_format: "diario_municipal_materia" }
        });
      } catch (e) {
        console.error(`[adapter:diario_municipal] Erro ao baixar mat\xE9ria ${link}:`, e);
      }
    }
    return { items, newMarker };
  } catch (e) {
    console.error(`[adapter:diario_municipal] Erro geral:`, e);
    return { items: [], newMarker: lastMarker };
  }
}
async function fromDiarioOficial(source, lastMarker) {
  if (source.url.includes("diariomunicipal.com.br/")) {
    return fromDiarioMunicipal(source, lastMarker);
  }
  let pdfUrl = source.url;
  if (!pdfUrl.toLowerCase().endsWith(".pdf")) {
    const html = await fetchText(source.url);
    const match = html.match(/href=["']([^"']+\.pdf)["']/i);
    if (match && match[1]) {
      const extractedUrl = match[1];
      pdfUrl = new URL(extractedUrl, source.url).toString();
    } else {
      return fromWebsite(source, lastMarker);
    }
  }
  if (pdfUrl === lastMarker) {
    return { items: [], newMarker: pdfUrl };
  }
  try {
    const res = await fetch(pdfUrl, { headers: { "User-Agent": "DesertoDeNoticiasBot/1.0" } });
    if (!res.ok) throw new Error(`Falha ao baixar PDF: ${res.status}`);
    const ab = await res.arrayBuffer();
    const { default: pdf } = await import("npm:pdf-parse");
    const { Buffer } = await import("node:buffer");
    const data = await pdf(Buffer.from(ab));
    const extractedText = data.text || "";
    return {
      items: [{
        external_id: pdfUrl,
        external_url: pdfUrl,
        title: `Di\xE1rio Oficial - ${source.name}`,
        raw_payload: { body: extractedText, source_format: "pdf" }
      }],
      newMarker: pdfUrl
    };
  } catch (e) {
    console.error(`[adapter:diario_oficial] Erro ao extrair PDF de ${pdfUrl}:`, e);
    return fromWebsite(source, lastMarker);
  }
}
async function fromUnsupportedSocial(source, _lastMarker, type) {
  if (type === "instagram") {
    return fromInstagramRapidAPI(source, _lastMarker);
  }
  console.warn(`[adapter:${type}] n\xE3o implementado sem provedor externo: ${source.url}`);
  return { items: [], newMarker: _lastMarker ?? null };
}
async function fromInstagramRapidAPI(source, lastMarker) {
  const apiKey = source.config?.rapidapi_key || Deno.env.get("RAPIDAPI_KEY") || "852d65438amsh865b038efa64420p176ca0jsn30ff032bead7";
  const apiUrl = `https://instagram-scraper-stable-api.p.rapidapi.com/get_ig_user_posts.php`;
  const formData = new URLSearchParams();
  formData.append("username_or_url", source.url);
  formData.append("amount", "12");
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": "instagram-scraper-stable-api.p.rapidapi.com",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: formData.toString()
    });
    if (!res.ok) {
      console.error(`[adapter:instagram] Erro na API do RapidAPI: ${res.status}`);
      return { items: [], newMarker: lastMarker };
    }
    const data = await res.json();
    const posts = data?.posts ?? [];
    if (posts.length === 0) return { items: [], newMarker: lastMarker };
    const newMarker = posts[0].node?.id ?? posts[0].node?.pk ?? lastMarker;
    let fresh = posts;
    const items = [];
    for (const postWrapper of fresh) {
      const post = postWrapper.node ?? postWrapper;
      const captionObj = post.caption ?? {};
      const baseCaption = captionObj.text ?? post.caption ?? "";
      const accessibilityCaption = post.accessibility_caption ?? "";
      const captionText = [baseCaption, accessibilityCaption].filter(Boolean).join("\n\n");
      const shortcode = post.code ?? post.shortcode ?? "";
      const id = post.id ?? post.pk ?? shortcode;
      items.push({
        external_id: id + "_test_bypass_" + Date.now(),
        external_url: `https://www.instagram.com/p/${shortcode}/`,
        title: captionText ? `${captionText.slice(0, 50)}...` : `Post do Instagram`,
        raw_payload: {
          caption: captionText,
          shortcode,
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
async function fromYoutubeScraper(source, lastMarker) {
  try {
    const res = await fetch(source.url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
    const html = await res.text();
    const match = html.match(/ytInitialData\s*=\s*({.+?});/);
    if (!match) return { items: [], newMarker: lastMarker };
    const data = JSON.parse(match[1]);
    const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs;
    let targetTab = tabs?.find((t) => t.tabRenderer?.selected === true);
    if (!targetTab) return { items: [], newMarker: lastMarker };
    const items = targetTab.tabRenderer?.content?.richGridRenderer?.contents || [];
    const videos = [];
    for (const i of items) {
      if (!i.richItemRenderer) continue;
      const c = i.richItemRenderer.content;
      let id, title;
      if (c.videoRenderer) {
        id = c.videoRenderer.videoId;
        title = c.videoRenderer.title?.runs?.[0]?.text;
      } else if (c.lockupViewModel) {
        id = c.lockupViewModel.contentId;
        title = c.lockupViewModel.metadata?.lockupMetadataViewModel?.title?.content;
      }
      if (id && title) {
        videos.push({ id, title, url: "https://www.youtube.com/watch?v=" + id });
      }
    }
    if (videos.length === 0) return { items: [], newMarker: lastMarker };
    const newMarker = videos[0].id ?? lastMarker;
    let fresh = videos;
    if (lastMarker) {
      const idx = videos.findIndex((v) => v.id === lastMarker);
      fresh = idx === -1 ? videos : videos.slice(0, idx);
    }
    const resultItems = [];
    for (const v of fresh) {
      resultItems.push({
        external_id: v.id,
        external_url: v.url,
        title: v.title,
        raw_payload: { videoId: v.id, title: v.title, source_format: "youtube_video" }
      });
    }
    return { items: resultItems, newMarker };
  } catch (e) {
    console.error(`[adapter:youtube] Erro no scraper direto:`, e);
    return { items: [], newMarker: lastMarker };
  }
}
async function fetchNewItems(source) {
  const last = source.last_seen_marker;
  switch (source.type) {
    case "youtube": {
      if (source.url.includes("/streams") || source.url.includes("/videos") || source.url.includes("@")) {
        const scraperRes = await fromYoutubeScraper(source, last);
        if (scraperRes.items.length > 0 || scraperRes.newMarker !== last) {
          return scraperRes;
        }
      }
      const feed = youtubeFeedUrl(source);
      if (!feed) {
        console.warn(`[adapter:youtube] sem channel_id/feed e scraper falhou para ${source.url}`);
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

// supabase/functions/ingest-cron/index.ts
Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const db = adminClient();
    const now = Date.now();
    const { data: sources, error } = await db.from("sources").select("*").eq("is_active", true);
    if (error) throw error;
    const report = [];
    for (const s of sources ?? []) {
      if (s.last_checked_at) {
        const due = new Date(s.last_checked_at).getTime() + s.check_interval_minutes * 6e4;
      }
      const { data: region } = await db.from("regions").select("id, project_id").eq("id", s.region_id).single();
      if (!region) continue;
      let created = 0;
      let errMsg = null;
      let newMarker = s.last_seen_marker;
      try {
        const result = await fetchNewItems(s);
        newMarker = result.newMarker;
        for (const it of result.items) {
          const { error: insErr } = await db.from("content_items").insert({
            source_id: s.id,
            region_id: region.id,
            project_id: region.project_id,
            external_id: it.external_id,
            external_url: it.external_url,
            title: it.title,
            raw_payload: it.raw_payload,
            status: "captured"
          });
          if (!insErr) created++;
        }
      } catch (e) {
        errMsg = e instanceof Error ? e.message : String(e);
      }
      await db.from("sources").update({
        last_checked_at: (/* @__PURE__ */ new Date()).toISOString(),
        last_seen_marker: newMarker
      }).eq("id", s.id);
      report.push({ source: s.name, type: s.type, created, error: errMsg });
    }
    return json({ ok: true, checked: report.length, report });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

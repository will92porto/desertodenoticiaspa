// ============================================================================
// INGEST — detecção de novidades nas fontes  (ARQUIVO ÚNICO para o editor web)
// Cole TODO este conteúdo no editor da função "ingest-cron".
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } });
}

// ---- adaptadores de fonte (inlined) ----
interface NewItem { external_id: string; external_url: string; title: string; raw_payload: Record<string, unknown>; }
interface FetchResult { items: NewItem[]; newMarker: string | null; }

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function parseFeed(xml: string): NewItem[] {
  const items: NewItem[] = [];
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/\1>/g) ?? [];
  for (const b of blocks) {
    const get = (tag: string) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
    };
    let link = get("link");
    if (!link) { const m = b.match(/<link[^>]*href=["']([^"']+)["']/i); link = m ? m[1] : ""; }
    const id = get("guid") || get("id") || link;
    const title = get("title");
    const desc = get("description") || get("summary") || get("content");
    if (!id) continue;
    items.push({ external_id: id, external_url: link || id, title, raw_payload: { description: desc, link, source_format: "feed" } });
  }
  return items;
}
async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "DesertoDeNoticiasBot/1.0" } });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return await res.text();
}
function youtubeFeedUrl(source: any): string | null {
  const channelId = source.config?.channel_id;
  if (channelId) return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  if (source.url.includes("feeds/videos.xml")) return source.url;
  return null;
}
// Descobre o channel_id automaticamente a partir de QUALQUER URL do YouTube
// (canal, /@handle, /c/, /user/, ou até um vídeo): baixa a página e extrai
// o identificador que o YouTube embute no HTML.
async function resolveYoutubeFeed(source: any): Promise<string | null> {
  const direct = youtubeFeedUrl(source);
  if (direct) return direct;
  try {
    const html = await fetchText(source.url);
    // O YouTube embute o canal de várias formas; tentamos as mais comuns.
    const patterns = [
      /"channelId":"(UC[\w-]{20,})"/,
      /"externalId":"(UC[\w-]{20,})"/,
      /channel_id=(UC[\w-]{20,})/,
      /\/channel\/(UC[\w-]{20,})/,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m) return `https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}`;
    }
  } catch (e) {
    console.warn(`[youtube] falha ao descobrir channel_id de ${source.url}: ${e}`);
  }
  return null;
}
async function fromFeedLike(source: any, lastMarker: string | null, feedUrl: string): Promise<FetchResult> {
  const xml = await fetchText(feedUrl);
  const all = parseFeed(xml);
  const newMarker = all[0]?.external_id ?? lastMarker;
  let fresh = all;
  if (lastMarker) { const idx = all.findIndex((i) => i.external_id === lastMarker); fresh = idx === -1 ? all : all.slice(0, idx); }
  return { items: fresh, newMarker };
}
async function fromWebsite(source: any, lastMarker: string | null): Promise<FetchResult> {
  if (source.config?.rss || source.url.match(/\.(xml|rss)(\?|$)/) || source.url.includes("/feed")) {
    return fromFeedLike(source, lastMarker, source.url);
  }
  const html = await fetchText(source.url);
  const hash = await sha256(html);
  if (hash === lastMarker) return { items: [], newMarker: hash };
  return { items: [{ external_id: `${source.url}#${hash.slice(0, 12)}`, external_url: source.url, title: source.name, raw_payload: { body: html.slice(0, 200000), source_format: "html_snapshot" } }], newMarker: hash };
}
async function fetchNewItems(source: any): Promise<FetchResult> {
  const last = source.last_seen_marker;
  switch (source.type) {
    case "youtube": {
      const feed = await resolveYoutubeFeed(source);
      if (!feed) { console.warn(`[youtube] não foi possível resolver o canal: ${source.url}`); return { items: [], newMarker: last }; }
      return fromFeedLike(source, last, feed);
    }
    case "diario_oficial":
    case "website": return fromWebsite(source, last);
    case "instagram":
    case "tiktok":
      // TODO: plugar provedor externo (ex.: Apify). Retorna vazio até configurar.
      console.warn(`[${source.type}] não implementado sem provedor externo: ${source.url}`);
      return { items: [], newMarker: last };
    default: return { items: [], newMarker: last };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const db = adminClient();
    const now = Date.now();
    const { data: sources, error } = await db.from("sources").select("*").eq("is_active", true);
    if (error) throw error;
    const report: unknown[] = [];

    for (const s of sources ?? []) {
      if (s.last_checked_at) {
        const due = new Date(s.last_checked_at).getTime() + s.check_interval_minutes * 60000;
        if (now < due) continue;
      }
      const { data: region } = await db.from("regions").select("id, project_id").eq("id", s.region_id).single();
      if (!region) continue;

      let created = 0, errMsg: string | null = null, newMarker = s.last_seen_marker;
      try {
        const result = await fetchNewItems(s);
        newMarker = result.newMarker;
        for (const it of result.items) {
          const { error: insErr } = await db.from("content_items").insert({
            source_id: s.id, region_id: region.id, project_id: region.project_id,
            external_id: it.external_id, external_url: it.external_url, title: it.title,
            raw_payload: it.raw_payload, status: "captured",
          });
          if (!insErr) created++;
        }
      } catch (e) { errMsg = e instanceof Error ? e.message : String(e); }

      await db.from("sources").update({ last_checked_at: new Date().toISOString(), last_seen_marker: newMarker }).eq("id", s.id);
      report.push({ source: s.name, type: s.type, created, error: errMsg });
    }
    return json({ ok: true, checked: report.length, report });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

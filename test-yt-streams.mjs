async function test() {
  const url = "https://www.youtube.com/@cmcanaadoscarajas/streams";
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
  const html = await res.text();
  const match = html.match(/ytInitialData\s*=\s*({.+?});/);
  if (match) {
    const data = JSON.parse(match[1]);
    const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs;
    const streamsTab = tabs?.find(t => t.tabRenderer?.title === "Ao vivo" || t.tabRenderer?.title === "Live" || t.tabRenderer?.endpoint?.commandMetadata?.webCommandMetadata?.url?.includes("/streams"));
    if (streamsTab) {
      const items = streamsTab.tabRenderer?.content?.richGridRenderer?.contents || [];
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
      console.log(videos);
    }
  }
}
test();

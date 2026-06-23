async function fromInstagramRapidAPI(url) {
  const apiKey = "852d65438amsh865b038efa64420p176ca0jsn30ff032bead7";
  const apiUrl = `https://instagram-scraper-stable-api.p.rapidapi.com/get_ig_user_posts.php`;
  
  const formData = new URLSearchParams();
  formData.append("username_or_url", url);
  formData.append("amount", "5");

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

    const data = await res.json();
    const posts = data?.posts ?? [];
    if (posts.length === 0) return;
    
    const items = [];
    for (const postWrapper of posts) {
      const post = postWrapper.node ?? postWrapper;
      const captionObj = post.caption ?? {};
      const baseCaption = captionObj.text ?? post.caption ?? "";
      const accessibilityCaption = post.accessibility_caption ?? "";
      const captionText = [baseCaption, accessibilityCaption].filter(Boolean).join("\n\n");

      items.push({
        shortcode: post.code ?? post.shortcode,
        captionText: captionText
      });
    }

    console.log(JSON.stringify(items, null, 2));

  } catch (e) {
    console.error(`Erro na request RapidAPI:`, e);
  }
}
fromInstagramRapidAPI("https://www.instagram.com/canaadoscarajas_pa/");

async function fromInstagramRapidAPI(url) {
  const apiKey = "852d65438amsh865b038efa64420p176ca0jsn30ff032bead7";
  const apiUrl = `https://instagram-scraper-stable-api.p.rapidapi.com/get_ig_user_posts.php`;
  
  const formData = new URLSearchParams();
  formData.append("username_or_url", url);
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
       console.error(`Erro na API: ${res.status}`);
       console.error(await res.text());
       return;
    }

    const data = await res.json();
    console.log("Raw Response Data:", JSON.stringify(data).slice(0, 300));
    const posts = data?.posts ?? [];
    if (posts.length === 0) {
        console.log("Nenhum post encontrado. Posts field might be empty.");
        return;
    }
    
    console.log("Sucesso! Posts captados:", posts.length);
  } catch (e) {
    console.error(`Erro na request RapidAPI:`, e);
  }
}
fromInstagramRapidAPI("https://www.instagram.com/canaadoscarajas_pa/");

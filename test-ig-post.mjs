async function run() {
  const apiKey = "852d65438amsh865b038efa64420p176ca0jsn30ff032bead7";
  const url = `https://instagram-scraper-stable-api.p.rapidapi.com/get_ig_user_posts.php`;
  
  const formData = new URLSearchParams();
  formData.append("username_or_url", "https://www.instagram.com/canaadoscarajas_pa/");
  formData.append("amount", "1");

  const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": "instagram-scraper-stable-api.p.rapidapi.com",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: formData.toString()
  });

  const data = await res.json();
  console.log(JSON.stringify(data.posts[0], null, 2));
}
run();

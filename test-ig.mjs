const data = 'username_or_url=https%3A%2F%2Fwww.instagram.com%2Fadorn_quran%2F&data=posts&amount=12';
fetch('https://instagram-scraper-stable-api.p.rapidapi.com/get_ig_user_posts_v2.php', {
  method: 'POST',
  headers: {
    'x-rapidapi-key': '852d65438amsh865b038efa64420p176ca0jsn30ff032bead7',
    'x-rapidapi-host': 'instagram-scraper-stable-api.p.rapidapi.com',
    'Content-Type': 'application/x-www-form-urlencoded'
  },
  body: data
}).then(r => r.json()).then(console.log).catch(console.error);

const endpoints = [
  "get_user_posts.php",
  "get_ig_user_posts.php",
  "get_user_feed.php",
  "get_ig_user_feed.php",
  "user_posts.php",
  "ig_user_posts.php"
];
const headers = {
  'x-rapidapi-key': '852d65438amsh865b038efa64420p176ca0jsn30ff032bead7',
  'x-rapidapi-host': 'instagram-scraper-stable-api.p.rapidapi.com',
  'Content-Type': 'application/x-www-form-urlencoded'
};
const data = 'username_or_url=https%3A%2F%2Fwww.instagram.com%2Fadorn_quran%2F&amount=5';

async function run() {
  for (const ep of endpoints) {
    const url = `https://instagram-scraper-stable-api.p.rapidapi.com/${ep}`;
    console.log("Trying", ep);
    const res = await fetch(url, { method: 'POST', headers, body: data });
    if (res.status !== 404) {
       console.log("Found!", ep, res.status);
       console.log(await res.text());
       break;
    }
  }
}
run();

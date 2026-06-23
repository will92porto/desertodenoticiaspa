const url = 'https://instagram-scraper-stable-api.p.rapidapi.com/get_ig_user_followers_v2.php';
const headers = {
  'x-rapidapi-key': '852d65438amsh865b038efa64420p176ca0jsn30ff032bead7',
  'x-rapidapi-host': 'instagram-scraper-stable-api.p.rapidapi.com',
  'Content-Type': 'application/x-www-form-urlencoded'
};

async function testFollowing() {
  const data = 'username_or_url=https%3A%2F%2Fwww.instagram.com%2Fadorn_quran%2F&data=following&amount=12';
  const res = await fetch(url, { method: 'POST', headers, body: data });
  const json = await res.json();
  console.log(JSON.stringify(json).slice(0, 500));
}
testFollowing();

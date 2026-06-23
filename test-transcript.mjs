import { YoutubeTranscript } from 'youtube-transcript';

async function run() {
  console.log("Fetching pt...");
  try {
    const t = await YoutubeTranscript.fetchTranscript("3uyX-yKJ2jA", { lang: 'pt' }).catch(() => YoutubeTranscript.fetchTranscript("3uyX-yKJ2jA"));
    console.log(t.slice(0, 2));
  } catch(e) {
    console.error("Error:", e);
  }
}
run();

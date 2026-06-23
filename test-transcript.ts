import { fetchYoutubeTranscript } from "./supabase/functions/_shared/youtubeTranscriptService.ts";

async function run() {
  console.log("Fetching...");
  try {
    const t = await fetchYoutubeTranscript("3uyX-yKJ2jA");
    console.log(t ? t.slice(0, 500) : "No transcript returned");
  } catch(e) {
    console.error("Error:", e);
  }
}
run();

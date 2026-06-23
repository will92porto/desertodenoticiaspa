import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data } = await supabase.from('content_items').select('id, external_url, sources(type)').eq('external_url', 'https://www.youtube.com/watch?v=3uyX-yKJ2jA').limit(1);
  console.log(data);
}
run();

import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data } = await supabase.from('content_items').select('id, external_url, status, rank_score, title').like('external_url', '%canaadoscarajas_pa%').limit(10);
  console.log("Found with URL like canaadoscarajas_pa:", data);

  const { data: data2 } = await supabase.from('content_items').select('id, external_url, status, rank_score, title').like('external_url', '%instagram.com/p/%').order('created_at', { ascending: false }).limit(5);
  console.log("Recent Instagram posts:", data2);
}
run();

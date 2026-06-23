import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data, error } = await supabase.rpc('get_foreign_keys_to', { table_name: 'content_items' });
  console.log("RPC Error:", error);
  // Alternative: query information_schema if rpc doesn't exist
  // We can't query information_schema directly via JS client, so let's just query all tables.
  console.log("Let's try to delete a single item and see the EXACT error.");
  
  const { error: delErr } = await supabase.from('content_items').delete().eq('id', 'some-non-existent-id');
  console.log("Delete error format:", delErr);
}
run();

import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data: items } = await supabase.from('content_items').select('id').limit(1);
  if (items && items.length > 0) {
    const id = items[0].id;
    console.log("Trying to delete:", id);
    const { error } = await supabase.from('content_items').delete().eq('id', id);
    console.log("Error:", error);
  } else {
    console.log("No items");
  }
}
run();

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// Puxar as variaveis do arquivo .env.local (ou do sistema, no ambiente do usuário não temos isso localmente? Wait, I will use Deno! Deno can fetch from supabase using service key if I pass it, but wait, the easiest way is to use edge functions.)

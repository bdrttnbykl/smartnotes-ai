import { createClient } from "@supabase/supabase-js";
import { requiredEnv } from "./env";

export const supabase = createClient(
  requiredEnv("SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY")
);

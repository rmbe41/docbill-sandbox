/**
 * Lädt goae-catalog-full.json in public.goae_catalog_snapshot (id=1).
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const jsonPath = join(__dirname, "../src/data/goae-catalog-full.json");
  const raw = JSON.parse(await readFile(jsonPath, "utf-8"));

  const sb = createClient(url, key);
  const { error } = await sb.from("goae_catalog_snapshot").upsert(
    {
      id: 1,
      catalog_json: raw,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log("goae_catalog_snapshot updated (id=1).");
}

main();

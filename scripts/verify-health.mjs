#!/usr/bin/env node
/**
 * Prüft GET /functions/v1/health (nach Deploy + PostHog-Secret in Supabase).
 * Nutzung: npm run verify:health
 * Optional: VITE_SUPABASE_URL in .env
 */
import "dotenv/config";

const base = (process.env.VITE_SUPABASE_URL || "https://qxaijnupaxxxsqaivbtj.supabase.co").replace(
  /\/$/,
  "",
);
const url = `${base}/functions/v1/health`;
const anon = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const res = await fetch(url, {
  headers: anon ? { apikey: anon } : {},
});

const text = await res.text();
console.log(text);
if (!res.ok) {
  console.error(`HTTP ${res.status}`);
  process.exit(1);
}
try {
  const j = JSON.parse(text);
  if (j.status !== "healthy" && j.status !== "degraded") {
    console.error("Unexpected status field:", j.status);
    process.exit(1);
  }
} catch {
  console.error("Response is not JSON");
  process.exit(1);
}

// Netlify build step: writes public/js/config.js from environment variables.
import fs from "node:fs";

const clean = (value) => (value || "").trim().replace(/^['\"]|['\"]$/g, "");
const url = clean(process.env.SUPABASE_URL);
const key = clean(process.env.SUPABASE_ANON_KEY);

const problems = [];
if (!url) {
  problems.push("SUPABASE_URL is missing or empty");
} else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) {
  problems.push("SUPABASE_URL should look like https://<project-ref>.supabase.co");
}

if (!key) {
  problems.push("SUPABASE_ANON_KEY is missing or empty");
} else {
  // Accept both newer Supabase publishable keys and legacy anon JWT keys.
  const isPublishableKey = key.startsWith("sb_publishable_");
  const isLegacyAnonJwt = key.split(".").length === 3;
  if (!isPublishableKey && !isLegacyAnonJwt) {
    problems.push("SUPABASE_ANON_KEY must be a Supabase publishable key (sb_publishable_...) or legacy anon JWT");
  }
}

if (problems.length) {
  console.error("\nCannot write public/js/config.js:");
  problems.forEach((problem) => console.error("  - " + problem));
  console.error("\nCheck Netlify: Site configuration > Environment variables, and ensure Builds scope is enabled.");
  console.error("Supabase variables visible to this build:", Object.keys(process.env).filter((name) => name.startsWith("SUPABASE_")).join(", ") || "(none)");
  process.exit(1);
}

fs.mkdirSync("public/js", { recursive: true });
fs.writeFileSync(
  "public/js/config.js",
  `window.FMS_CONFIG = ${JSON.stringify({
    SUPABASE_URL: url.replace(/\/$/, ""),
    SUPABASE_ANON_KEY: key,
    APP_NAME: "ASO FARM"
  })};\n`
);
console.log("Successfully generated public/js/config.js");
console.log("Supabase URL:", url);
console.log("Supabase publishable key configured:", key.startsWith("sb_publishable_"));

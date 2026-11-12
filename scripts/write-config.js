// Netlify build step: writes public/js/config.js from environment variables.
import fs from "node:fs";

const clean = (v) => (v || "").trim().replace(/^["']|["']$/g, "");
const url = clean(process.env.SUPABASE_URL);
const key = clean(process.env.SUPABASE_ANON_KEY);

const problems = [];
if (!url) problems.push("SUPABASE_URL is missing or empty");
else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) problems.push("SUPABASE_URL should look like https://<project-ref>.supabase.co");
if (!key) problems.push("SUPABASE_ANON_KEY is missing or empty");
else if (key.split(".").length !== 3) problems.push("SUPABASE_ANON_KEY should be the long anon public key (three parts separated by dots)");

if (problems.length) {
  console.error("\nCannot write public/js/config.js:");
  problems.forEach((p) => console.error("  - " + p));
  console.error("\nSet them in Netlify: Site configuration > Environment variables, with scope 'Builds' ticked, then redeploy.");
  console.error("Supabase variables this build can see:", Object.keys(process.env).filter((k) => k.startsWith("SUPABASE")).join(", ") || "(none)");
  process.exit(1);
}

fs.mkdirSync("public/js", { recursive: true });
fs.writeFileSync("public/js/config.js", `window.FMS_CONFIG = ${JSON.stringify({ SUPABASE_URL: url.replace(/\/$/, ""), SUPABASE_ANON_KEY: key, APP_NAME: "ASO FARM" })};\n`);
console.log("Wrote public/js/config.js");

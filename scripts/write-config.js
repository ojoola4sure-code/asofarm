
// Netlify build step: writes public/js/config.js from environment variables.
import fs from "node:fs";

const clean = (value) =>
  String(value || "").trim().replace(/^["']|["']$/g, "");

const url = clean(process.env.SUPABASE_URL);
const key = clean(process.env.SUPABASE_ANON_KEY);

const problems = [];

// Validate Supabase URL
if (!url) {
  problems.push("SUPABASE_URL is missing or empty");
} else {
  try {
    const parsed = new URL(url);

    if (
      parsed.protocol !== "https:" ||
      !/^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname)
    ) {
      problems.push(
        "SUPABASE_URL must look like https://project-ref.supabase.co"
      );
    }
  } catch {
    problems.push("SUPABASE_URL is not a valid URL");
  }
}

// Validate Supabase public key.
// Supports both new sb_publishable keys and legacy JWT anon keys.
if (!key) {
  problems.push("SUPABASE_ANON_KEY is missing or empty");
} else if (
  !key.startsWith("sb_publishable_") &&
  key.split(".").length !== 3
) {
  problems.push(
    "SUPABASE_ANON_KEY must be a Supabase publishable key or legacy anon JWT"
  );
} else if (key.startsWith("sb_secret_")) {
  problems.push(
    "A secret key cannot be used in frontend configuration"
  );
}

if (problems.length) {
  console.error("\nCannot write public/js/config.js:");

  problems.forEach((problem) => {
    console.error(" - " + problem);
  });

  console.error(
    "\nCheck Netlify > Project configuration > Environment variables."
  );

  console.error(
    "Make sure both variables are available to Builds."
  );

  console.error(
    "Supabase variables visible to this build:",
    Object.keys(process.env)
      .filter((name) => name.startsWith("SUPABASE"))
      .join(", ") || "(none)"
  );

  process.exit(1);
}

// Generate configuration file
fs.mkdirSync("public/js", { recursive: true });

const config = {
  SUPABASE_URL: url.replace(/\/+$/, ""),
  SUPABASE_ANON_KEY: key,
  APP_NAME: "ASO FARM"
};

fs.writeFileSync(
  "public/js/config.js",
  `window.FMS_CONFIG = ${JSON.stringify(config, null, 2)};\n`,
  "utf8"
);

console.log("Successfully generated public/js/config.js");
console.log("Supabase URL:", config.SUPABASE_URL);
console.log("Application:", config.APP_NAME);

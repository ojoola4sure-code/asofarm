// Creates the six staff accounts. Run once from your computer with the SERVICE ROLE key (never put that key in Netlify).
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-users.mjs
// Existing users keep their password unless you pass --reset-passwords.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.SEED_PASSWORD || "labalaba@2019";
const reset = process.argv.includes("--reset-passwords");
if (!url || !key) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

const db = createClient(url, key, { auth: { persistSession: false } });
const users = [
  { email: "admin@asofarm.com", full_name: "Farm Admin (Owner)", role: "admin" },
  { email: "operations.manager@asofarm.com", full_name: "Farm Operations Manager", role: "ops_manager" },
  { email: "supervisor@asofarm.com", full_name: "Farm Supervisor", role: "supervisor" },
  { email: "accountant@asofarm.com", full_name: "Finance & Accounts Officer", role: "accountant" },
  { email: "sales@asofarm.com", full_name: "Agribusiness Sales & Partnerships Officer", role: "sales" },
  { email: "research@asofarm.com", full_name: "AgricTech Research & Innovation Intern", role: "research" },
];

const { data: list, error: le } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (le) { console.error(le.message); process.exit(1); }

for (const u of users) {
  const existing = list.users.find((x) => x.email === u.email);
  let id;
  if (!existing) {
    const { data, error } = await db.auth.admin.createUser({
      email: u.email, password, email_confirm: true,
      user_metadata: { full_name: u.full_name }, app_metadata: { role: u.role },
    });
    if (error) { console.error(u.email, error.message); continue; }
    id = data.user.id;
    console.log("created", u.email);
  } else {
    id = existing.id;
    const patch = { app_metadata: { ...existing.app_metadata, role: u.role }, user_metadata: { ...existing.user_metadata, full_name: u.full_name } };
    if (reset) patch.password = password;
    const { error } = await db.auth.admin.updateUserById(id, patch);
    if (error) { console.error(u.email, error.message); continue; }
    console.log(reset ? "updated + password reset" : "updated", u.email);
  }
  const { error: pe } = await db.from("profiles").upsert({
    id, email: u.email, full_name: u.full_name, role: u.role, active: true,
    ...(existing && !reset ? {} : { must_change_password: true }),
  }, { onConflict: "id" });
  if (pe) console.error("profile", u.email, pe.message);
}
console.log("Done. Every new account must change its password at first sign-in.");

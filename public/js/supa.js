const cfg = window.FMS_CONFIG || {};
export const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
export const sb = configured
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

export const state = { user: null, profile: null, season: null };

export const ROLE_LABEL = {
  admin: "Admin / Owner", ops_manager: "Farm Operations Manager", supervisor: "Farm Supervisor",
  accountant: "Accountant", sales: "Agribusiness Sales", research: "AgricTech Research Intern",
};

export const role = () => state.profile?.role || null;
// roles == null means everyone; an array means those roles (admin always passes); [] means admin only
export const can = (roles) => (roles == null ? true : role() === "admin" || roles.includes(role()));
export const isAdmin = () => role() === "admin";
export const FIN = ["accountant", "ops_manager"];

/** Throws a readable error when a Supabase call fails; returns data otherwise. */
export const ok = (res) => {
  if (res.error) throw new Error(res.error.message || String(res.error));
  return res.data;
};

export async function rpc(name, args = {}) {
  return ok(await sb.rpc(name, args));
}

export async function fn(name, body = {}) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${cfg.SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, apikey: cfg.SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || res.statusText);
  return j;
}

export async function upload(bucket, file, folder = "misc") {
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${state.user.id}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from(bucket).upload(path, file, { upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

export async function openFile(bucket, path) {
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 120);
  if (error) throw new Error(error.message);
  window.open(data.signedUrl, "_blank", "noopener");
}

export async function currentSeason(force = false) {
  if (state.season && !force) return state.season;
  const rows = ok(await sb.from("seasons").select("*").order("start_date", { ascending: false }).limit(1));
  state.season = rows[0] || null;
  return state.season;
}

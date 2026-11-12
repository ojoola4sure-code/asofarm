import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

export type Caller = { mode: "cron" | "user"; userId?: string; role?: string };

/** Accepts either the pg_cron shared secret or a signed-in staff member's JWT. */
export async function authorize(req: Request, allowedRoles: string[]): Promise<Caller | null> {
  const db = admin();
  const secretHeader = req.headers.get("x-cron-secret");
  if (secretHeader) {
    const { data } = await db.from("app_settings").select("value").eq("key", "cron_secret").maybeSingle();
    const secret = data?.value as string | undefined;
    if (secret && secret.length >= 16 && secret === secretHeader) return { mode: "cron" };
    return null;
  }
  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
  if (!token) return null;
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return null;
  const { data: p } = await db.from("profiles").select("role, active").eq("id", u.user.id).maybeSingle();
  if (!p?.active || !p.role) return null;
  if (p.role !== "admin" && !allowedRoles.includes(p.role)) return null;
  return { mode: "user", userId: u.user.id, role: p.role };
}

export async function setting(db: ReturnType<typeof admin>, key: string, fallback: string) {
  const { data } = await db.from("app_settings").select("value").eq("key", key).maybeSingle();
  const v = data?.value;
  return v === undefined || v === null || v === "" ? fallback : String(v);
}

export async function openai(messages: unknown[], model: string, maxTokens = 1200) {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.3 }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return j.choices?.[0]?.message?.content as string;
}

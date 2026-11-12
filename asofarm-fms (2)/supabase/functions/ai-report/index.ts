// Writes an AI narrative report (weekly, monthly, market or research) from live farm data.
// Falls back to the plain data report if OPENAI_API_KEY is not set.
import { admin, authorize, cors, json, openai, setting } from "../_shared/util.ts";

const ROLES: Record<string, string[]> = {
  weekly: ["ops_manager", "accountant"],
  monthly: ["ops_manager", "accountant"],
  market: ["sales", "ops_manager"],
  research: ["research", "ops_manager"],
};
const AUDIENCE: Record<string, string[]> = {
  weekly: ["admin", "ops_manager", "supervisor"],
  monthly: ["admin", "ops_manager", "accountant"],
  market: ["admin", "sales", "ops_manager"],
  research: ["admin", "research", "ops_manager"],
};
const TYPE: Record<string, string> = { weekly: "weekly", monthly: "finance_monthly", market: "market", research: "research" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { type = "weekly" } = await req.json().catch(() => ({}));
    if (!ROLES[type]) return json({ error: "Unknown report type" }, 400);
    const caller = await authorize(req, ROLES[type]);
    if (!caller) return json({ error: "Not allowed" }, 403);
    const db = admin();
    const today = new Date().toISOString().slice(0, 10);
    const since = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

    let data: Record<string, unknown> = {};
    if (type === "weekly" || type === "monthly") {
      const dash = await db.rpc("dashboard_core", { p_season: null, p_full: true });
      const overdue = await db.from("v_tasks").select("title,stage_name,assignee_role,due_date,days_overdue").gt("days_overdue", 0).order("days_overdue", { ascending: false }).limit(15);
      const txns = await db.from("v_transactions").select("txn_date,payee,description,amount,status,category_name").gte("txn_date", since(type === "weekly" ? 7 : 31)).order("txn_date", { ascending: false }).limit(40);
      const weather = await db.from("weather_readings").select("reading_date,rain_mm,temp_max").gte("reading_date", since(14)).order("reading_date");
      const risks = await db.from("risks").select("title,score,status,mitigation").neq("status", "closed").order("score", { ascending: false }).limit(6);
      const logs = await db.from("field_logs").select("log_date,activity,labour_count,notes").gte("log_date", since(type === "weekly" ? 7 : 31)).order("log_date", { ascending: false }).limit(20);
      data = { dashboard: dash.data, overdue_tasks: overdue.data, transactions: txns.data, weather: weather.data, top_risks: risks.data, field_logs: logs.data };
    } else if (type === "market") {
      const prices = await db.from("market_prices").select("price_date,crop,market,price_per_tonne,source").gte("price_date", since(90)).order("price_date", { ascending: false }).limit(80);
      const buyers = await db.from("buyers").select("name,buyer_type,status,location,crops").limit(60);
      const agreements = await db.from("supply_agreements").select("crop,qty_tonnes,price_per_tonne,status,delivery_start,delivery_end").limit(40);
      const dash = await db.rpc("dashboard_core", { p_season: null, p_full: false });
      data = { prices: prices.data, buyers: buyers.data, agreements: agreements.data, sales_cover: (dash.data as any)?.sales, harvest: (dash.data as any)?.harvest };
    } else {
      const obs = await db.from("crop_observations").select("obs_date,crop,growth_stage,plant_height_cm,canopy_cover_pct,disease_score,pest_score,notes").gte("obs_date", since(45)).order("obs_date", { ascending: false }).limit(60);
      const cases = await db.from("disease_cases").select("case_date,crop,symptoms,ai_assessment,status").gte("case_date", since(60)).limit(20);
      const yields = await db.from("v_yield_by_block").select("sample_date,crop,block_name,tonnes_per_acre").limit(30);
      const soil = await db.from("soil_samples").select("sample_date,ph,organic_matter_pct,nitrogen_pct,phosphorus_ppm,potassium_cmol").limit(20);
      const pilots = await db.from("tech_pilots").select("name,tech,status,findings").limit(20);
      data = { observations: obs.data, disease_cases: cases.data, yields: yields.data, soil: soil.data, pilots: pilots.data };
    }

    const model = await setting(db, "openai_model", "gpt-4o-mini");
    const prompt = [
      { role: "system", content: "You are the analyst for ASO FARM, a 10-acre cassava and maize farm in Oyo State, Nigeria. Write a concise, plain-English " + type + " report in Markdown for the farm team. Use only the JSON data provided. Never invent numbers. Use naira amounts as N followed by digits. Structure: Summary (3 sentences), What is going well, What needs attention (with a specific action and the role responsible), Next 7 days. If data is missing, say so." },
      { role: "user", content: "Today is " + today + ". Data:\n" + JSON.stringify(data).slice(0, 24000) },
    ];
    let body: string | null = null;
    try { body = await openai(prompt, model); } catch (e) { console.error(e); }
    if (!body) {
      if (type === "weekly" || type === "monthly") {
        const r = await db.rpc("generate_basic_report", { p_type: type });
        return json({ id: r.data, note: "OPENAI_API_KEY missing or call failed; saved the data report instead." });
      }
      return json({ error: "OPENAI_API_KEY is not set or the OpenAI call failed" }, 500);
    }
    const period = type === "weekly" ? today : today.slice(0, 7);
    const { data: row, error } = await db.from("reports").insert({
      report_type: TYPE[type], period, title: `AI ${type} report ${period}`, body_md: body,
      data: { source: "openai", model }, audience: AUDIENCE[type], generated_by: "ai", created_by: caller.userId ?? null,
    }).select("id").single();
    if (error) throw error;
    return json({ id: row.id });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

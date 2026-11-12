// Pulls daily weather for the farm from Open-Meteo (no API key) and raises rule-based alerts.
import { admin, authorize, cors, json, setting } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const caller = await authorize(req, ["research", "ops_manager"]);
    if (!caller) return json({ error: "Not allowed" }, 403);
    const db = admin();
    const lat = await setting(db, "farm_lat", "8.2");
    const lon = await setting(db, "farm_lon", "3.6");
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&past_days=7&forecast_days=1&timezone=Africa%2FLagos`;
    const res = await fetch(url);
    if (!res.ok) return json({ error: "Weather service error " + res.status }, 502);
    const j = await res.json();
    const d = j.daily;
    const rows = d.time.map((t: string, i: number) => ({
      reading_date: t, rain_mm: d.precipitation_sum[i], temp_max: d.temperature_2m_max[i], temp_min: d.temperature_2m_min[i], source: "open-meteo",
    }));
    await db.from("weather_readings").upsert(rows, { onConflict: "reading_date" });

    const since = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const { data: w } = await db.from("weather_readings").select("reading_date,rain_mm").gte("reading_date", since(14));
    const rain14 = (w ?? []).reduce((s: number, r: any) => s + Number(r.rain_mm ?? 0), 0);
    const rain2 = (w ?? []).filter((r: any) => r.reading_date >= since(2)).reduce((s: number, r: any) => s + Number(r.rain_mm ?? 0), 0);
    const today = new Date().toISOString().slice(0, 10);
    const week = new Date().toISOString().slice(0, 10) + "-w" + Math.floor(Date.now() / (7 * 86400000));
    let alerts = 0;

    const { data: critical } = await db.from("stages").select("id,name,planned_start,planned_end,status")
      .in("seq", [4, 5, 13, 18]).neq("status", "done");
    const planting = (critical ?? []).filter((s: any) => s.planned_start <= since(-7) && s.planned_end >= since(14));
    if (rain14 < 10 && planting.length) {
      await db.rpc("notify", { p_role: "ops_manager", p_user: null, p_title: "Dry spell during establishment", p_body: `Only ${rain14.toFixed(1)} mm of rain in 14 days while ${planting[0].name} is active. Consider replanting plans or irrigation.`, p_link: "#/weather", p_level: "warning", p_dedupe: "dry:" + week });
      await db.rpc("notify", { p_role: "supervisor", p_user: null, p_title: "Dry spell: check sprouting and moisture", p_body: `${rain14.toFixed(1)} mm in 14 days.`, p_link: "#/weather", p_level: "warning", p_dedupe: "dry-s:" + week });
      alerts++;
    }
    if (rain2 > 80) {
      await db.rpc("notify", { p_role: "supervisor", p_user: null, p_title: "Heavy rain: check drainage and erosion", p_body: `${rain2.toFixed(0)} mm in 2 days. Inspect ridges, stored inputs and roads.`, p_link: "#/weather", p_level: "warning", p_dedupe: "heavy:" + today });
      await db.rpc("notify", { p_role: "ops_manager", p_user: null, p_title: "Heavy rain recorded", p_body: `${rain2.toFixed(0)} mm in 2 days.`, p_link: "#/weather", p_level: "warning", p_dedupe: "heavy-o:" + today });
      alerts++;
    }
    return json({ saved: rows.length, rain14, rain2, alerts });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

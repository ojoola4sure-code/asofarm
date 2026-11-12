import { sb, ok, state, can, role, fn, currentSeason } from "../supa.js";
import { reg } from "../router.js";
import { esc, money, date, num, badge, toast, fail, today, $, modal } from "../ui.js";
import { crudPage } from "../crud.js";
import { lineChart } from "../charts.js";

const R = ["research", "ops_manager"], RS = ["research", "ops_manager", "supervisor"];
const VIEW = ["research", "ops_manager", "supervisor"];
const blockRef = { table: "blocks" };

reg("observations", {
  title: "Crop observations", group: "Research", label: "Observations", roles: VIEW,
  render: crudPage({
    title: "Crop development observations", subtitle: "Growth stage, height, canopy and pest/disease scores per block.", table: "crop_observations", select: "*, blocks(name)", order: [["obs_date", false]], create: RS, edit: RS, remove: R, newLabel: "Add observation", fileBucket: "field-photos",
    columns: [{ key: "obs_date", label: "Date", type: "date" }, { label: "Block", get: (r) => r.blocks?.name || "" }, { key: "crop", label: "Crop" }, { key: "growth_stage", label: "Growth stage" }, { key: "plant_height_cm", label: "Height (cm)", type: "num" }, { key: "canopy_cover_pct", label: "Canopy %", type: "num" }, { key: "disease_score", label: "Disease 0-5", type: "num" }, { key: "pest_score", label: "Pest 0-5", type: "num" }, { key: "photo_path", label: "Photo", type: "file" }],
    fields: [{ key: "obs_date", label: "Date", type: "date", default: today, required: true }, { key: "block_id", label: "Block", type: "ref", ref: blockRef }, { key: "crop", label: "Crop", type: "select", options: ["cassava", "maize"], default: "cassava" }, { key: "growth_stage", label: "Growth stage", help: "Sprouting, vegetative, tuber bulking, tasselling…" },
      { key: "plant_height_cm", label: "Plant height (cm)", type: "number" }, { key: "canopy_cover_pct", label: "Canopy cover (%)", type: "number" }, { key: "disease_score", label: "Disease score (0 to 5)", type: "number", min: 0 }, { key: "pest_score", label: "Pest score (0 to 5)", type: "number", min: 0 },
      { key: "photo_path", label: "Photo", type: "file", bucket: "field-photos", folder: "observations", capture: true }, { key: "notes", label: "Notes", type: "textarea" }],
  }),
});

reg("soil", {
  title: "Soil samples", group: "Research", label: "Soil", roles: VIEW,
  render: crudPage({
    title: "Soil sample results", table: "soil_samples", select: "*, blocks(name)", order: [["sample_date", false]], create: RS, edit: RS, remove: R, newLabel: "Add sample",
    columns: [{ key: "sample_date", label: "Date", type: "date" }, { label: "Block", get: (r) => r.blocks?.name || "" }, { key: "ph", label: "pH", type: "num", dec: 1 }, { key: "organic_matter_pct", label: "Organic matter %", type: "num", dec: 1 }, { key: "nitrogen_pct", label: "N %", type: "num", dec: 2 }, { key: "phosphorus_ppm", label: "P (ppm)", type: "num", dec: 1 }, { key: "potassium_cmol", label: "K (cmol/kg)", type: "num", dec: 2 }, { key: "texture", label: "Texture" }],
    fields: [{ key: "sample_date", label: "Date", type: "date", default: today, required: true }, { key: "block_id", label: "Block", type: "ref", ref: blockRef }, { key: "ph", label: "pH", type: "number" }, { key: "organic_matter_pct", label: "Organic matter (%)", type: "number" }, { key: "nitrogen_pct", label: "Nitrogen (%)", type: "number" }, { key: "phosphorus_ppm", label: "Phosphorus (ppm)", type: "number" }, { key: "potassium_cmol", label: "Potassium (cmol/kg)", type: "number" }, { key: "texture", label: "Texture" }, { key: "notes", label: "Notes", type: "textarea" }],
  }),
});

reg("weather", {
  title: "Weather", group: "Research", label: "Weather", roles: VIEW,
  async render(el) {
    const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const rows = ok(await sb.from("weather_readings").select("*").gte("reading_date", since).order("reading_date"));
    const total = rows.reduce((s, r) => s + Number(r.rain_mm || 0), 0);
    el.innerHTML = `<div class="page"><div class="page-head"><div><h2>Weather</h2><p>Pulled automatically every morning from Open-Meteo for the farm coordinates in Settings. ${num(total, 0)} mm of rain in the last 60 days.</p></div><div class="spacer"></div>${can(R) ? '<button class="btn" id="sync">Sync now</button>' : ""}</div>
      <div class="card" style="margin-bottom:16px"><h3>Daily rainfall (mm)</h3>${rows.length ? lineChart([{ name: "Rain", color: "#2457c5", points: rows.map((r) => ({ x: r.reading_date.slice(5), y: Number(r.rain_mm || 0) })) }], { zeroLine: false, fmt: (v) => Math.round(v) + " mm" }) : '<div class="empty">No readings yet. Set the farm coordinates in Settings, then press Sync now.</div>'}</div><div id="list"></div></div>`;
    const s = $("#sync");
    if (s) s.onclick = async () => { s.disabled = true; try { const r = await fn("weather-sync"); toast(`Saved ${r.saved} days. Rain in 14 days: ${Number(r.rain14).toFixed(1)} mm.`, "ok"); window.dispatchEvent(new HashChangeEvent("hashchange")); } catch (e) { fail(e); s.disabled = false; } };
    await crudPage({
      title: "Readings", table: "weather_readings", order: [["reading_date", false]], create: ["research"], edit: ["research"], remove: ["research"], newLabel: "Add reading", limit: 120,
      columns: [{ key: "reading_date", label: "Date", type: "date" }, { key: "rain_mm", label: "Rain (mm)", type: "num", dec: 1 }, { key: "temp_max", label: "Max °C", type: "num", dec: 1 }, { key: "temp_min", label: "Min °C", type: "num", dec: 1 }, { key: "source", label: "Source" }],
      fields: [{ key: "reading_date", label: "Date", type: "date", required: true, default: today }, { key: "rain_mm", label: "Rain (mm)", type: "number" }, { key: "temp_max", label: "Max temperature (°C)", type: "number" }, { key: "temp_min", label: "Min temperature (°C)", type: "number" }, { key: "source", label: "Source", default: "manual" }],
    })(document.getElementById("list"));
  },
});

reg("disease", {
  title: "Disease cases", group: "Research", label: "Disease cases", roles: VIEW,
  render: crudPage({
    title: "Pest and disease cases", subtitle: "Add a clear photo, then run the AI check for an advisory opinion. The agronomist decides treatment.", table: "disease_cases", select: "*, blocks(name)", order: [["case_date", false]], create: RS, edit: RS, remove: R, newLabel: "New case", fileBucket: "field-photos", wide: true,
    filter: { key: "status", label: "statuses", options: ["new", "assessed", "treated", "closed"] },
    columns: [{ key: "case_date", label: "Date", type: "date" }, { label: "Block", get: (r) => r.blocks?.name || "" }, { key: "crop", label: "Crop" }, { key: "symptoms", label: "Symptoms" }, { key: "status", label: "Status", type: "badge" }, { label: "AI note", render: (r) => (r.ai_assessment ? badge("ready", "info") : "") }, { key: "photo_path", label: "Photo", type: "file" }],
    fields: [{ key: "case_date", label: "Date", type: "date", default: today, required: true }, { key: "block_id", label: "Block", type: "ref", ref: blockRef }, { key: "crop", label: "Crop", type: "select", options: ["cassava", "maize"], default: "cassava" }, { key: "status", label: "Status", type: "select", options: ["new", "assessed", "treated", "closed"], default: "new" },
      { key: "symptoms", label: "Symptoms seen", type: "textarea" }, { key: "photo_path", label: "Photo", type: "file", bucket: "field-photos", folder: "disease", capture: true }, { key: "ai_assessment", label: "AI assessment (advisory only)", type: "textarea", readonly: true }, { key: "treatment", label: "Treatment decided", type: "textarea" }],
    actions: [{
      label: "AI check", roles: RS, run: async (r, reload) => {
        if (!r.photo_path) return toast("Add a photo to the case first", "bad");
        toast("Checking the photo…");
        const out = await fn("ai-vision", { case_id: r.id });
        modal({ title: "AI assessment (advisory only)", body: `<pre style="white-space:pre-wrap;font-family:inherit">${esc(out.assessment)}</pre>` });
        reload();
      },
    }],
  }),
});

reg("yields", {
  title: "Yield samples", group: "Research", label: "Yield analysis", roles: VIEW,
  render: crudPage({
    title: "Yield samples", subtitle: "Weigh the produce from a measured plot. Tonnes per acre is calculated for you.", table: "yield_samples", source: "v_yield_by_block", order: [["sample_date", false]], create: RS, edit: RS, remove: R, newLabel: "Add sample",
    columns: [{ key: "sample_date", label: "Date", type: "date" }, { key: "block_name", label: "Block" }, { key: "crop", label: "Crop" }, { key: "sample_area_m2", label: "Plot (m²)", type: "num" }, { key: "fresh_weight_kg", label: "Fresh weight (kg)", type: "num", dec: 1 }, { label: "Tonnes / acre", render: (r) => `<b>${num(r.tonnes_per_acre, 2)}</b>` }],
    fields: [{ key: "sample_date", label: "Date", type: "date", default: today, required: true }, { key: "block_id", label: "Block", type: "ref", ref: blockRef }, { key: "crop", label: "Crop", type: "select", options: ["cassava", "maize"], required: true }, { key: "sample_area_m2", label: "Plot area (m²)", type: "number", required: true, default: 100 }, { key: "fresh_weight_kg", label: "Fresh weight (kg)", type: "number", required: true }, { key: "notes", label: "Notes", type: "textarea" }],
  }),
});

reg("pilots", {
  title: "Technology pilots", group: "Research", label: "Tech pilots", roles: R,
  render: crudPage({
    title: "AI, drone and satellite pilots", subtitle: "Track experiments from idea to findings.", table: "tech_pilots", order: [["start_date", false]], create: R, edit: R, remove: R, newLabel: "New pilot", wide: true,
    columns: [{ key: "name", label: "Pilot" }, { key: "tech", label: "Technology", type: "badge" }, { key: "status", label: "Status", type: "badge" }, { key: "owner", label: "Owner" }, { key: "start_date", label: "Start", type: "date" }, { key: "findings", label: "Findings" }],
    fields: [{ key: "name", label: "Pilot name", required: true }, { key: "tech", label: "Technology", type: "select", options: ["ai_cv", "drone", "satellite", "sensors", "other"], required: true }, { key: "status", label: "Status", type: "select", options: ["idea", "planning", "running", "review", "done"], required: true, default: "idea" }, { key: "owner", label: "Owner" }, { key: "start_date", label: "Start date", type: "date" },
      { key: "objective", label: "Objective", type: "textarea" }, { key: "findings", label: "Findings and recommendation", type: "textarea" }],
  }),
});

reg("notes", {
  title: "Research notes", group: "Research", label: "Research notes", roles: R,
  render: crudPage({
    title: "Research notes and summaries", table: "research_notes", order: [["created_at", false]], create: R, edit: R, remove: R, newLabel: "New note", wide: true, fileBucket: "documents",
    columns: [{ key: "created_at", label: "Date", type: "date" }, { key: "title", label: "Title" }, { key: "tags", label: "Tags", type: "tags" }, { key: "document_path", label: "File", type: "file" }],
    fields: [{ key: "title", label: "Title", required: true, full: true }, { key: "tags", label: "Tags", type: "tags" }, { key: "document_path", label: "Attach file", type: "file", bucket: "documents", folder: "research" }, { key: "body", label: "Note", type: "textarea" }],
  }),
});

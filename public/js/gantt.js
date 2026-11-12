import { sb, ok, state, role } from "./supa.js";
import { esc, date, badge, modal, $, $$, fail, daysBetween, today } from "./ui.js";
import { taskTableHtml, bindTaskControls } from "./tasklib.js";
import { ROLE_LABEL } from "./supa.js";

const GROUP_CLASS = { Preparation: "g-prep", Establishment: "g-est", Maintenance: "g-maint", Harvest: "g-harv", "Post-harvest": "g-post", "Close-out": "g-close" };
const D = (s) => Math.floor(new Date(s + "T00:00:00Z").getTime() / 86400000);

export function ganttLegend() {
  const items = [["#6f7cc2", "Preparation"], ["#2f9e66", "Establishment"], ["#5b7fd6", "Maintenance"], ["#d98f00", "Harvest"], ["#9b59b6", "Post-harvest"], ["#55607f", "Close-out"]];
  return `<div class="legend">${items.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join("")}<span><i style="background:rgba(255,204,0,.5)"></i>Cassava harvest window (6 to 8 months)</span><span><i style="background:#dfe4f7;border:1px solid #b9c2ea"></i>Planned</span><span><i style="background:#b3261e"></i>Behind schedule</span><span><i style="background:#FFCC00"></i>Today</span></div>`;
}

/** Returns an SVG string. Each stage row carries data-stage for click handling. */
export function ganttSvg(stages, { compact = false } = {}) {
  if (!stages.length) return `<div class="empty">No schedule yet. An admin can generate it under Admin > Schedule.</div>`;
  const rowH = compact ? 22 : 28, labelW = compact ? 230 : 290, chartW = 900, top = 30;
  const minD = Math.min(...stages.map((s) => D(s.planned_start))) - 4;
  const maxD = Math.max(...stages.map((s) => D(s.window_end || s.planned_end))) + 6;
  const X = (d) => labelW + ((d - minD) / (maxD - minD)) * chartW;
  const W = labelW + chartW + 40, H = top + stages.length * rowH + 10;
  const t = D(today());
  let svg = `<svg class="gantt" viewBox="0 0 ${W} ${H}" width="100%" style="min-width:${compact ? 900 : 1000}px" role="img" aria-label="Season Gantt chart">`;

  // month grid
  const first = new Date(minD * 86400000); first.setUTCDate(1);
  for (let m = new Date(first); D(m.toISOString().slice(0, 10)) <= maxD; m.setUTCMonth(m.getUTCMonth() + 1)) {
    const x = X(D(m.toISOString().slice(0, 10)));
    if (x < labelW) continue;
    svg += `<line x1="${x}" x2="${x}" y1="${top - 6}" y2="${H}" stroke="#eceef7"/><text class="mon" x="${x + 3}" y="${top - 12}">${m.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" })}</text>`;
  }
  stages.forEach((s, i) => {
    const y = top + i * rowH, bh = rowH - 9;
    const x1 = X(D(s.planned_start)), x2 = X(D(s.planned_end)), w = Math.max(x2 - x1, 5);
    const late = s.status !== "done" && D(s.planned_end) < t;
    const cls = GROUP_CLASS[s.grp] || "g-prep";
    svg += `<g data-stage="${s.id}" style="cursor:pointer"><title>${esc(s.name)}\nPlanned ${date(s.planned_start)} to ${date(s.planned_end)}\nProgress ${s.progress}%${s.tasks_total ? ` (${s.tasks_done}/${s.tasks_total} tasks)` : ""}</title>
      <line class="rowline" x1="0" x2="${W}" y1="${y + rowH}" y2="${y + rowH}"/>
      <text class="lbl" x="6" y="${y + rowH / 2 + 4}">${esc(`${s.seq}. ${s.name}`.slice(0, compact ? 36 : 44))}</text>`;
    if (s.window_end) svg += `<rect class="window" x="${x1}" y="${y + 1}" width="${X(D(s.window_end)) - x1}" height="${rowH - 3}" rx="3"/>`;
    svg += `<rect class="bar-plan" x="${x1}" y="${y + 3}" width="${w}" height="${bh}" rx="4" ${late ? 'stroke="#b3261e" stroke-width="1.6"' : ""}/>`;
    if (s.progress > 0) svg += `<rect class="${late ? "bar-late" : cls}" x="${x1}" y="${y + 3}" width="${Math.max((w * s.progress) / 100, 3)}" height="${bh}" rx="4"/>`;
    svg += `<text x="${Math.max(x2, X(D(s.window_end || s.planned_end))) + 6}" y="${y + rowH / 2 + 4}" style="fill:#5b6280;font-size:10.5px">${Math.round(s.progress)}%</text></g>`;
  });
  if (t >= minD && t <= maxD) svg += `<line class="today" x1="${X(t)}" x2="${X(t)}" y1="${top - 6}" y2="${H}"/><text x="${X(t) + 4}" y="${H - 2}" style="fill:#9a5b00;font-size:10.5px;font-weight:700">Today</text>`;
  return svg + "</svg>";
}

export async function openStage(stageId, onChange) {
  try {
    const st = ok(await sb.from("v_stage_gantt").select("*").eq("id", stageId).single());
    const tasks = ok(await sb.from("v_tasks").select("*").eq("stage_id", stageId).order("due_date"));
    const me = { id: state.user.id, role: role() };
    const m = modal({
      title: `${st.seq}. ${st.name}`, wide: true,
      body: `<p class="muted">Planned ${date(st.planned_start)} to ${date(st.planned_end)}${st.window_end ? `, harvest window to ${date(st.window_end)}` : ""}. Owner: ${esc(ROLE_LABEL[st.owner_role] || "")}. Progress ${Math.round(st.progress)}% ${badge(st.status)}</p>
        <div class="bar" style="margin:8px 0 14px"><i style="width:${st.progress}%"></i></div><div id="stage-tasks">${taskTableHtml(tasks, me, { showStage: false })}</div>
        <p class="muted small">Updating a task updates the stage progress and the Gantt automatically.</p>`,
      onMount: (back) => bindTaskControls(back, async () => { if (onChange) onChange(); }),
    });
    return m;
  } catch (e) { fail(e); }
}

export function bindGantt(root, onChange) {
  $$("[data-stage]", root).forEach((g) => g.addEventListener("click", () => openStage(g.dataset.stage, onChange)));
}

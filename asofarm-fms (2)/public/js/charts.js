import { esc } from "./ui.js";

/** Line chart as inline SVG. series: [{name, color, points:[{x:label, y:number}]}] */
export function lineChart(series, { width = 640, height = 220, zeroLine = true, refLine = null, fmt = (v) => v } = {}) {
  const pad = { l: 64, r: 12, t: 12, b: 28 };
  const all = series.flatMap((s) => s.points.map((p) => p.y)).concat(refLine ? [refLine.y] : [], zeroLine ? [0] : []);
  if (!all.length) return `<div class="empty">No data yet.</div>`;
  let min = Math.min(...all), max = Math.max(...all);
  if (min === max) { max += 1; min -= 1; }
  const labels = series[0].points.map((p) => p.x);
  const n = Math.max(labels.length - 1, 1);
  const X = (i) => pad.l + (i / n) * (width - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * (height - pad.t - pad.b);
  let g = "";
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    g += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#eceef7"/><text x="${pad.l - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="10.5" fill="#5b6280">${esc(fmt(v))}</text>`;
  }
  labels.forEach((l, i) => { if (i % Math.ceil(labels.length / 8) === 0) g += `<text x="${X(i)}" y="${height - 8}" text-anchor="middle" font-size="10.5" fill="#5b6280">${esc(l)}</text>`; });
  if (zeroLine && min < 0 && max > 0) g += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="#b3261e" stroke-dasharray="4 3"/>`;
  if (refLine) g += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${Y(refLine.y)}" y2="${Y(refLine.y)}" stroke="${refLine.color || "#d9a100"}" stroke-dasharray="6 4"/><text x="${width - pad.r}" y="${Y(refLine.y) - 4}" text-anchor="end" font-size="10.5" fill="#9a5b00">${esc(refLine.label)}</text>`;
  series.forEach((s) => {
    const d = s.points.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
    g += `<path d="${d}" fill="none" stroke="${s.color || "#283890"}" stroke-width="2.4"/>`;
    s.points.forEach((p, i) => { g += `<circle cx="${X(i)}" cy="${Y(p.y)}" r="2.6" fill="${s.color || "#283890"}"><title>${esc(p.x)}: ${esc(fmt(p.y))}</title></circle>`; });
  });
  const legend = series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>` : "";
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Line chart">${g}</svg>${legend}`;
}

export function barRows(rows, { fmt = (v) => v, max = null } = {}) {
  const m = max ?? Math.max(...rows.map((r) => Math.max(r.value, r.target || 0)), 1);
  return rows.map((r) => `<div class="row-bar"><div><div>${esc(r.label)}</div>${r.sub ? `<div class="muted small">${esc(r.sub)}</div>` : ""}</div>
    <div class="bar ${r.kind || ""}"><i style="width:${Math.min(100, (r.value / m) * 100)}%"></i></div><div class="num" style="text-align:right">${esc(fmt(r.value))}</div></div>`).join("");
}

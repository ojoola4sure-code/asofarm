export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const money = (n) => (n === null || n === undefined || n === "" || Number.isNaN(Number(n)) ? "-" : (Number(n) < 0 ? "-" : "") + "₦" + Math.abs(Number(n)).toLocaleString("en-NG", { maximumFractionDigits: 0 }));
export const money2 = (n) => (n === null || n === undefined ? "-" : (Number(n) < 0 ? "-" : "") + "₦" + Math.abs(Number(n)).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const num = (n, d = 0) => (n === null || n === undefined || n === "" ? "-" : Number(n).toLocaleString("en-NG", { maximumFractionDigits: d }));
export const pct = (n, d = 0) => (n === null || n === undefined ? "-" : Number(n).toFixed(d) + "%");
export const date = (d) => {
  if (!d) return "-";
  const x = new Date(String(d).length === 10 ? d + "T00:00:00" : d);
  return Number.isNaN(x.getTime()) ? "-" : x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
export const datetime = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");
export const today = () => new Date().toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

const KIND = {
  done: "ok", paid: "ok", ok: "ok", active: "ok", matched: "ok", received: "ok", signed: "ok", delivered: "ok", approved: "ok", closed: "ok", filed: "ok", issued: "info",
  in_progress: "info", running: "info", ordered: "info", negotiating: "info", assessed: "info", scheduled: "info", in_transit: "info", submitted: "info", part_paid: "warn",
  pending_approval: "warn", requested: "warn", attention: "warn", due: "warn", open: "warn", mitigating: "warn", draft: "", planning: "", lead: "", prospect: "", todo: "", new: "warn",
  overdue: "bad", late: "bad", blocked: "bad", rejected: "bad", unmatched: "warn", high: "bad", medium: "warn", low: "", critical: "bad", failed: "bad", void: "bad", cancelled: "bad",
};
export const badge = (text, kind) => {
  const k = kind ?? KIND[String(text).toLowerCase()] ?? "";
  return `<span class="badge ${k}">${esc(String(text ?? "").replace(/_/g, " "))}</span>`;
};

export function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.textContent = msg;
  document.getElementById("toasts").appendChild(t);
  setTimeout(() => t.remove(), kind === "bad" ? 7000 : 3500);
}
export const fail = (e) => { console.error(e); toast(e?.message || String(e), "bad"); };

export function modal({ title, body = "", footer = "", wide = false, onMount }) {
  const root = document.getElementById("modal-root");
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="x" aria-label="Close">&times;</button></div>
    <div class="modal-body">${body}</div>${footer ? `<div class="modal-foot">${footer}</div>` : ""}</div>`;
  root.appendChild(back);
  const close = () => back.remove();
  $(".x", back).onclick = close;
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
  if (onMount) onMount(back, close);
  return { el: back, close };
}

export function confirmBox(message, okText = "Confirm") {
  return new Promise((resolve) => {
    const m = modal({
      title: "Please confirm", body: `<p>${esc(message)}</p>`,
      footer: `<button class="btn alt" data-no>Cancel</button><button class="btn" data-yes>${esc(okText)}</button>`,
    });
    $("[data-no]", m.el).onclick = () => { m.close(); resolve(false); };
    $("[data-yes]", m.el).onclick = () => { m.close(); resolve(true); };
  });
}

export function promptBox(title, label, { value = "", type = "text", okText = "Save" } = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title, body: `<div class="field"><label>${esc(label)}</label><input id="pb" type="${type}" value="${esc(value)}"></div>`,
      footer: `<button class="btn alt" data-no>Cancel</button><button class="btn" data-yes>${esc(okText)}</button>`,
    });
    $("[data-no]", m.el).onclick = () => { m.close(); resolve(null); };
    $("[data-yes]", m.el).onclick = () => { const v = $("#pb", m.el).value; m.close(); resolve(v); };
    $("#pb", m.el).focus();
  });
}

export function csvDownload(rows, columns, filename) {
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [columns.map((c) => cell(c.label)).join(",")];
  rows.forEach((r) => lines.push(columns.map((c) => cell(c.csv ? c.csv(r) : (c.get ? c.get(r) : r[c.key]))).join(",")));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Tiny Markdown renderer for reports: headings, bold, lists, paragraphs. */
export function md(src) {
  const lines = String(src ?? "").split("\n");
  let html = "", inList = false;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^\s*[-*]\s+/.test(l)) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inline(l.replace(/^\s*[-*]\s+/, ""))}</li>`; continue; }
    if (inList) { html += "</ul>"; inList = false; }
    if (/^###\s/.test(l)) html += `<h3>${inline(l.slice(4))}</h3>`;
    else if (/^##\s/.test(l)) html += `<h2>${inline(l.slice(3))}</h2>`;
    else if (/^#\s/.test(l)) html += `<h2>${inline(l.slice(2))}</h2>`;
    else if (l.trim()) html += `<p>${inline(l)}</p>`;
  }
  if (inList) html += "</ul>";
  return `<div class="md">${html}</div>`;
}

export const statusBar = (value, total, { invert = false } = {}) => {
  const p = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  let k = "";
  if (!invert) k = p >= 100 ? "bad" : p >= 90 ? "warn" : "ok"; else k = p >= 100 ? "ok" : p >= 50 ? "warn" : "bad";
  return `<div class="bar ${k}"><i style="width:${p}%"></i></div>`;
};

export function pageHead(title, subtitle = "", actionsHtml = "") {
  return `<div class="page-head"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><div class="spacer"></div>${actionsHtml}</div>`;
}

export function table(cols, rows, { total = false, empty = "Nothing here yet." } = {}) {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  const head = cols.map((c) => `<th class="${c.num ? "num" : ""}">${esc(c.label)}</th>`).join("");
  const body = rows.map((r, i) => `<tr class="${total && i === rows.length - 1 ? "total" : ""}">${cols.map((c) => `<td class="${c.num ? "num" : ""}">${c.html ? c.html(r) : esc(c.get ? c.get(r) : r[c.key])}</td>`).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export const debounce = (f, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
export const loadingHtml = `<div class="empty">Loading…</div>`;

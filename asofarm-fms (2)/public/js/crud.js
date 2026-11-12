import { sb, ok, state, can, role, upload, openFile } from "./supa.js";

// roles must be listed explicitly; undefined or [] means only an admin
const allowed = (roles) => role() === "admin" || (Array.isArray(roles) && roles.includes(role()));
import { esc, money, date, datetime, badge, modal, toast, fail, $, $$, csvDownload, pct, num, pageHead, confirmBox } from "./ui.js";

const cache = new Map();
export const clearRefCache = () => cache.clear();

export async function refOptions(ref) {
  const key = JSON.stringify(ref);
  if (!cache.has(key)) {
    const val = ref.value || "id", lab = ref.label || "name";
    let q = sb.from(ref.table).select(`${val},${lab}`).order(lab);
    for (const [k, v] of Object.entries(ref.eq || {})) q = q.eq(k, v);
    const rows = ok(await q);
    cache.set(key, rows.map((r) => ({ value: r[val], label: r[lab] })));
  }
  return cache.get(key);
}

const NUMERIC = new Set(["money", "num", "pct"]);

function renderCell(c, r) {
  const v = c.get ? c.get(r) : r[c.key];
  if (c.render) return c.render(r, v);
  switch (c.type) {
    case "money": return money(v);
    case "date": return date(v);
    case "datetime": return datetime(v);
    case "badge": return v == null ? "" : badge(v);
    case "pct": return pct(v);
    case "num": return num(v, c.dec || 0);
    case "bool": return v ? "Yes" : "";
    case "tags": return esc((v || []).join(", "));
    case "file": return v ? `<button class="btn sm alt" data-file="${esc(v)}">Open</button>` : "";
    default: return esc(v ?? "");
  }
}

async function fieldHtml(f, v) {
  const id = "f_" + f.key;
  const req = f.required ? "required" : "";
  const ro = f.readonly ? "disabled" : "";
  let input = "";
  const val = v ?? (typeof f.default === "function" ? f.default() : f.default) ?? "";
  switch (f.type) {
    case "textarea": input = `<textarea id="${id}" name="${f.key}" ${req} ${ro}>${esc(val)}</textarea>`; break;
    case "checkbox": input = `<input id="${id}" name="${f.key}" type="checkbox" ${v ?? f.default ? "checked" : ""} ${ro}>`; break;
    case "select": {
      const opts = (f.options || []).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
      input = `<select id="${id}" name="${f.key}" ${req} ${ro}>${f.required ? "" : '<option value=""></option>'}${opts.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(val) ? "selected" : ""}>${esc(String(o.label).replace(/_/g, " "))}</option>`).join("")}</select>`;
      break;
    }
    case "ref": {
      const opts = f.options || (await refOptions(f.ref));
      input = `<select id="${id}" name="${f.key}" ${req} ${ro}>${f.required ? "" : '<option value=""></option>'}${opts.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(val) ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
      break;
    }
    case "tags": input = `<input id="${id}" name="${f.key}" type="text" value="${esc((Array.isArray(v) ? v : []).join(", "))}" placeholder="comma separated" ${ro}>`; break;
    case "file": input = `<input id="${id}" name="${f.key}__file" type="file" ${f.accept ? `accept="${f.accept}"` : 'accept="image/*,application/pdf"'} ${f.capture ? 'capture="environment"' : ""}>${v ? `<span class="help">Current file attached. Choose another to replace it.</span>` : ""}`; break;
    default: input = `<input id="${id}" name="${f.key}" type="${f.type || "text"}" value="${esc(val)}" ${f.step ? `step="${f.step}"` : f.type === "number" ? 'step="any"' : ""} ${f.min !== undefined ? `min="${f.min}"` : ""} ${req} ${ro}>`;
  }
  const check = f.type === "checkbox";
  return `<div class="field ${f.full || f.type === "textarea" ? "full" : ""} ${check ? "check" : ""}"><label for="${id}">${esc(f.label)}${f.required ? " *" : ""}</label>${input}${f.help ? `<span class="help">${esc(f.help)}</span>` : ""}</div>`;
}

async function collect(form, fields, existing) {
  const out = {};
  for (const f of fields) {
    if (f.readonly) continue;
    if (f.type === "file") {
      const file = form.elements[f.key + "__file"]?.files[0];
      if (file) out[f.key] = await upload(f.bucket || "field-photos", file, f.folder || "misc");
      continue;
    }
    const el = form.elements[f.key];
    if (!el) continue;
    let v;
    switch (f.type) {
      case "number": v = el.value === "" ? null : Number(el.value); break;
      case "checkbox": v = el.checked; break;
      case "tags": v = el.value.split(",").map((s) => s.trim()).filter(Boolean); break;
      default: v = el.value === "" ? null : el.value;
    }
    out[f.key] = v;
  }
  return out;
}

/** Generic list + form page for one table. */
export function crudPage(cfg) {
  return async function render(el) {
    const canCreate = allowed(cfg.create), canEdit = allowed(cfg.edit), canDelete = allowed(cfg.remove);
    let rows = [], q = "", filterVal = "";

    async function load() {
      let query = sb.from(cfg.source || cfg.table).select(cfg.select || "*");
      for (const [k, v] of Object.entries(cfg.eq || {})) query = query.eq(k, v);
      for (const [col, asc] of cfg.order || [["created_at", false]]) query = query.order(col, { ascending: asc });
      rows = ok(await query.limit(cfg.limit || 500));
      draw();
    }

    function visible() {
      let r = rows;
      if (filterVal && cfg.filter) r = r.filter((x) => String(x[cfg.filter.key]) === filterVal);
      if (!q) return r;
      const needle = q.toLowerCase();
      return r.filter((x) => cfg.columns.some((c) => String(c.get ? c.get(x) : x[c.key] ?? "").toLowerCase().includes(needle)));
    }

    function draw() {
      const list = visible();
      const cols = cfg.columns;
      const hasActions = (cfg.actions || []).some((a) => allowed(a.roles));
      el.innerHTML = `<div class="page">${pageHead(cfg.title, cfg.subtitle || "", (cfg.headerHtml || "") + (canCreate ? `<button class="btn" data-new>+ ${esc(cfg.newLabel || "New")}</button>` : ""))}
        ${cfg.intro ? `<div class="alert info">${cfg.intro}</div>` : ""}
        <div class="card flush"><div class="toolbar"><input type="search" placeholder="Search…" value="${esc(q)}" data-q>
          ${cfg.filter ? `<select data-filter><option value="">All ${esc(cfg.filter.label)}</option>${cfg.filter.options.map((o) => `<option ${o === filterVal ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>` : ""}
          <span class="spacer"></span><span class="muted small">${list.length} of ${rows.length}</span>
          <button class="btn sm alt" data-csv>Export CSV</button></div>
        ${list.length ? `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th class="${NUMERIC.has(c.type) ? "num" : ""}">${esc(c.label)}</th>`).join("")}${hasActions ? "<th></th>" : ""}</tr></thead>
        <tbody>${list.map((r, i) => `<tr class="${canEdit || cfg.view ? "click" : ""}" data-i="${i}">${cols.map((c) => `<td class="${NUMERIC.has(c.type) ? "num" : ""}">${renderCell(c, r)}</td>`).join("")}
          ${hasActions ? `<td style="white-space:nowrap">${(cfg.actions || []).filter((a) => allowed(a.roles) && (!a.show || a.show(r))).map((a, k) => `<button class="btn sm ${a.kind || "alt"}" data-act="${(cfg.actions || []).indexOf(a)}" data-i="${i}">${esc(a.label)}</button>`).join(" ")}</td>` : ""}</tr>`).join("")}</tbody></table></div>` : `<div class="empty">${esc(cfg.empty || "Nothing here yet.")}</div>`}</div></div>`;

      $("[data-q]", el).oninput = (e) => { q = e.target.value; const pos = e.target.selectionStart; draw(); const n = $("[data-q]", el); n.focus(); n.setSelectionRange(pos, pos); };
      const fsel = $("[data-filter]", el); if (fsel) fsel.onchange = (e) => { filterVal = e.target.value; draw(); };
      $("[data-csv]", el).onclick = () => csvDownload(list, cols, `${cfg.table || cfg.source}.csv`);
      const nb = $("[data-new]", el); if (nb) nb.onclick = () => openForm(null);
      $$("tbody tr", el).forEach((tr) => tr.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        const r = list[Number(tr.dataset.i)];
        if (canEdit || cfg.view) openForm(r);
      }));
      $$("[data-act]", el).forEach((b) => b.addEventListener("click", async (e) => {
        e.stopPropagation();
        const a = cfg.actions[Number(b.dataset.act)];
        try { await a.run(list[Number(b.dataset.i)], load); } catch (err) { fail(err); }
      }));
      $$("[data-file]", el).forEach((b) => b.addEventListener("click", async (e) => { e.stopPropagation(); try { await openFile(cfg.fileBucket || "field-photos", b.dataset.file); } catch (err) { fail(err); } }));
    }

    async function openForm(row) {
      const readOnly = row && !canEdit;
      const fields = (cfg.fieldsFor ? cfg.fieldsFor(row) : cfg.fields).filter((f) => !(row ? f.createOnly : f.editOnly));
      const html = (await Promise.all(fields.map((f) => fieldHtml(readOnly ? { ...f, readonly: true } : f, row ? row[f.key] : undefined)))).join("");
      const m = modal({
        title: row ? (cfg.editTitle || "Edit") : (cfg.newLabel || "New"),
        body: `<form class="form" id="crud-form">${html}</form>${cfg.formNote ? `<p class="muted small">${esc(cfg.formNote)}</p>` : ""}`,
        footer: `${row && canDelete ? `<button class="btn danger" data-del>Delete</button>` : ""}<span class="spacer"></span><button class="btn alt" data-cancel>Close</button>${readOnly ? "" : `<button class="btn" data-save>Save</button>`}`,
        wide: cfg.wide,
        onMount: (back, close) => {
          $("[data-cancel]", back).onclick = close;
          const del = $("[data-del]", back);
          if (del) del.onclick = async () => {
            if (!(await confirmBox("Delete this record? This cannot be undone."))) return;
            try { ok(await sb.from(cfg.table).delete().eq("id", row.id)); toast("Deleted", "ok"); close(); load(); } catch (e) { fail(e); }
          };
          const save = $("[data-save]", back);
          if (save) save.onclick = async () => {
            const form = $("#crud-form", back);
            if (!form.reportValidity()) return;
            save.disabled = true;
            try {
              let values = await collect(form, fields, row);
              if (cfg.beforeSave) values = (await cfg.beforeSave(values, row)) || values;
              if (row) ok(await sb.from(cfg.table).update(values).eq("id", row.id));
              else ok(await sb.from(cfg.table).insert({ ...(cfg.defaults ? cfg.defaults() : {}), ...values }));
              toast("Saved", "ok"); close(); clearRefCache(); load();
            } catch (e) { fail(e); save.disabled = false; }
          };
        },
      });
      return m;
    }

    el.innerHTML = `<div class="page"><div class="empty">Loading…</div></div>`;
    try { await load(); } catch (e) { el.innerHTML = `<div class="page"><div class="alert bad">${esc(e.message)}</div></div>`; }
  };
}

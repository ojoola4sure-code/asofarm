import { sb, ok, rpc, state, role, can, ROLE_LABEL, currentSeason } from "../supa.js";
import { reg } from "../router.js";
import { esc, money, date, num, pct, badge, modal, toast, fail, pageHead, today, $, $$, confirmBox, daysBetween } from "../ui.js";
import { crudPage } from "../crud.js";
import { ganttSvg, ganttLegend, bindGantt, openStage } from "../gantt.js";
import { taskTableHtml, bindTaskControls } from "../tasklib.js";

const OPS = ["ops_manager", "supervisor"];
const rerender = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
const ROLES = Object.keys(ROLE_LABEL).map((k) => ({ value: k, label: ROLE_LABEL[k] }));

// ------------------------------------------------------------ Gantt (full)
reg("gantt", {
  title: "Gantt schedule", group: "Overview", label: "Gantt schedule",
  async render(el, { params }) {
    const s = await currentSeason();
    const stages = ok(await sb.from("v_stage_gantt").select("*").eq("season_id", s.id).order("seq"));
    const crop = params.crop || "";
    const shown = crop ? stages.filter((x) => x.crop === crop || x.crop === "general") : stages;
    el.innerHTML = `<div class="page">${pageHead("Season Gantt chart", "Every stage from land preparation to post-harvest. Click a stage to see and update its tasks.",
      `<select class="mini" id="crop"><option value="">All crops</option><option value="cassava" ${crop === "cassava" ? "selected" : ""}>Cassava only</option><option value="maize1" ${crop === "maize1" ? "selected" : ""}>Maize cycle 1</option><option value="maize2" ${crop === "maize2" ? "selected" : ""}>Maize cycle 2</option></select>`)}
      <div class="card flush"><div class="gantt-wrap">${ganttSvg(shown)}</div>${ganttLegend()}</div>
      <div class="card flush" style="margin-top:16px"><div class="card-head"><h3>Stage list</h3></div><div class="table-wrap"><table><thead><tr><th>#</th><th>Stage</th><th>Owner</th><th>Planned</th><th>Actual</th><th>Tasks</th><th>Progress</th><th>Status</th></tr></thead><tbody>
      ${shown.map((x) => `<tr class="click" data-open="${x.id}"><td>${x.seq}</td><td>${esc(x.name)}</td><td class="small">${esc(ROLE_LABEL[x.owner_role] || "")}</td><td class="small">${date(x.planned_start)} to ${date(x.planned_end)}</td><td class="small">${x.actual_start ? date(x.actual_start) : "-"}${x.actual_end ? " to " + date(x.actual_end) : ""}</td><td>${x.tasks_done}/${x.tasks_total}${x.tasks_overdue ? ` <span class="badge bad">${x.tasks_overdue} late</span>` : ""}</td><td style="min-width:120px"><div class="bar"><i style="width:${x.progress}%"></i></div></td><td>${badge(x.status)}</td></tr>`).join("")}</tbody></table></div></div></div>`;
    $("#crop").onchange = (e) => { location.hash = "#/gantt" + (e.target.value ? "?crop=" + e.target.value : ""); };
    bindGantt(el, rerender);
    $$("[data-open]", el).forEach((r) => r.addEventListener("click", () => openStage(r.dataset.open, rerender)));
  },
});

// ------------------------------------------------------------ Tasks
reg("tasks", {
  title: "Tasks", group: "Overview", label: "Tasks",
  async render(el, { params }) {
    const s = await currentSeason();
    const me = { id: state.user.id, role: role() };
    const mine = params.mine ?? (can(["ops_manager"]) ? "0" : "1"), status = params.status || "open";
    let q = sb.from("v_tasks").select("*").eq("season_id", s.id).order("due_date").limit(400);
    if (mine === "1") q = q.eq("assignee_role", role());
    if (status === "open") q = q.neq("status", "done"); else if (status !== "all") q = q.eq("status", status);
    const tasks = ok(await q);
    el.innerHTML = `<div class="page">${pageHead("Tasks", "Assigned by role from the season schedule. Update progress here or from the Gantt.",
      `${can(OPS) ? `<button class="btn" id="newtask">+ New task</button>` : ""}`)}
      <div class="card flush"><div class="toolbar"><select id="f-mine"><option value="0" ${mine === "0" ? "selected" : ""}>All roles</option><option value="1" ${mine === "1" ? "selected" : ""}>My role only</option></select>
      <select id="f-status">${["open", "all", "todo", "in_progress", "blocked", "done"].map((x) => `<option value="${x}" ${status === x ? "selected" : ""}>${x.replace("_", " ")}</option>`).join("")}</select><span class="spacer"></span><span class="muted small">${tasks.length} tasks</span></div>
      <div id="tl">${taskTableHtml(tasks, me)}</div></div></div>`;
    const nav = () => { location.hash = `#/tasks?mine=${$("#f-mine").value}&status=${$("#f-status").value}`; };
    $("#f-mine").onchange = nav; $("#f-status").onchange = nav;
    bindTaskControls(el, rerender);
    const nb = $("#newtask");
    if (nb) nb.onclick = async () => {
      const stages = ok(await sb.from("stages").select("id,seq,name").eq("season_id", s.id).order("seq"));
      const m = modal({
        title: "New task", body: `<form class="form" id="tf"><div class="field full"><label>Task *</label><input name="title" required></div>
        <div class="field"><label>Stage</label><select name="stage_id"><option value=""></option>${stages.map((x) => `<option value="${x.id}">${x.seq}. ${esc(x.name)}</option>`).join("")}</select></div>
        <div class="field"><label>For role *</label><select name="assignee_role" required>${ROLES.map((r) => `<option value="${r.value}">${esc(r.label)}</option>`).join("")}</select></div>
        <div class="field"><label>Due date *</label><input type="date" name="due_date" required value="${today()}"></div>
        <div class="field"><label>Priority</label><select name="priority">${["low", "normal", "high", "critical"].map((p) => `<option ${p === "normal" ? "selected" : ""}>${p}</option>`).join("")}</select></div>
        <div class="field full"><label>Notes</label><textarea name="description"></textarea></div></form>`,
        footer: `<button class="btn alt" data-c>Cancel</button><button class="btn" data-s>Create</button>`,
        onMount: (b, close) => {
          $("[data-c]", b).onclick = close;
          $("[data-s]", b).onclick = async () => {
            const f = $("#tf", b); if (!f.reportValidity()) return;
            const v = Object.fromEntries(new FormData(f)); Object.keys(v).forEach((k) => v[k] === "" && (v[k] = null));
            try { ok(await sb.from("tasks").insert({ ...v, season_id: s.id, start_date: today() })); toast("Task created", "ok"); close(); rerender(); } catch (e) { fail(e); }
          };
        },
      });
    };
  },
});

reg("my-day", {
  title: "My day", group: "Overview", label: "My day", roles: OPS,
  async render(el) {
    const s = await currentSeason();
    const me = { id: state.user.id, role: role() };
    const plus2 = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    let q = sb.from("v_tasks").select("*").eq("season_id", s.id).neq("status", "done").lte("due_date", plus2).order("due_date").limit(60);
    if (role() === "supervisor") q = q.eq("assignee_role", "supervisor");
    const [tasks, checks, logs] = await Promise.all([q.then(ok),
      sb.from("compliance_checks").select("*").in("status", ["overdue", "attention"]).limit(8).then(ok),
      sb.from("field_logs").select("id").eq("log_date", today()).eq("created_by", state.user.id).then(ok)]);
    el.innerHTML = `<div class="page">${pageHead("My day", date(today()))}
      <div class="grid g3" style="margin-bottom:16px"><a class="card" href="#/field-logs" style="text-decoration:none"><h3>Field log</h3><p class="muted">${logs.length ? `${logs.length} entries today` : "Nothing logged yet today"}. Tap to record work, labour and a photo.</p></a>
      <a class="card" href="#/attendance" style="text-decoration:none"><h3>Attendance</h3><p class="muted">Mark who worked today.</p></a>
      <a class="card" href="#/expenses" style="text-decoration:none"><h3>Request money</h3><p class="muted">Raise an expense against a budget line. Small ones inside budget are approved automatically.</p></a></div>
      <div class="card flush"><div class="card-head"><h3>Due today, tomorrow or late</h3></div>${taskTableHtml(tasks, me)}</div>
      <div class="card flush" style="margin-top:16px"><div class="card-head"><h3>Safety and compliance checks needing attention</h3><a class="btn sm alt" href="#/compliance">Open</a></div>
      ${checks.length ? `<div class="table-wrap"><table><tbody>${checks.map((c) => `<tr><td>${badge(c.status)}</td><td>${esc(c.item)}</td><td class="muted small">${esc(c.area)} · ${esc(c.frequency)}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">All checks are up to date.</div>'}</div></div>`;
    bindTaskControls(el, rerender);
  },
});

// ------------------------------------------------------------ Field logs
const ACTIVITIES = ["Land preparation", "Planting", "Gap filling", "Weeding", "Herbicide spraying", "Fertiliser application", "Scouting", "Irrigation", "Harvest", "Shelling and drying", "Transport", "Maintenance", "Other"];
reg("field-logs", {
  title: "Field logs", group: "Field operations", label: "Field logs", roles: ["ops_manager", "supervisor", "research"],
  render: crudPage({
    title: "Field logs", subtitle: "Daily record of work done, labour and photos.", table: "field_logs", select: "*, blocks(name), stages(name)", order: [["log_date", false]],
    create: OPS, edit: OPS, remove: ["ops_manager"], newLabel: "Log activity", fileBucket: "field-photos",
    columns: [{ key: "log_date", label: "Date", type: "date" }, { key: "activity", label: "Activity" }, { label: "Block", get: (r) => r.blocks?.name || "" }, { label: "Stage", get: (r) => r.stages?.name || "" },
      { key: "labour_count", label: "Workers", type: "num" }, { key: "hours", label: "Hours", type: "num" }, { key: "labour_cost", label: "Labour cost", type: "money" }, { key: "notes", label: "Notes" }, { key: "photo_path", label: "Photo", type: "file" }],
    fields: [{ key: "log_date", label: "Date", type: "date", required: true, default: today }, { key: "activity", label: "Activity", type: "select", options: ACTIVITIES, required: true },
      { key: "block_id", label: "Block", type: "ref", ref: { table: "blocks" } }, { key: "stage_id", label: "Stage", type: "ref", ref: { table: "stages", label: "name" } },
      { key: "labour_count", label: "Workers", type: "number" }, { key: "hours", label: "Hours worked", type: "number" }, { key: "labour_cost", label: "Labour cost (₦)", type: "number" },
      { key: "photo_path", label: "Photo", type: "file", bucket: "field-photos", folder: "field-logs", capture: true }, { key: "notes", label: "Notes", type: "textarea" }],
    defaults: () => ({ season_id: state.season?.id }),
  }),
});

// ------------------------------------------------------------ Attendance
reg("attendance", {
  title: "Attendance", group: "Field operations", label: "Attendance", roles: ["ops_manager", "supervisor", "accountant"],
  async render(el, { params }) {
    const day = params.date || today();
    const [people, blocks, existing, recent] = await Promise.all([
      sb.from("v_employee_directory").select("*").eq("active", true).order("full_name").then(ok),
      sb.from("blocks").select("id,name").order("name").then(ok),
      sb.from("attendance").select("*").eq("work_date", day).then(ok),
      sb.from("attendance").select("work_date,employee_id,days,rate").gte("work_date", new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)).order("work_date", { ascending: false }).limit(200).then(ok),
    ]);
    const byEmp = Object.fromEntries(existing.map((a) => [a.employee_id, a]));
    const names = Object.fromEntries(people.map((p) => [p.id, p.full_name]));
    const editable = can(OPS);
    el.innerHTML = `<div class="page">${pageHead("Attendance", "Mark each worker for the day. Totals help you check weekly labour payments.", editable ? `<button class="btn alt" id="addw">+ Add casual worker</button>` : "")}
      <div class="card flush"><div class="toolbar"><label>Date <input type="date" id="d" value="${day}"></label><span class="spacer"></span>${editable ? `<button class="btn" id="save">Save attendance</button>` : ""}</div>
      ${people.length ? `<div class="table-wrap"><table><thead><tr><th>Worker</th><th>Type</th><th>Day worked</th><th>Block</th></tr></thead><tbody>${people.map((p) => `<tr data-emp="${p.id}"><td>${esc(p.full_name)}<div class="muted small">${esc(p.role_title || "")}</div></td><td>${badge(p.kind)}</td>
        <td><select class="mini" data-days ${editable ? "" : "disabled"}>${[["0", "Absent"], ["0.5", "Half day"], ["1", "Full day"]].map(([v, l]) => `<option value="${v}" ${String(byEmp[p.id]?.days ?? 0) === v ? "selected" : ""}>${l}</option>`).join("")}</select></td>
        <td><select class="mini" data-block ${editable ? "" : "disabled"}><option value=""></option>${blocks.map((b) => `<option value="${b.id}" ${byEmp[p.id]?.block_id === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No workers yet. Add casual workers to start marking attendance.</div>`}</div>
      <div class="card flush" style="margin-top:16px"><div class="card-head"><h3>Last 14 days</h3></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Worker</th><th>Days</th></tr></thead><tbody>${recent.map((a) => `<tr><td>${date(a.work_date)}</td><td>${esc(names[a.employee_id] || "")}</td><td>${a.days}</td></tr>`).join("") || '<tr><td colspan="3" class="muted">No records.</td></tr>'}</tbody></table></div></div></div>`;
    $("#d").onchange = (e) => { location.hash = `#/attendance?date=${e.target.value}`; };
    const sv = $("#save");
    if (sv) sv.onclick = async () => {
      try {
        for (const tr of $$("[data-emp]", el)) {
          const id = tr.dataset.emp, days = Number($("[data-days]", tr).value), block = $("[data-block]", tr).value || null;
          if (days > 0) ok(await sb.from("attendance").upsert({ employee_id: id, work_date: day, days, block_id: block, recorded_by: state.user.id }, { onConflict: "employee_id,work_date" }));
          else if (byEmp[id]) ok(await sb.from("attendance").delete().eq("id", byEmp[id].id));
        }
        toast("Attendance saved", "ok"); rerender();
      } catch (e) { fail(e); }
    };
    const aw = $("#addw");
    if (aw) aw.onclick = () => {
      const m = modal({
        title: "Add casual worker", body: `<form class="form" id="wf"><div class="field"><label>Full name *</label><input name="full_name" required></div><div class="field"><label>Phone</label><input name="phone"></div>
        <div class="field"><label>Daily rate (₦)</label><input type="number" name="daily_rate" value="4000"></div><div class="field"><label>Role or trade</label><input name="role_title" placeholder="Weeder, planter…"></div></form>`,
        footer: `<button class="btn alt" data-c>Cancel</button><button class="btn" data-s>Add</button>`,
        onMount: (b, close) => {
          $("[data-c]", b).onclick = close;
          $("[data-s]", b).onclick = async () => {
            const f = $("#wf", b); if (!f.reportValidity()) return;
            const v = Object.fromEntries(new FormData(f)); v.daily_rate = Number(v.daily_rate || 0); v.kind = "casual";
            try { ok(await sb.from("employees").insert(v)); toast("Worker added", "ok"); close(); rerender(); } catch (e) { fail(e); }
          };
        },
      });
    };
  },
});

// ------------------------------------------------------------ Procurement
reg("procurement", {
  title: "Procurement", group: "Field operations", label: "Procurement", roles: ["ops_manager", "supervisor", "accountant"],
  render: crudPage({
    title: "Procurement requests", subtitle: "Seeds, stems, fertiliser, equipment. Approved requests create an expense approval automatically; receiving updates stock.",
    table: "procurement_orders", select: "*, suppliers(name), stages(name)", order: [["created_at", false]], create: OPS, edit: ["ops_manager"], remove: ["ops_manager"], newLabel: "New request",
    columns: [{ key: "description", label: "Item" }, { key: "qty", label: "Qty", type: "num", dec: 1 }, { key: "unit", label: "Unit" }, { key: "total", label: "Total", type: "money" }, { label: "Supplier", get: (r) => r.suppliers?.name || "" },
      { label: "Stage", get: (r) => r.stages?.name || "" }, { key: "needed_by", label: "Needed by", type: "date" }, { key: "status", label: "Status", type: "badge" }],
    fields: [{ key: "description", label: "What is needed", required: true, full: true }, { key: "item_id", label: "Stock item", type: "ref", ref: { table: "inventory_items" }, help: "Pick one so receiving updates stock" },
      { key: "qty", label: "Quantity", type: "number", required: true, default: 1 }, { key: "unit", label: "Unit" }, { key: "unit_cost", label: "Unit cost (₦)", type: "number", required: true },
      { key: "supplier_id", label: "Supplier", type: "ref", ref: { table: "suppliers" } }, { key: "budget_line_id", label: "Budget line", type: "ref", ref: { table: "v_budget_vs_actual", label: "description" }, help: "Sets the category and stage for the expense" },
      { key: "needed_by", label: "Needed by", type: "date" }, { key: "notes", label: "Notes", type: "textarea" }],
    defaults: () => ({ requested_by: state.user.id, season_id: state.season?.id }),
    async beforeSave(v) {
      if (v.budget_line_id) { const bl = ok(await sb.from("budget_lines").select("category_id,stage_id").eq("id", v.budget_line_id).single()); v.category_id = bl.category_id; v.stage_id = bl.stage_id; }
      return v;
    },
    actions: [
      { label: "Approve", roles: ["ops_manager"], kind: "good", show: (r) => r.status === "requested", run: async (r, reload) => { ok(await sb.from("procurement_orders").update({ status: "approved" }).eq("id", r.id)); toast("Approved. An expense request was created.", "ok"); reload(); } },
      { label: "Ordered", roles: ["ops_manager"], show: (r) => r.status === "approved", run: async (r, reload) => { ok(await sb.from("procurement_orders").update({ status: "ordered" }).eq("id", r.id)); reload(); } },
      { label: "Received", roles: ["ops_manager", "supervisor"], show: (r) => ["approved", "ordered"].includes(r.status) && can(["ops_manager"]), run: async (r, reload) => { ok(await sb.from("procurement_orders").update({ status: "received" }).eq("id", r.id)); toast("Marked received" + (r.item_id ? " and stock updated" : ""), "ok"); reload(); } },
    ],
  }),
});

// ------------------------------------------------------------ Inventory
reg("inventory", {
  title: "Inventory", group: "Field operations", label: "Inventory", roles: ["ops_manager", "supervisor", "accountant"],
  render: crudPage({
    title: "Inventory", subtitle: "Stock of seed, stems, fertiliser, chemicals and fuel. Low stock raises an alert.", table: "inventory_items", source: "v_inventory", order: [["name", true]],
    create: ["ops_manager"], edit: ["ops_manager"], remove: ["ops_manager"], newLabel: "New item",
    columns: [{ key: "name", label: "Item" }, { key: "category", label: "Category" }, { key: "qty_on_hand", label: "On hand", type: "num", dec: 1 }, { key: "unit", label: "Unit" }, { key: "reorder_level", label: "Reorder at", type: "num", dec: 1 },
      { label: "Status", render: (r) => (r.low ? badge("low stock", "bad") : badge("ok", "ok")) }],
    fields: [{ key: "name", label: "Item", required: true }, { key: "category", label: "Category" }, { key: "unit", label: "Unit", required: true, default: "unit" }, { key: "reorder_level", label: "Reorder level", type: "number", default: 0 }, { key: "unit_cost", label: "Typical unit cost (₦)", type: "number", default: 0 }],
    actions: [{
      label: "Stock in/out", roles: ["ops_manager", "supervisor"], run: (r, reload) => new Promise((resolve) => {
        const m = modal({
          title: `Stock movement: ${r.name}`, body: `<form class="form" id="sf"><div class="field"><label>Quantity (use minus for issues) *</label><input type="number" step="any" name="qty" required></div><div class="field"><label>Date</label><input type="date" name="move_date" value="${today()}"></div><div class="field full"><label>Reason</label><input name="reason" placeholder="Received, applied to Block A, spoiled…"></div></form>`,
          footer: `<button class="btn alt" data-c>Cancel</button><button class="btn" data-s>Record</button>`,
          onMount: (b, close) => {
            $("[data-c]", b).onclick = close;
            $("[data-s]", b).onclick = async () => {
              const f = $("#sf", b); if (!f.reportValidity()) return;
              const v = Object.fromEntries(new FormData(f)); v.qty = Number(v.qty);
              try { ok(await sb.from("stock_moves").insert({ ...v, item_id: r.id })); toast("Recorded", "ok"); close(); reload(); resolve(); } catch (e) { fail(e); }
            };
          },
        });
      }),
    }],
  }),
});

reg("suppliers", {
  title: "Suppliers", group: "Field operations", label: "Suppliers", roles: ["ops_manager", "supervisor", "accountant"],
  render: crudPage({
    title: "Suppliers and service providers", table: "suppliers", order: [["name", true]], create: ["ops_manager"], edit: ["ops_manager"], remove: ["ops_manager"], newLabel: "New supplier",
    columns: [{ key: "name", label: "Name" }, { key: "category", label: "Category" }, { key: "contact", label: "Contact" }, { key: "phone", label: "Phone" }, { key: "location", label: "Location" }, { key: "rating", label: "Rating", type: "num" }, { key: "active", label: "Active", type: "bool" }],
    fields: [{ key: "name", label: "Name", required: true }, { key: "category", label: "Category", type: "select", options: ["stems", "fertiliser", "agrochemicals", "seed", "tractor hire", "labour contractor", "transport", "equipment", "other"] }, { key: "contact", label: "Contact person" }, { key: "phone", label: "Phone" },
      { key: "email", label: "Email", type: "email" }, { key: "location", label: "Location" }, { key: "rating", label: "Rating (1 to 5)", type: "number", min: 1 }, { key: "active", label: "Active", type: "checkbox", default: true }, { key: "notes", label: "Notes", type: "textarea" }],
  }),
});

reg("sops", {
  title: "SOPs", group: "Field operations", label: "SOPs",
  render: crudPage({
    title: "Standard operating procedures", subtitle: "Step-by-step practice for each stage. Open one to read it.", table: "sops", order: [["stage_seq", true]], create: ["ops_manager"], edit: ["ops_manager"], remove: ["ops_manager"], view: true, newLabel: "New SOP", wide: true,
    columns: [{ key: "title", label: "Procedure" }, { key: "stage_seq", label: "Stage #", type: "num" }, { key: "version", label: "Version" }, { key: "updated_at", label: "Updated", type: "date" }],
    fields: [{ key: "title", label: "Title", required: true, full: true }, { key: "stage_seq", label: "Stage number", type: "number" }, { key: "version", label: "Version", default: "1.0" }, { key: "owner_role", label: "Owner", type: "select", options: ROLES }, { key: "body", label: "Steps", type: "textarea", required: true }],
    beforeSave: (v) => ({ ...v, updated_at: new Date().toISOString() }),
  }),
});

reg("risks", {
  title: "Risk register", group: "Field operations", label: "Risks",
  render: crudPage({
    title: "Risk register", subtitle: "Score is likelihood times impact (1 to 25). Scores of 15 or more count as high.", table: "risks", order: [["score", false]], create: OPS, edit: OPS, remove: ["ops_manager"], newLabel: "Add risk",
    filter: { key: "status", label: "statuses", options: ["open", "mitigating", "closed"] },
    columns: [{ key: "title", label: "Risk" }, { key: "category", label: "Category" }, { key: "likelihood", label: "L", type: "num" }, { key: "impact", label: "I", type: "num" }, { label: "Score", render: (r) => badge(r.score, r.score >= 15 ? "bad" : r.score >= 8 ? "warn" : "") }, { key: "mitigation", label: "Mitigation" }, { key: "owner_role", label: "Owner" }, { key: "status", label: "Status", type: "badge" }],
    fields: [{ key: "title", label: "Risk", required: true, full: true }, { key: "category", label: "Category", type: "select", options: ["market", "production", "finance", "labour", "security", "legal", "weather", "other"] }, { key: "owner_role", label: "Owner", type: "select", options: ROLES },
      { key: "likelihood", label: "Likelihood (1 to 5)", type: "number", min: 1, default: 3, required: true }, { key: "impact", label: "Impact (1 to 5)", type: "number", min: 1, default: 3, required: true }, { key: "status", label: "Status", type: "select", options: ["open", "mitigating", "closed"], default: "open", required: true }, { key: "mitigation", label: "Mitigation", type: "textarea" }],
    defaults: () => ({ season_id: state.season?.id }),
  }),
});

reg("incidents", {
  title: "Incidents", group: "Field operations", label: "Incidents",
  render: crudPage({
    title: "Safety, theft and equipment incidents", subtitle: "Log anything that went wrong or nearly did.", table: "incidents", order: [["incident_date", false]], create: ["ops_manager", "supervisor", "research"], edit: ["ops_manager", "supervisor"], remove: ["ops_manager"], newLabel: "Report incident",
    columns: [{ key: "incident_date", label: "Date", type: "date" }, { key: "type", label: "Type", type: "badge" }, { key: "severity", label: "Severity", type: "badge" }, { key: "description", label: "What happened" }, { key: "action_taken", label: "Action" }, { key: "status", label: "Status", type: "badge" }],
    fields: [{ key: "incident_date", label: "Date", type: "date", default: today, required: true }, { key: "type", label: "Type", type: "select", options: ["safety", "environment", "theft", "equipment", "other"], required: true }, { key: "severity", label: "Severity", type: "select", options: ["low", "medium", "high"], required: true },
      { key: "status", label: "Status", type: "select", options: ["open", "closed"], default: "open", required: true }, { key: "description", label: "What happened", type: "textarea", required: true }, { key: "action_taken", label: "Action taken", type: "textarea" }],
  }),
});

reg("compliance", {
  title: "Safety & compliance", group: "Field operations", label: "Compliance", roles: ["ops_manager", "supervisor", "accountant"],
  render: crudPage({
    title: "Safety, environment and labour checks", subtitle: "Mark a check done when you complete it. Overdue checks alert the owner.", table: "compliance_checks", order: [["area", true], ["item", true]], create: ["ops_manager"], edit: ["ops_manager"], remove: ["ops_manager"], newLabel: "New check",
    filter: { key: "area", label: "areas", options: ["safety", "environment", "agrochemical", "labour"] },
    columns: [{ key: "area", label: "Area", type: "badge" }, { key: "item", label: "Check" }, { key: "frequency", label: "How often" }, { key: "last_checked", label: "Last checked", type: "date" }, { key: "status", label: "Status", type: "badge" }, { key: "owner_role", label: "Owner" }],
    fields: [{ key: "area", label: "Area", type: "select", options: ["safety", "environment", "agrochemical", "labour"], required: true }, { key: "item", label: "Check", required: true, full: true }, { key: "frequency", label: "How often", type: "select", options: ["weekly", "monthly", "seasonal"], required: true }, { key: "owner_role", label: "Owner", type: "select", options: ROLES }, { key: "notes", label: "Notes", type: "textarea" }],
    actions: [{ label: "Checked today", roles: ["ops_manager", "supervisor"], kind: "good", run: async (r, reload) => { ok(await sb.from("compliance_checks").update({ last_checked: today(), status: "ok" }).eq("id", r.id)); toast("Marked as checked", "ok"); reload(); } }],
  }),
});

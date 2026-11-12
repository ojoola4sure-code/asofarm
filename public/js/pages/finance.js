import { sb, ok, rpc, state, role, can, FIN, ROLE_LABEL, currentSeason, upload, openFile } from "../supa.js";
import { reg } from "../router.js";
import { esc, money, money2, date, num, pct, badge, modal, toast, fail, pageHead, today, $, $$, confirmBox, promptBox, statusBar, csvDownload } from "../ui.js";

const rerender = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
const SPEND = ["accountant", "ops_manager", "supervisor", "sales"];

async function banks() { return ok(await sb.from("bank_accounts").select("*").order("name")); }

export async function payModal(t) {
  const b = await banks();
  modal({
    title: "Record payment", body: `<p><b>${esc(t.description || t.payee || "")}</b> ${money(t.amount)}</p><form class="form" id="pf"><div class="field"><label>Paid from *</label><select name="bank" required>${b.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></div>
    <div class="field"><label>Date paid *</label><input type="date" name="d" value="${today()}" required></div></form><p class="muted small">This posts the journal entry automatically and locks the amount.</p>`,
    footer: `<button class="btn alt" data-c>Cancel</button><button class="btn good" data-s>Mark paid</button>`,
    onMount: (m, close) => {
      $("[data-c]", m).onclick = close;
      $("[data-s]", m).onclick = async () => {
        const f = new FormData($("#pf", m));
        try { await rpc("mark_paid", { p_id: t.id, p_bank: f.get("bank"), p_date: f.get("d") }); toast("Payment recorded and journal posted", "ok"); close(); rerender(); } catch (e) { fail(e); }
      };
    },
  });
}

// ------------------------------------------------------------ Expenses
async function openExpenseForm(existing, kind = "expense") {
  const s = await currentSeason();
  const isAsset = kind === "asset_purchase", isReceipt = kind === "income" || kind === "capital";
  const [bl, cats, blocks, bankList, incAccts] = await Promise.all([
    sb.from("v_budget_vs_actual").select("*").eq("season_id", s.id).order("stage_seq").then(ok),
    sb.from("expense_categories").select("*").order("name").then(ok),
    sb.from("blocks").select("id,name").order("name").then(ok),
    isReceipt ? banks() : Promise.resolve([]),
    isReceipt ? sb.from("accounts").select("id,code,name").eq("type", "income").order("code").then(ok) : Promise.resolve([]),
  ]);
  const catOpts = cats.filter((c) => (isAsset ? c.grp === "equipment" : c.grp !== "equipment"));
  const e = existing || {};
  const title = existing ? "Edit request" : isReceipt ? (kind === "capital" ? "Record capital injected" : "Record money received") : isAsset ? "Record equipment purchase" : "New expense request";
  const m = modal({
    title, wide: true,
    body: `<form class="form" id="ef">
      ${!isReceipt && !isAsset ? `<div class="field full"><label>Budget line</label><select name="budget_line_id" id="bl"><option value="">No budget line (needs admin approval)</option>${bl.map((b) => `<option value="${b.id}" ${e.budget_line_id === b.id ? "selected" : ""}>${esc(`${b.stage_name || "General"} · ${b.category} · ${b.description || ""} (left ${money(b.remaining)})`)}</option>`).join("")}</select><span class="help" id="blh">Picking a budget line sets the category and stage and lets small requests be approved automatically.</span></div>` : ""}
      ${isReceipt ? `${kind === "income" ? `<div class="field"><label>Income type *</label><select name="income_account_id" required>${incAccts.map((a) => `<option value="${a.id}" ${a.code === "4020" ? "selected" : ""}>${esc(a.code + " " + a.name)}</option>`).join("")}</select></div>` : ""}<div class="field"><label>Received into *</label><select name="bank_account_id" required>${bankList.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("")}</select></div>`
        : `<div class="field" id="catf"><label>Category *</label><select name="category_id" id="cat" required>${catOpts.map((c) => `<option value="${c.id}" ${e.category_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>`}
      <div class="field"><label>Date *</label><input type="date" name="txn_date" value="${e.txn_date || today()}" required></div>
      <div class="field"><label>${isReceipt ? "From" : "Payee"}</label><input name="payee" value="${esc(e.payee || "")}"></div>
      <div class="field"><label>Amount (₦) *</label><input type="number" name="amount" step="0.01" min="1" value="${e.amount || ""}" required></div>
      <div class="field"><label>Reference or receipt number</label><input name="reference" value="${esc(e.reference || "")}"></div>
      ${!isReceipt ? `<div class="field"><label>Block</label><select name="block_id"><option value=""></option>${blocks.map((b) => `<option value="${b.id}" ${e.block_id === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></div>` : ""}
      <div class="field full"><label>What is it for *</label><textarea name="description" required>${esc(e.description || "")}</textarea></div>
      <div class="field full"><label>Receipt or quote (photo or PDF)</label><input type="file" name="receipt" accept="image/*,application/pdf" capture="environment"></div></form>`,
    footer: isReceipt ? `<button class="btn alt" data-c>Cancel</button><button class="btn good" data-pay>Save as received</button>`
      : `<button class="btn alt" data-c>Cancel</button><button class="btn alt" data-draft>Save draft</button><button class="btn" data-sub>Submit for approval</button>`,
    onMount: (back, close) => {
      $("[data-c]", back).onclick = close;
      const blSel = $("#bl", back), catSel = $("#cat", back);
      const syncBL = () => {
        if (!blSel) return;
        const b = bl.find((x) => x.id === blSel.value);
        if (b) { catSel.value = b.category_id; catSel.disabled = true; $("#blh", back).textContent = `Left on this line: ${money(b.remaining)}. Anything above that needs admin approval.`; } else { catSel.disabled = false; }
      };
      if (blSel) { blSel.onchange = syncBL; syncBL(); }
      async function persist(status) {
        const f = $("#ef", back);
        if (!f.reportValidity()) return;
        const fd = new FormData(f);
        const v = { txn_date: fd.get("txn_date"), payee: fd.get("payee") || null, amount: Number(fd.get("amount")), reference: fd.get("reference") || null, description: fd.get("description"), block_id: fd.get("block_id") || null };
        if (isReceipt) {
          v.kind = kind; v.bank_account_id = fd.get("bank_account_id"); if (kind === "income") v.income_account_id = fd.get("income_account_id");
        } else {
          v.kind = kind;
          const b = bl.find((x) => x.id === fd.get("budget_line_id"));
          v.budget_line_id = b ? b.id : null; v.category_id = b ? b.category_id : fd.get("category_id") || catSel.value; v.stage_id = b ? b.stage_id : null;
        }
        const file = fd.get("receipt");
        if (file && file.size) v.receipt_path = await upload("documents", file, "receipts");
        try {
          if (existing) {
            ok(await sb.from("transactions").update(v).eq("id", existing.id));
            if (status === "submitted") await rpc("submit_transaction", { p_id: existing.id });
            toast(status === "submitted" ? "Submitted" : "Saved", "ok");
          } else {
            const row = ok(await sb.from("transactions").insert({ ...v, status, requested_by: state.user.id, season_id: s.id, paid_at: status === "paid" ? v.txn_date : null }).select("status,required_role,approval_note").single());
            toast(status === "paid" ? "Recorded and posted to the books" : status === "draft" ? "Draft saved" : row.status === "approved" ? "Approved automatically. The accountant will pay it." : `Sent to ${ROLE_LABEL[row.required_role] || "the approver"}${row.approval_note ? ": " + row.approval_note : ""}`, "ok");
          }
          close(); rerender();
        } catch (err) { fail(err); }
      }
      const dr = $("[data-draft]", back), sb2 = $("[data-sub]", back), pay = $("[data-pay]", back);
      if (dr) dr.onclick = () => persist("draft");
      if (sb2) sb2.onclick = () => persist("submitted");
      if (pay) pay.onclick = () => persist("paid");
    },
  });
  return m;
}

reg("expenses", {
  title: "Expenses & payments", group: "Finance", label: "Expenses", roles: SPEND,
  async render(el, { params }) {
    const st = params.status || "all";
    let q = sb.from("v_transactions").select("*").order("created_at", { ascending: false }).limit(400);
    if (st !== "all") q = q.eq("status", st);
    const rows = ok(await q);
    const me = state.user.id;
    el.innerHTML = `<div class="page">${pageHead("Expenses & payments", "Every spend starts as a request against a budget line. The system routes approval and posts the books when paid.",
      `<button class="btn" id="n-exp">+ Expense request</button>${can(["accountant", "ops_manager"]) ? `<button class="btn alt" id="n-asset">Equipment purchase</button>` : ""}${can(["accountant"]) ? `<button class="btn alt" id="n-inc">Money received</button><button class="btn alt" id="n-cap">Capital injected</button>` : ""}`)}
      <div class="card flush"><div class="toolbar"><select id="st">${["all", "draft", "pending_approval", "approved", "paid", "rejected"].map((x) => `<option value="${x}" ${x === st ? "selected" : ""}>${x.replace("_", " ")}</option>`).join("")}</select><span class="spacer"></span><button class="btn sm alt" id="csv">Export CSV</button></div>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>For</th><th>Category</th><th>Stage</th><th class="num">Amount</th><th>By</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((t, i) => `<tr><td>${date(t.txn_date)}</td><td>${esc(t.payee || "")}<div class="muted small">${esc(t.description || "")}</div></td><td class="small">${esc(t.kind === "income" ? "Income" : t.kind === "capital" ? "Capital" : t.category_name || "")}</td><td class="small">${esc(t.stage_name || "")}</td>
        <td class="num">${t.kind === "income" || t.kind === "capital" ? "+" : ""}${money(t.amount)}</td><td class="small">${esc(t.requester_name || "")}</td>
        <td>${badge(t.status)}${t.status === "pending_approval" ? `<div class="muted small">needs ${esc(ROLE_LABEL[t.required_role] || t.required_role)}</div>` : ""}${t.approval_note && t.status !== "paid" ? `<div class="muted small">${esc(t.approval_note)}</div>` : ""}</td>
        <td style="white-space:nowrap">${t.receipt_path ? `<button class="btn sm alt" data-rc="${i}">Receipt</button> ` : ""}${["draft", "rejected"].includes(t.status) && (t.requested_by === me || can(["accountant"])) ? `<button class="btn sm alt" data-ed="${i}">Edit</button> <button class="btn sm" data-sub="${i}">Submit</button>` : ""}${t.status === "approved" && can(["accountant"]) && ["expense", "asset_purchase"].includes(t.kind) ? ` <button class="btn sm good" data-pay="${i}">Pay</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No transactions yet.</div>`}</div></div>`;
    $("#st").onchange = (e) => { location.hash = "#/expenses?status=" + e.target.value; };
    $("#csv").onclick = () => csvDownload(rows, [{ label: "Date", key: "txn_date" }, { label: "Kind", key: "kind" }, { label: "Payee", key: "payee" }, { label: "Description", key: "description" }, { label: "Category", key: "category_name" }, { label: "Stage", key: "stage_name" }, { label: "Amount", key: "amount" }, { label: "Status", key: "status" }], "transactions.csv");
    $("#n-exp").onclick = () => openExpenseForm(null, "expense");
    const a = $("#n-asset"); if (a) a.onclick = () => openExpenseForm(null, "asset_purchase");
    const i1 = $("#n-inc"); if (i1) i1.onclick = () => openExpenseForm(null, "income");
    const c1 = $("#n-cap"); if (c1) c1.onclick = () => openExpenseForm(null, "capital");
    $$("[data-rc]", el).forEach((b) => (b.onclick = () => openFile("documents", rows[b.dataset.rc].receipt_path).catch(fail)));
    $$("[data-ed]", el).forEach((b) => (b.onclick = () => openExpenseForm(rows[b.dataset.ed], rows[b.dataset.ed].kind)));
    $$("[data-sub]", el).forEach((b) => (b.onclick = async () => { try { await rpc("submit_transaction", { p_id: rows[b.dataset.sub].id }); toast("Submitted", "ok"); rerender(); } catch (e) { fail(e); } }));
    $$("[data-pay]", el).forEach((b) => (b.onclick = () => payModal(rows[b.dataset.pay])));
  },
});

// ------------------------------------------------------------ Approvals
reg("approvals", {
  title: "Approvals", group: "Field operations", label: "Approvals", roles: ["ops_manager", "accountant"],
  async render(el) {
    const rows = ok(await sb.from("v_transactions").select("*").in("status", ["pending_approval", "approved"]).order("created_at").limit(200));
    const pending = rows.filter((r) => r.status === "pending_approval"), ready = rows.filter((r) => r.status === "approved");
    const me = state.user.id, myRole = role();
    const canDecide = (t) => myRole === "admin" || (t.required_role === myRole && t.requested_by !== me);
    el.innerHTML = `<div class="page">${pageHead("Approvals", "Requests are routed by amount: up to ₦250,000 to the Farm Operations Manager, above that (or over budget) to the admin. Nobody approves their own request, except an admin.")}
      <div class="card flush"><div class="card-head"><h3>Waiting for a decision (${pending.length})</h3></div>${pending.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Request</th><th>Category / stage</th><th class="num">Amount</th><th>Requested by</th><th>Needs</th><th></th></tr></thead><tbody>
      ${pending.map((t, i) => `<tr><td>${date(t.txn_date)}</td><td>${esc(t.payee || "")}<div class="muted small">${esc(t.description || "")}</div></td><td class="small">${esc(t.category_name || "")}<br>${esc(t.stage_name || "")}</td><td class="num">${money(t.amount)}</td><td>${esc(t.requester_name || "")}</td><td>${badge(t.required_role)}<div class="muted small">${esc(t.approval_note || "")}</div></td>
      <td style="white-space:nowrap">${canDecide(t) ? `<button class="btn sm good" data-ok="${i}">Approve</button> <button class="btn sm danger" data-no="${i}">Reject</button>` : '<span class="muted small">Not yours to decide</span>'}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">Nothing is waiting.</div>'}</div>
      <div class="card flush" style="margin-top:16px"><div class="card-head"><h3>Approved, waiting for payment (${ready.length})</h3></div>${ready.length ? `<div class="table-wrap"><table><tbody>${ready.map((t, i) => `<tr><td>${date(t.txn_date)}</td><td>${esc(t.payee || "")} ${esc(t.description || "")}</td><td class="num">${money(t.amount)}</td><td class="small">${esc(t.approval_note || "")}</td><td>${can(["accountant"]) ? `<button class="btn sm good" data-pay="${i}">Pay</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">None.</div>'}</div></div>`;
    $$("[data-ok]", el).forEach((b) => (b.onclick = async () => { try { await rpc("decide_transaction", { p_id: pending[b.dataset.ok].id, p_approve: true, p_note: null }); toast("Approved", "ok"); rerender(); } catch (e) { fail(e); } }));
    $$("[data-no]", el).forEach((b) => (b.onclick = async () => { const n = await promptBox("Reject request", "Reason (the requester will see this)"); if (n === null) return; try { await rpc("decide_transaction", { p_id: pending[b.dataset.no].id, p_approve: false, p_note: n || "Rejected" }); toast("Rejected", "ok"); rerender(); } catch (e) { fail(e); } }));
    $$("[data-pay]", el).forEach((b) => (b.onclick = () => payModal(ready[b.dataset.pay])));
  },
});

// ------------------------------------------------------------ Budgets
reg("budgets", {
  title: "Budgets vs actual", group: "Finance", label: "Budgets", roles: ["accountant", "ops_manager", "supervisor"],
  async render(el, { params }) {
    const s = await currentSeason();
    const grp = params.g || "all";
    let rows = ok(await sb.from("v_budget_vs_actual").select("*").eq("season_id", s.id).order("stage_seq").order("category"));
    const groupOf = (r) => (r.is_management ? "management" : r.crop === "cassava" ? "cassava" : r.crop?.startsWith("maize") ? "maize" : "general");
    if (grp !== "all") rows = rows.filter((r) => groupOf(r) === grp);
    const tot = rows.reduce((a, r) => ({ b: a.b + Number(r.budget), s: a.s + Number(r.spent), c: a.c + Number(r.committed) }), { b: 0, s: 0, c: 0 });
    const edit = can(["accountant", "ops_manager"]);
    el.innerHTML = `<div class="page">${pageHead("Budgets vs actual", `${s.name}. Spent counts paid items; committed counts approved or pending ones.`, edit ? `<button class="btn" id="addb">+ Budget line</button>` : "")}
      <div class="kpis"><div class="kpi"><label>Budget</label><strong>${money(tot.b)}</strong></div><div class="kpi"><label>Spent</label><strong>${money(tot.s)}</strong><small>${pct(tot.b ? (tot.s / tot.b) * 100 : 0)} of budget</small></div><div class="kpi"><label>Committed</label><strong>${money(tot.c)}</strong></div><div class="kpi ${tot.b - tot.s - tot.c < 0 ? "bad" : "ok"}"><label>Remaining</label><strong>${money(tot.b - tot.s - tot.c)}</strong></div></div>
      <div class="card flush"><div class="toolbar"><select id="g">${[["all", "All lines"], ["cassava", "Cassava field costs"], ["maize", "Maize field costs"], ["management", "Management expenses"]].map(([v, l]) => `<option value="${v}" ${v === grp ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="table-wrap"><table><thead><tr><th>Stage</th><th>Category</th><th>Description</th><th class="num">Budget</th><th class="num">Spent</th><th class="num">Committed</th><th class="num">Remaining</th><th style="min-width:110px">Used</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${edit ? "click" : ""}" data-i="${i}"><td class="small">${esc(r.stage_name || "General")}</td><td>${esc(r.category)}${r.is_management ? ` ${badge("management", "info")}` : ""}</td><td class="small">${esc(r.description || "")}</td><td class="num">${money(r.budget)}</td><td class="num">${money(r.spent)}</td><td class="num">${money(r.committed)}</td><td class="num" style="${r.remaining < 0 ? "color:var(--bad);font-weight:700" : ""}">${money(r.remaining)}</td><td>${statusBar(Number(r.spent) + Number(r.committed), Number(r.budget))}</td></tr>`).join("")}
      <tr class="total"><td colspan="3">Total</td><td class="num">${money(tot.b)}</td><td class="num">${money(tot.s)}</td><td class="num">${money(tot.c)}</td><td class="num">${money(tot.b - tot.s - tot.c)}</td><td></td></tr></tbody></table></div></div></div>`;
    $("#g").onchange = (e) => { location.hash = "#/budgets?g=" + e.target.value; };
    async function form(row) {
      const [cats, stages] = await Promise.all([sb.from("expense_categories").select("id,name").order("name").then(ok), sb.from("stages").select("id,seq,name").eq("season_id", s.id).order("seq").then(ok)]);
      const m = modal({
        title: row ? "Edit budget line" : "New budget line",
        body: `<form class="form" id="bf"><div class="field"><label>Category *</label><select name="category_id" required>${cats.map((c) => `<option value="${c.id}" ${row?.category_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Stage</label><select name="stage_id"><option value=""></option>${stages.map((x) => `<option value="${x.id}" ${row?.stage_id === x.id ? "selected" : ""}>${x.seq}. ${esc(x.name)}</option>`).join("")}</select></div>
        <div class="field full"><label>Description</label><input name="description" value="${esc(row?.description || "")}"></div>
        <div class="field"><label>Amount (₦) *</label><input type="number" name="amount" min="0" step="any" required value="${row?.budget ?? ""}"></div><div class="field"><label>Planned date</label><input type="date" name="planned_date" value="${row?.planned_date || ""}"></div></form>`,
        footer: `<button class="btn alt" data-c>Cancel</button><button class="btn" data-s>Save</button>`,
        onMount: (b, close) => {
          $("[data-c]", b).onclick = close;
          $("[data-s]", b).onclick = async () => {
            const f = $("#bf", b); if (!f.reportValidity()) return;
            const v = Object.fromEntries(new FormData(f)); v.amount = Number(v.amount); v.stage_id ||= null; v.planned_date ||= null;
            try { if (row) ok(await sb.from("budget_lines").update(v).eq("id", row.id)); else ok(await sb.from("budget_lines").insert({ ...v, season_id: s.id, phase: s.phase })); toast("Saved", "ok"); close(); rerender(); } catch (e) { fail(e); }
          };
        },
      });
    }
    if (edit) { $("#addb").onclick = () => form(null); $$("tbody tr[data-i]", el).forEach((tr) => (tr.onclick = () => form(rows[tr.dataset.i]))); }
  },
});

// ------------------------------------------------------------ Phase targets and working capital
reg("phase-targets", {
  title: "Phase targets & working capital", group: "Finance", label: "Phase targets", roles: FIN,
  async render(el) {
    const s = await currentSeason();
    const [rows, d] = await Promise.all([sb.from("v_phase_targets_vs_actual").select("*").order("phase").then(ok), rpc("dashboard_summary", { p_season: s.id })]);
    const order = { field: 0, management: 1, total: 2 };
    rows.sort((a, b) => a.phase - b.phase || order[a.grp] - order[b.grp]);
    const edit = can(["accountant"]);
    el.innerHTML = `<div class="page">${pageHead("Phase targets vs amount spent", "Management expenses (transport, storage, insurance, admin and staff pay) are tracked against the target for each phase. Only Phase " + s.phase + " is active.", edit ? `<button class="btn alt" id="edit">Edit targets</button>` : "")}
      <div class="kpis"><div class="kpi"><label>Working capital</label><strong>${money(s.working_capital)}</strong></div><div class="kpi"><label>Cash on hand</label><strong>${money(d.cash.balance)}</strong></div><div class="kpi ${d.cash.shortfall > 0 ? "bad" : "ok"}"><label>Forecast low point</label><strong>${money(d.cash.forecast_min)}</strong><small>${d.cash.shortfall > 0 ? `Short by ${money(d.cash.shortfall)}` : "Covered by working capital"}</small></div><div class="kpi"><label>Phase ${s.phase} management spend</label><strong>${money(d.management.spent)}</strong><small>target ${money(d.management.target)}</small></div></div>
      ${[1, 2, 3, 4].map((p) => `<div class="card flush" style="margin-bottom:16px;${p === s.phase ? "border-color:var(--navy)" : "opacity:.85"}"><div class="card-head"><h3>Phase ${p}</h3>${p === s.phase ? badge("active", "info") : '<span class="muted small">future</span>'}</div>
      <div class="table-wrap"><table><thead><tr><th>Target</th><th class="num">Target amount</th><th class="num">Spent</th><th class="num">Committed</th><th class="num">Left</th><th style="min-width:140px">Used</th></tr></thead><tbody>
      ${rows.filter((r) => r.phase === p).map((r) => `<tr class="${r.grp === "management" ? "total" : ""}"><td>${esc(r.label)}<div class="muted small">${esc(r.notes || "")}</div></td><td class="num">${money(r.target_amount)}</td><td class="num">${money(r.spent)}</td><td class="num">${money(r.committed)}</td><td class="num" style="${Number(r.target_amount) - Number(r.spent) - Number(r.committed) < 0 ? "color:var(--bad)" : ""}">${money(Number(r.target_amount) - Number(r.spent) - Number(r.committed))}</td><td>${statusBar(Number(r.spent) + Number(r.committed), Number(r.target_amount))}</td></tr>`).join("")}</tbody></table></div></div>`).join("")}</div>`;
    const eb = $("#edit");
    if (eb) eb.onclick = () => {
      const m = modal({
        title: "Edit phase targets", wide: true,
        body: `<form id="tf" class="form">${rows.map((r) => `<div class="field"><label>Phase ${r.phase}: ${esc(r.label)}</label><input type="number" name="${r.id}" value="${r.target_amount}" min="0" step="any"></div>`).join("")}</form>`,
        footer: `<button class="btn alt" data-c>Cancel</button><button class="btn" data-s>Save</button>`,
        onMount: (b, close) => {
          $("[data-c]", b).onclick = close;
          $("[data-s]", b).onclick = async () => {
            try { for (const [id, v] of new FormData($("#tf", b))) ok(await sb.from("phase_targets").update({ target_amount: Number(v) }).eq("id", id)); toast("Targets saved", "ok"); close(); rerender(); } catch (e) { fail(e); }
          };
        },
      });
    };
  },
});

// ------------------------------------------------------------ Invoices and receivables
reg("invoices", {
  title: "Invoices & receivables", group: "Finance", label: "Invoices", roles: ["accountant", "ops_manager", "sales"],
  async render(el, { params }) {
    const st = params.status || "open";
    let rows = ok(await sb.from("v_receivables").select("*").order("issue_date", { ascending: false }).limit(300));
    const outstanding = rows.filter((r) => ["issued", "part_paid", "overdue"].includes(r.status));
    const ag = { current: 0, d30: 0, d60: 0, d61: 0 };
    outstanding.forEach((r) => { const o = Number(r.outstanding), dd = r.days_overdue; if (dd <= 0) ag.current += o; else if (dd <= 30) ag.d30 += o; else if (dd <= 60) ag.d60 += o; else ag.d61 += o; });
    if (st === "open") rows = outstanding; else if (st !== "all") rows = rows.filter((r) => r.status === st);
    const acc = can(["accountant"]);
    el.innerHTML = `<div class="page">${pageHead("Invoices & receivables", "Deliveries create invoices automatically. Record each payment received and the books update.", acc ? `<button class="btn" id="newinv">+ Invoice</button>` : "")}
      <div class="kpis"><div class="kpi"><label>Not yet due</label><strong>${money(ag.current)}</strong></div><div class="kpi"><label>1 to 30 days late</label><strong>${money(ag.d30)}</strong></div><div class="kpi warn"><label>31 to 60 days late</label><strong>${money(ag.d60)}</strong></div><div class="kpi bad"><label>Over 60 days late</label><strong>${money(ag.d61)}</strong></div></div>
      <div class="card flush"><div class="toolbar"><select id="st">${["open", "all", "draft", "issued", "part_paid", "paid", "overdue", "void"].map((x) => `<option value="${x}" ${x === st ? "selected" : ""}>${x.replace("_", " ")}</option>`).join("")}</select></div>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Buyer</th><th>Issued</th><th>Due</th><th class="num">Amount</th><th class="num">Paid</th><th class="num">Outstanding</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td>${esc(r.number)}<div class="muted small">${esc(r.description || "")}</div></td><td>${esc(r.buyer_name || "")}</td><td>${date(r.issue_date)}</td><td>${date(r.due_date)}${r.days_overdue > 0 ? ` <span class="badge bad">${r.days_overdue}d late</span>` : ""}</td><td class="num">${money(r.amount)}</td><td class="num">${money(r.paid)}</td><td class="num">${money(r.outstanding)}</td><td>${badge(r.status)}</td>
      <td style="white-space:nowrap">${acc && ["issued", "part_paid", "overdue"].includes(r.status) ? `<button class="btn sm good" data-pay="${i}">Record payment</button> ` : ""}${acc && r.status === "draft" ? `<button class="btn sm" data-iss="${i}">Issue</button> ` : ""}${acc && ["draft", "issued"].includes(r.status) && Number(r.paid) === 0 ? `<button class="btn sm danger" data-void="${i}">Void</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">No invoices match.</div>'}</div></div>`;
    $("#st").onchange = (e) => { location.hash = "#/invoices?status=" + e.target.value; };
    $$("[data-pay]", el).forEach((b) => (b.onclick = async () => {
      const inv = rows[b.dataset.pay], bk = await banks();
      modal({
        title: `Payment for ${inv.number}`, body: `<form class="form" id="pf"><div class="field"><label>Amount (₦) *</label><input type="number" name="amount" step="0.01" max="${inv.outstanding}" value="${inv.outstanding}" required></div><div class="field"><label>Date *</label><input type="date" name="pay_date" value="${today()}" required></div>
        <div class="field"><label>Paid into *</label><select name="bank_account_id" required>${bk.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></div><div class="field"><label>Reference</label><input name="reference"></div></form>`,
        footer: `<button class="btn alt" data-c>Cancel</button><button class="btn good" data-s>Record</button>`,
        onMount: (m, close) => {
          $("[data-c]", m).onclick = close;
          $("[data-s]", m).onclick = async () => {
            const f = $("#pf", m); if (!f.reportValidity()) return;
            const v = Object.fromEntries(new FormData(f)); v.amount = Number(v.amount);
            try { ok(await sb.from("payments").insert({ ...v, invoice_id: inv.id })); toast("Payment recorded", "ok"); close(); rerender(); } catch (e) { fail(e); }
          };
        },
      });
    }));
    $$("[data-iss]", el).forEach((b) => (b.onclick = async () => { try { ok(await sb.from("invoices").update({ status: "issued" }).eq("id", rows[b.dataset.iss].id)); toast("Issued and posted", "ok"); rerender(); } catch (e) { fail(e); } }));
    $$("[data-void]", el).forEach((b) => (b.onclick = async () => { if (!(await confirmBox("Void this invoice? A reversing entry is posted."))) return; try { ok(await sb.from("invoices").update({ status: "void" }).eq("id", rows[b.dataset.void].id)); toast("Voided", "ok"); rerender(); } catch (e) { fail(e); } }));
    const ni = $("#newinv");
    if (ni) ni.onclick = async () => {
      const buyers = ok(await sb.from("buyers").select("id,name").order("name"));
      modal({
        title: "New invoice", body: `<form class="form" id="nf"><div class="field"><label>Buyer *</label><select name="buyer_id" required>${buyers.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("")}</select></div><div class="field"><label>Amount (₦) *</label><input type="number" name="amount" min="1" step="any" required></div>
        <div class="field"><label>Issue date</label><input type="date" name="issue_date" value="${today()}"></div><div class="field"><label>Due date</label><input type="date" name="due_date" value="${new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)}"></div><div class="field full"><label>Description</label><input name="description"></div></form>`,
        footer: `<button class="btn alt" data-c>Cancel</button><button class="btn" data-s>Issue invoice</button>`,
        onMount: (m, close) => {
          $("[data-c]", m).onclick = close;
          $("[data-s]", m).onclick = async () => {
            const f = $("#nf", m); if (!f.reportValidity()) return;
            const v = Object.fromEntries(new FormData(f)); v.amount = Number(v.amount); v.status = "issued";
            try { ok(await sb.from("invoices").insert(v)); toast("Invoice issued", "ok"); close(); rerender(); } catch (e) { fail(e); }
          };
        },
      });
    };
  },
});

// ------------------------------------------------------------ Bank reconciliation
function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const amt = (v) => { if (v === undefined || v === null || String(v).trim() === "") return 0; let s = String(v).replace(/[₦,\s]/g, ""); const neg = /^\(.*\)$/.test(s) || s.startsWith("-"); s = s.replace(/[()-]/g, ""); const n = parseFloat(s); return Number.isNaN(n) ? 0 : neg ? -n : n; };
const parseDate = (v) => {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/); if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  const t = Date.parse(s); return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
};

reg("bank", {
  title: "Bank reconciliation", group: "Finance", label: "Bank reconciliation", roles: ["accountant"],
  async render(el, { params }) {
    const bk = await banks();
    const bid = params.b || bk[0]?.id;
    const [lines, ledger] = await Promise.all([sb.from("bank_statement_lines").select("*").eq("bank_account_id", bid).order("line_date", { ascending: false }).limit(500).then(ok), rpc("fn_cash_balance", { p_asof: today() })]);
    const um = lines.filter((l) => l.status === "unmatched");
    const lastBal = lines.find((l) => l.balance !== null)?.balance;
    el.innerHTML = `<div class="page">${pageHead("Bank reconciliation", "Upload a CSV statement. Lines are matched to paid expenses, receipts and payments by amount, date (within 3 days) and reference. Matching also runs every morning.",
      `<select class="mini" id="bk">${bk.map((b) => `<option value="${b.id}" ${b.id === bid ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select><label class="btn" for="csvf">Import CSV</label><input id="csvf" type="file" accept=".csv,text/csv" style="display:none"><button class="btn alt" id="match">Auto-match now</button>`)}
      <div class="kpis"><div class="kpi"><label>Ledger balance (all cash and bank)</label><strong>${money(ledger)}</strong></div><div class="kpi"><label>Latest statement balance</label><strong>${lastBal === undefined ? "-" : money(lastBal)}</strong></div><div class="kpi ${um.length ? "warn" : "ok"}"><label>Unmatched lines</label><strong>${um.length}</strong></div><div class="kpi"><label>Matched lines</label><strong>${lines.filter((l) => l.status === "matched").length}</strong></div></div>
      <div class="card flush"><div class="toolbar"><select id="f"><option value="all">All lines</option><option value="unmatched">Unmatched only</option></select></div>
      ${lines.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th>Reference</th><th class="num">Money out</th><th class="num">Money in</th><th>Status</th><th></th></tr></thead><tbody>
      ${lines.map((l, i) => `<tr data-st="${l.status}"><td>${date(l.line_date)}</td><td>${esc(l.description || "")}</td><td class="small">${esc(l.reference || "")}</td><td class="num">${Number(l.debit) ? money2(l.debit) : ""}</td><td class="num">${Number(l.credit) ? money2(l.credit) : ""}</td><td>${badge(l.status)}${l.matched_type ? `<div class="muted small">${esc(l.matched_type)}</div>` : ""}</td>
      <td style="white-space:nowrap">${l.status === "unmatched" ? `<button class="btn sm alt" data-ig="${i}">Ignore</button>` : l.status === "matched" ? `<button class="btn sm alt" data-un="${i}">Unmatch</button>` : `<button class="btn sm alt" data-un="${i}">Restore</button>`}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">No statement lines yet. Import a CSV with columns for date, description, debit/withdrawal, credit/deposit and optionally reference and balance.</div>'}</div></div>`;
    $("#bk").onchange = (e) => { location.hash = "#/bank?b=" + e.target.value; };
    $("#f").onchange = (e) => $$("tbody tr", el).forEach((tr) => (tr.style.display = e.target.value === "all" || tr.dataset.st === "unmatched" ? "" : "none"));
    $("#match").onclick = async () => { try { const r = await rpc("reconcile_bank", { p_bank: bid }); toast(`Matched ${r.matched}, ${r.unmatched} left to review`, "ok"); rerender(); } catch (e) { fail(e); } };
    $("#csvf").onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const grid = parseCsv(await file.text()); if (grid.length < 2) throw new Error("The file has no data rows.");
        const h = grid[0].map((x) => x.toLowerCase().trim());
        const idx = (...keys) => h.findIndex((x) => keys.some((k) => x.includes(k)));
        const iD = idx("date"), iDesc = idx("desc", "narr", "detail", "particular"), iRef = idx("ref"), iDeb = idx("debit", "withdraw", "money out", "paid out"), iCr = idx("credit", "deposit", "money in", "paid in"), iAmt = idx("amount"), iBal = idx("balance");
        if (iD < 0 || (iDeb < 0 && iCr < 0 && iAmt < 0)) throw new Error("Could not find the date and debit/credit columns. Check the header row.");
        const batch = "imp-" + Date.now();
        const out = grid.slice(1).map((r) => {
          const d = parseDate(r[iD]); if (!d) return null;
          let debit = iDeb >= 0 ? Math.abs(amt(r[iDeb])) : 0, credit = iCr >= 0 ? Math.abs(amt(r[iCr])) : 0;
          if (iDeb < 0 && iCr < 0) { const a = amt(r[iAmt]); if (a < 0) debit = -a; else credit = a; }
          if (!debit && !credit) return null;
          return { bank_account_id: bid, line_date: d, description: iDesc >= 0 ? r[iDesc] : null, reference: iRef >= 0 ? r[iRef] : null, debit, credit, balance: iBal >= 0 && r[iBal] ? amt(r[iBal]) : null, import_batch: batch };
        }).filter(Boolean);
        if (!out.length) throw new Error("No usable rows found.");
        ok(await sb.from("bank_statement_lines").insert(out));
        const r = await rpc("reconcile_bank", { p_bank: bid });
        toast(`Imported ${out.length} lines. Matched ${r.matched}, ${r.unmatched} to review.`, "ok"); rerender();
      } catch (err) { fail(err); }
    };
    $$("[data-ig]", el).forEach((b) => (b.onclick = async () => { try { ok(await sb.from("bank_statement_lines").update({ status: "ignored" }).eq("id", lines[b.dataset.ig].id)); rerender(); } catch (e) { fail(e); } }));
    $$("[data-un]", el).forEach((b) => (b.onclick = async () => { try { ok(await sb.from("bank_statement_lines").update({ status: "unmatched", matched_id: null, matched_type: null }).eq("id", lines[b.dataset.un].id)); rerender(); } catch (e) { fail(e); } }));
  },
});

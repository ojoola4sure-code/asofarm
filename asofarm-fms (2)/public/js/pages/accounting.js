import { sb, ok, rpc, state, role, can, FIN, currentSeason, openFile, upload } from "../supa.js";
import { reg } from "../router.js";
import { esc, money, money2, date, datetime, num, pct, badge, modal, toast, fail, pageHead, today, $, $$, confirmBox, promptBox, statusBar, csvDownload } from "../ui.js";
import { crudPage } from "../crud.js";
import { lineChart, barRows } from "../charts.js";

const rerender = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
const ACC = ["accountant", "ops_manager"];
const monthLabel = (d) => new Date(d).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });

// ------------------------------------------------------------ Employees
reg("employees", {
  title: "Employees & workers", group: "Finance", label: "Employees", roles: ACC,
  render: crudPage({
    title: "Employees and casual workers", subtitle: "Staff are paid through monthly payroll. Casual workers are tracked by attendance.", table: "employees", order: [["full_name", true]], create: ACC, edit: ACC, remove: ["accountant"], newLabel: "New person",
    columns: [{ key: "full_name", label: "Name" }, { key: "kind", label: "Type", type: "badge" }, { key: "role_title", label: "Role" }, { key: "monthly_salary", label: "Monthly salary", type: "money" }, { key: "daily_rate", label: "Daily rate", type: "money" }, { key: "pension_applicable", label: "Pension", type: "bool" }, { key: "active", label: "Active", type: "bool" }],
    fields: [{ key: "full_name", label: "Full name", required: true }, { key: "kind", label: "Type", type: "select", options: ["staff", "casual"], required: true, default: "casual" }, { key: "role_title", label: "Role or trade" }, { key: "phone", label: "Phone" },
      { key: "monthly_salary", label: "Monthly salary (₦)", type: "number", default: 0 }, { key: "daily_rate", label: "Daily rate (₦)", type: "number", default: 0 }, { key: "bank_name", label: "Bank" }, { key: "account_no", label: "Account number" },
      { key: "pension_applicable", label: "Pension applies", type: "checkbox" }, { key: "active", label: "Active", type: "checkbox", default: true }],
  }),
});

// ------------------------------------------------------------ Payroll
reg("payroll", {
  title: "Payroll", group: "Finance", label: "Payroll", roles: ACC,
  async render(el) {
    const runs = ok(await sb.from("payroll_runs").select("*").order("period_start", { ascending: false }).limit(60));
    const acc = can(["accountant"]), adm = role() === "admin";
    const prev = new Date(); prev.setUTCMonth(prev.getUTCMonth() - 1);
    const pm = prev.toISOString().slice(0, 7);
    el.innerHTML = `<div class="page">${pageHead("Payroll", "A draft is prepared automatically at each month-end. The accountant reviews it, an admin approves it, then the accountant pays it and the journal posts itself.", acc ? `<input type="month" id="pm" value="${pm}" class="mini"><button class="btn" id="draft">Prepare draft</button>` : "")}
      <div class="alert info">PAYE is not calculated by the system. Enter it per the current tax rules before approving. Casual labour is only included when the setting <b>payroll_includes_casual</b> is on; otherwise pay casual workers through expense requests.</div>
      <div class="card flush">${runs.length ? `<div class="table-wrap"><table><thead><tr><th>Period</th><th class="num">Gross</th><th class="num">Net</th><th>Status</th><th>Paid</th><th></th></tr></thead><tbody>${runs.map((r, i) => `<tr><td>${date(r.period_start)} to ${date(r.period_end)}</td><td class="num">${money(r.total_gross)}</td><td class="num">${money(r.total_net)}</td><td>${badge(r.status)}</td><td>${r.paid_at ? date(r.paid_at) : "-"}</td><td><button class="btn sm alt" data-open="${i}">Open</button></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">No payroll runs yet. In Phase 1 there are no salaried staff, so month-end drafts will be empty until you add some.</div>'}</div></div>`;
    const dr = $("#draft");
    if (dr) dr.onclick = async () => {
      const [y, m] = $("#pm").value.split("-").map(Number); const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10), end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      try { await rpc("run_payroll_draft", { p_start: start, p_end: end }); toast("Draft prepared", "ok"); rerender(); } catch (e) { fail(e); }
    };
    $$("[data-open]", el).forEach((b) => (b.onclick = async () => {
      const run = runs[b.dataset.open];
      const items = ok(await sb.from("payroll_items").select("*, employees(full_name,kind)").eq("run_id", run.id));
      const bk = ok(await sb.from("bank_accounts").select("*").order("name"));
      const editable = acc && run.status === "draft";
      const m = modal({
        title: `Payroll ${date(run.period_start)} to ${date(run.period_end)}`, wide: true,
        body: `${items.length ? `<div class="table-wrap"><table><thead><tr><th>Person</th><th class="num">Days</th><th class="num">Gross</th><th class="num">PAYE</th><th class="num">Pension (employee)</th><th class="num">Pension (employer)</th><th class="num">Net</th></tr></thead><tbody>${items.map((it) => `<tr><td>${esc(it.employees?.full_name)} ${badge(it.employees?.kind || "")}</td><td class="num">${it.days ?? ""}</td><td class="num">${money2(it.gross)}</td><td class="num">${editable ? `<input type="number" data-paye="${it.id}" value="${it.paye}" step="0.01" min="0" style="width:110px">` : money2(it.paye)}</td><td class="num">${money2(it.pension_employee)}</td><td class="num">${money2(it.pension_employer)}</td><td class="num" data-net="${it.id}">${money2(it.net)}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">No items in this run.</div>'}
          ${run.status === "approved" && acc ? `<div class="field" style="margin-top:12px;max-width:280px"><label>Pay from</label><select id="bk">${bk.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></div>` : ""}`,
        footer: `${editable ? `<button class="btn alt" data-save>Save PAYE</button>` : ""}${adm && run.status === "draft" ? `<button class="btn good" data-appr>Approve payroll</button>` : ""}${acc && run.status === "approved" ? `<button class="btn good" data-pay>Pay and post</button>` : ""}<button class="btn alt" data-c>Close</button>`,
        onMount: (back, close) => {
          $("[data-c]", back).onclick = close;
          const sv = $("[data-save]", back);
          if (sv) sv.onclick = async () => {
            try { for (const inp of $$("[data-paye]", back)) { const it = items.find((x) => x.id === inp.dataset.paye); const paye = Number(inp.value || 0); ok(await sb.from("payroll_items").update({ paye, net: Number(it.gross) - paye - Number(it.pension_employee) }).eq("id", it.id)); } toast("Saved", "ok"); close(); rerender(); } catch (e) { fail(e); }
          };
          const ap = $("[data-appr]", back); if (ap) ap.onclick = async () => { try { await rpc("approve_payroll", { p_run: run.id }); toast("Approved", "ok"); close(); rerender(); } catch (e) { fail(e); } };
          const py = $("[data-pay]", back); if (py) py.onclick = async () => { try { await rpc("pay_payroll", { p_run: run.id, p_bank: $("#bk", back).value, p_date: today() }); toast("Paid and journal posted", "ok"); close(); rerender(); } catch (e) { fail(e); } };
        },
      });
    }));
  },
});

// ------------------------------------------------------------ Assets
reg("assets", {
  title: "Assets & equipment", group: "Finance", label: "Assets", roles: ["accountant", "ops_manager", "supervisor"],
  render: crudPage({
    title: "Equipment, tools and investments", subtitle: "Equipment purchases recorded under Expenses appear here and are depreciated monthly. Net book value is cost less depreciation.", table: "assets", order: [["purchase_date", false]], create: ACC, edit: ACC, remove: ["accountant"], newLabel: "Add asset",
    columns: [{ key: "name", label: "Asset" }, { key: "category", label: "Type", type: "badge" }, { key: "purchase_date", label: "Bought", type: "date" }, { key: "cost", label: "Cost", type: "money" }, { key: "accumulated_depreciation", label: "Depreciation", type: "money" }, { label: "Net book value", type: "money", get: (r) => Number(r.cost) - Number(r.accumulated_depreciation) }, { key: "location", label: "Location" }, { key: "status", label: "Status", type: "badge" }],
    fields: [{ key: "name", label: "Name", required: true }, { key: "category", label: "Type", type: "select", options: ["equipment", "tools", "vehicle", "land_improvement", "investment", "other"], required: true }, { key: "purchase_date", label: "Purchase date", type: "date", required: true }, { key: "cost", label: "Cost (₦)", type: "number", required: true },
      { key: "useful_life_years", label: "Useful life (years)", type: "number", default: 5 }, { key: "salvage_value", label: "Salvage value (₦)", type: "number", default: 0 }, { key: "location", label: "Location" }, { key: "serial_no", label: "Serial number" }, { key: "status", label: "Status", type: "select", options: ["active", "under_repair", "disposed"], default: "active" }, { key: "notes", label: "Notes", type: "textarea" }],
  }),
});

// ------------------------------------------------------------ Journal
reg("journal", {
  title: "Journal", group: "Finance", label: "Journal", roles: ACC,
  async render(el) {
    const [entries, accounts] = await Promise.all([
      sb.from("journal_entries").select("*, journal_lines(debit,credit,memo,accounts(code,name))").order("entry_date", { ascending: false }).order("created_at", { ascending: false }).limit(120).then(ok),
      sb.from("accounts").select("id,code,name").eq("active", true).order("code").then(ok)]);
    const acc = can(["accountant"]);
    el.innerHTML = `<div class="page">${pageHead("Journal", "Every entry is double-entry and balanced. Entries are created automatically from payments, invoices, payroll and depreciation; you can post manual entries or reverse a wrong one.", acc ? `<button class="btn" id="mj">+ Manual journal</button>` : "")}
      <div class="card flush"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Entry</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th><th></th></tr></thead><tbody>
      ${entries.map((e, i) => e.journal_lines.map((l, k) => `<tr ${k === 0 ? 'style="border-top:2px solid var(--line)"' : ""}><td>${k === 0 ? date(e.entry_date) : ""}</td><td>${k === 0 ? `${esc(e.memo || "")} ${badge(e.source_type || "manual", "info")}` : ""}</td><td class="small">${esc(l.accounts?.code)} ${esc(l.accounts?.name)}</td><td class="num">${Number(l.debit) ? money2(l.debit) : ""}</td><td class="num">${Number(l.credit) ? money2(l.credit) : ""}</td><td>${k === 0 && acc && e.source_type !== "reversal" ? `<button class="btn sm alt" data-rev="${i}">Reverse</button>` : ""}</td></tr>`).join("")).join("") || '<tr><td colspan="6" class="empty">No entries yet.</td></tr>'}</tbody></table></div></div></div>`;
    $$("[data-rev]", el).forEach((b) => (b.onclick = async () => { if (!(await confirmBox("Post a reversing entry for this journal?"))) return; try { await rpc("reverse_journal", { p_entry: entries[b.dataset.rev].id, p_memo: "Reversal" }); toast("Reversed", "ok"); rerender(); } catch (e) { fail(e); } }));
    const mj = $("#mj");
    if (mj) mj.onclick = () => {
      const rowHtml = () => `<tr><td><select class="mini" data-code style="max-width:260px">${accounts.map((a) => `<option value="${a.code}">${esc(a.code + " " + a.name)}</option>`).join("")}</select></td><td><input type="number" step="0.01" min="0" data-d style="width:120px"></td><td><input type="number" step="0.01" min="0" data-c style="width:120px"></td></tr>`;
      const m = modal({
        title: "Manual journal", wide: true,
        body: `<div class="form"><div class="field"><label>Date</label><input type="date" id="jd" value="${today()}"></div><div class="field"><label>Memo *</label><input id="jm" required></div></div><table style="margin-top:12px"><thead><tr><th>Account</th><th>Debit</th><th>Credit</th></tr></thead><tbody id="jl">${rowHtml()}${rowHtml()}</tbody></table><button class="btn sm alt" id="addl" style="margin-top:8px">+ Line</button><p id="jb" class="muted"></p>`,
        footer: `<button class="btn alt" data-c>Cancel</button><button class="btn" data-s>Post</button>`,
        onMount: (b, close) => {
          const calc = () => { const d = $$("[data-d]", b).reduce((s, x) => s + Number(x.value || 0), 0), c = $$("[data-c]", b).reduce((s, x) => s + Number(x.value || 0), 0); $("#jb", b).textContent = `Debits ${money2(d)}, credits ${money2(c)}${Math.abs(d - c) < 0.005 ? " (balanced)" : ` (out by ${money2(d - c)})`}`; };
          b.addEventListener("input", calc); calc();
          $("#addl", b).onclick = () => { $("#jl", b).insertAdjacentHTML("beforeend", rowHtml()); };
          $("[data-c]", b).onclick = close;
          $("[data-s]", b).onclick = async () => {
            const lines = $$("#jl tr", b).map((tr) => ({ code: $("[data-code]", tr).value, debit: Number($("[data-d]", tr).value || 0), credit: Number($("[data-c]", tr).value || 0) })).filter((l) => l.debit || l.credit);
            if (!$("#jm", b).value) return toast("Add a memo", "bad");
            try { await rpc("post_manual_journal", { p_date: $("#jd", b).value, p_memo: $("#jm", b).value, p_lines: lines }); toast("Posted", "ok"); close(); rerender(); } catch (e) { fail(e); }
          };
        },
      });
    };
  },
});

// ------------------------------------------------------------ Statements
reg("statements", {
  title: "Financial statements", group: "Finance", label: "Statements", roles: ACC,
  async render(el, { params }) {
    const tab = params.t || "pnl";
    const now = new Date(), first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const from = params.from || "2000-01-01", to = params.to || today();
    let body = "";
    if (tab === "pnl") {
      const r = await rpc("fn_pnl", { p_from: from, p_to: to });
      const inc = r.filter((x) => x.type === "income"), exp = r.filter((x) => x.type === "expense");
      const ti = inc.reduce((s, x) => s + Number(x.amount), 0), te = exp.reduce((s, x) => s + Number(x.amount), 0);
      const block = (title, rows, t) => `<tr class="total"><td colspan="2">${title}</td></tr>${rows.filter((x) => Number(x.amount) !== 0).map((x) => `<tr><td class="small">${esc(x.code)}</td><td>${esc(x.name)}</td><td class="num">${money2(x.amount)}</td></tr>`).join("")}<tr class="total"><td colspan="2">Total ${title.toLowerCase()}</td><td class="num">${money2(t)}</td></tr>`;
      body = `<div class="table-wrap"><table><tbody>${block("Income", inc, ti)}${block("Expenses", exp, te)}<tr class="total"><td colspan="2">Net profit</td><td class="num" style="color:${ti - te < 0 ? "var(--bad)" : "var(--ok)"}">${money2(ti - te)}</td></tr><tr><td colspan="2" class="muted">Margin</td><td class="num">${ti ? pct(((ti - te) / ti) * 100, 1) : "-"}</td></tr></tbody></table></div>`;
    } else if (tab === "bs") {
      const r = await rpc("fn_balance_sheet", { p_asof: to });
      const sum = (t) => r.filter((x) => x.type === t).reduce((s, x) => s + Number(x.amount), 0);
      const sec = (t, label) => `<tr class="total"><td colspan="2">${label}</td></tr>${r.filter((x) => x.type === t && Number(x.amount) !== 0).map((x) => `<tr><td class="small">${esc(x.code)}</td><td>${esc(x.name)}</td><td class="num">${money2(x.amount)}</td></tr>`).join("")}<tr class="total"><td colspan="2">Total ${label.toLowerCase()}</td><td class="num">${money2(sum(t))}</td></tr>`;
      body = `<div class="table-wrap"><table><tbody>${sec("asset", "Assets")}${sec("liability", "Liabilities")}${sec("equity", "Equity")}<tr><td colspan="2" class="muted">Assets minus liabilities and equity (should be zero)</td><td class="num">${money2(sum("asset") - sum("liability") - sum("equity"))}</td></tr></tbody></table></div>`;
    } else if (tab === "tb") {
      const r = await rpc("fn_trial_balance", { p_asof: to });
      const td = r.reduce((s, x) => s + Number(x.debit), 0), tc = r.reduce((s, x) => s + Number(x.credit), 0);
      body = `<div class="table-wrap"><table><thead><tr><th>Code</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>${r.map((x) => `<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td class="num">${money2(x.debit)}</td><td class="num">${money2(x.credit)}</td></tr>`).join("")}<tr class="total"><td colspan="2">Totals</td><td class="num">${money2(td)}</td><td class="num">${money2(tc)}</td></tr></tbody></table></div>`;
    } else if (tab === "cf") {
      const r = await rpc("fn_cashflow", { p_from: from, p_to: to });
      const open = await rpc("fn_cash_balance", { p_asof: new Date(new Date(from).getTime() - 86400000).toISOString().slice(0, 10) }), close = await rpc("fn_cash_balance", { p_asof: to });
      body = `<div class="table-wrap"><table><thead><tr><th>Source</th><th class="num">Cash in</th><th class="num">Cash out</th><th class="num">Net</th></tr></thead><tbody><tr class="total"><td>Opening cash</td><td></td><td></td><td class="num">${money2(open)}</td></tr>${r.map((x) => `<tr><td>${esc(x.category.replace(/_/g, " "))}</td><td class="num">${money2(x.inflow)}</td><td class="num">${money2(x.outflow)}</td><td class="num">${money2(Number(x.inflow) - Number(x.outflow))}</td></tr>`).join("")}<tr class="total"><td>Closing cash</td><td></td><td></td><td class="num">${money2(close)}</td></tr></tbody></table></div>`;
    } else {
      const snaps = ok(await sb.from("financial_snapshots").select("*").order("period", { ascending: false }).limit(60));
      const periods = [...new Set(snaps.map((x) => x.period))];
      body = periods.length ? `<div class="table-wrap"><table><thead><tr><th>Month</th><th>Saved statements</th><th>Net profit that month</th></tr></thead><tbody>${periods.map((p) => { const pnl = snaps.find((x) => x.period === p && x.kind === "pnl"); const inc = (pnl?.data || []).filter((x) => x.type === "income").reduce((s, x) => s + Number(x.amount), 0), exp = (pnl?.data || []).filter((x) => x.type === "expense").reduce((s, x) => s + Number(x.amount), 0); return `<tr><td>${esc(p)}</td><td>${snaps.filter((x) => x.period === p).map((x) => badge(x.kind.replace("_", " "), "info")).join(" ")}</td><td class="num">${money2(inc - exp)}</td></tr>`; }).join("")}</tbody></table></div>` : '<div class="empty">No month has been closed yet. Month-end runs automatically on the 1st; you can also run it now.</div>';
    }
    const dateCtl = tab === "pnl" || tab === "cf" ? `<label>From <input type="date" id="from" value="${from}"></label>` : "";
    el.innerHTML = `<div class="page">${pageHead("Financial statements", "Generated live from the journal. Month-end saves a snapshot of each statement.", `<button class="btn alt" id="pr">Print</button>${can(["accountant"]) ? `<button class="btn" id="me">Run month-end now</button>` : ""}`)}
      <div class="card flush"><div class="toolbar">${[["pnl", "Profit & loss"], ["bs", "Balance sheet"], ["tb", "Trial balance"], ["cf", "Cash flow"], ["snap", "Month-end history"]].map(([t, l]) => `<a class="btn sm ${t === tab ? "" : "alt"}" href="#/statements?t=${t}&from=${from}&to=${to}">${l}</a>`).join("")}<span class="spacer"></span>${tab !== "snap" ? `${dateCtl}<label>${tab === "bs" || tab === "tb" ? "As of" : "To"} <input type="date" id="to" value="${to}"></label>` : ""}</div>${body}</div></div>`;
    const go = () => { location.hash = `#/statements?t=${tab}&from=${$("#from")?.value || from}&to=${$("#to")?.value || to}`; };
    $("#from")?.addEventListener("change", go); $("#to")?.addEventListener("change", go);
    $("#pr").onclick = () => window.print();
    const me = $("#me"); if (me) me.onclick = async () => { if (!(await confirmBox("Run month-end for last month now? This posts depreciation, drafts payroll and saves the statements."))) return; try { await rpc("run_month_end_now"); toast("Month-end done", "ok"); rerender(); } catch (e) { fail(e); } };
  },
});

// ------------------------------------------------------------ Cash flow forecast
reg("cashflow", {
  title: "Cash flow forecast", group: "Finance", label: "Cash flow", roles: ACC,
  async render(el) {
    const s = await currentSeason();
    const [f, txns, d] = await Promise.all([rpc("fn_cash_forecast", { p_season: s.id }), sb.from("transactions").select("amount,paid_at,kind,status").eq("status", "paid").in("kind", ["expense", "asset_purchase"]).then(ok), rpc("dashboard_summary", { p_season: s.id })]);
    const actual = {}; txns.forEach((t) => { const k = String(t.paid_at).slice(0, 7); actual[k] = (actual[k] || 0) + Number(t.amount); });
    const low = f.reduce((a, b) => (Number(b.cumulative) < Number(a.cumulative) ? b : a), f[0]);
    el.innerHTML = `<div class="page">${pageHead("Cash flow forecast", `Starts from the ${money(s.working_capital)} working capital. Planned spending comes from budget lines; planned receipts from the revenue plan.`)}
      ${d.cash.shortfall > 0 ? `<div class="alert warn"><b>Shortfall of ${money(d.cash.shortfall)}</b> around ${new Date(low.month_start).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}. Options: stage planting in blocks, delay non-urgent purchases, negotiate input credit, or arrange a bridge loan before then.</div>` : `<div class="alert info">The plan stays within working capital. Lowest planned balance: ${money(low.cumulative)}.</div>`}
      <div class="kpis"><div class="kpi"><label>Working capital</label><strong>${money(s.working_capital)}</strong></div><div class="kpi"><label>Cash on hand</label><strong>${money(d.cash.balance)}</strong></div><div class="kpi ${d.cash.shortfall > 0 ? "bad" : "ok"}"><label>Planned low point</label><strong>${money(low.cumulative)}</strong><small>${new Date(low.month_start).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</small></div><div class="kpi"><label>Planned revenue</label><strong>${money(d.revenue.planned)}</strong><small>${money(d.revenue.actual)} so far</small></div></div>
      <div class="card" style="margin-bottom:16px"><h3>Planned cash balance by month</h3>${lineChart([{ name: "Planned", color: "#283890", points: f.map((x) => ({ x: monthLabel(x.month_start), y: Number(x.cumulative) })) }], { fmt: (v) => "₦" + (v / 1e6).toFixed(1) + "m" })}</div>
      <div class="card flush"><div class="table-wrap"><table><thead><tr><th>Month</th><th class="num">Planned in</th><th class="num">Planned out</th><th class="num">Actual out</th><th class="num">Net</th><th class="num">Planned balance</th></tr></thead><tbody>${f.map((x) => `<tr><td>${monthLabel(x.month_start)}</td><td class="num">${money(x.planned_in)}</td><td class="num">${money(x.planned_out)}</td><td class="num">${money(actual[String(x.month_start).slice(0, 7)] || 0)}</td><td class="num">${money(x.net)}</td><td class="num" style="${Number(x.cumulative) < 0 ? "color:var(--bad);font-weight:700" : ""}">${money(x.cumulative)}</td></tr>`).join("")}</tbody></table></div></div></div>`;
  },
});

// ------------------------------------------------------------ Profitability per acre
reg("profitability", {
  title: "Profit per acre", group: "Finance", label: "Profit per acre", roles: ACC,
  async render(el) {
    const s = await currentSeason();
    const [p, bva, txns, set] = await Promise.all([rpc("fn_profitability", { p_season: s.id }), sb.from("v_budget_vs_actual").select("*").eq("season_id", s.id).then(ok),
      sb.from("v_transactions").select("amount,block_name,status,kind").eq("season_id", s.id).eq("status", "paid").eq("kind", "expense").then(ok),
      sb.from("app_settings").select("key,value").in("key", ["expected_yield_cassava", "expected_yield_maize"]).then(ok)]);
    const st = Object.fromEntries(set.map((x) => [x.key, Number(x.value)]));
    const cost = (c) => Number(p.find((x) => x.crop === c)?.cost || 0), total = p.find((x) => x.crop === "TOTAL");
    const be = (c, t) => (t > 0 ? cost(c) / t : 0);
    const cassT = s.acres * (st.expected_yield_cassava || 8), maizeT = s.acres * (st.expected_yield_maize || 1.5) * 2;
    const byCat = {}; bva.forEach((b) => { byCat[b.category] = (byCat[b.category] || 0) + Number(b.spent); });
    const byBlock = {}; txns.forEach((t) => { const k = t.block_name || "Not assigned to a block"; byBlock[k] = (byBlock[k] || 0) + Number(t.amount); });
    el.innerHTML = `<div class="page">${pageHead("Production cost and profit per acre", `${s.name}. Costs come from paid expenses; revenue from issued invoices and receipts. Figures grow as the season progresses.`)}
      <div class="kpis"><div class="kpi"><label>Total cost</label><strong>${money(total?.cost)}</strong><small>${money(total?.cost_per_acre)} per acre</small></div><div class="kpi"><label>Revenue</label><strong>${money(total?.revenue)}</strong><small>${money(total?.revenue_per_acre)} per acre</small></div><div class="kpi ${Number(total?.profit) < 0 ? "bad" : "ok"}"><label>Profit</label><strong>${money(total?.profit)}</strong><small>${money(total?.profit_per_acre)} per acre</small></div></div>
      <div class="card flush" style="margin-bottom:16px"><div class="table-wrap"><table><thead><tr><th>Crop</th><th class="num">Cost</th><th class="num">Revenue</th><th class="num">Profit</th><th class="num">Cost / acre</th><th class="num">Revenue / acre</th><th class="num">Profit / acre</th></tr></thead><tbody>${p.map((r) => `<tr class="${r.crop === "TOTAL" ? "total" : ""}"><td>${esc(r.crop)}</td><td class="num">${money(r.cost)}</td><td class="num">${money(r.revenue)}</td><td class="num">${money(r.profit)}</td><td class="num">${money(r.cost_per_acre)}</td><td class="num">${money(r.revenue_per_acre)}</td><td class="num">${money(r.profit_per_acre)}</td></tr>`).join("")}</tbody></table></div></div>
      <div class="grid g2"><div class="card"><h3>Break-even selling price</h3><p>Cassava: <b>${money(be("cassava", cassT))}</b> per tonne at ${num(cassT)} t expected.</p><p>Maize: <b>${money(be("maize", maizeT))}</b> per tonne at ${num(maizeT, 1)} t expected over two cycles.</p><p class="muted small">Cost to date divided by expected tonnes. It falls as yields beat expectations and rises with each extra naira spent.</p></div>
      <div class="card"><h3>Cost to date by block</h3>${barRows(Object.entries(byBlock).map(([k, v]) => ({ label: k, value: v })), { fmt: money })}</div></div>
      <div class="card" style="margin-top:16px"><h3>Spend by category</h3>${barRows(Object.entries(byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v })), { fmt: money }) || '<div class="empty">No spending yet.</div>'}</div></div>`;
  },
});

// ------------------------------------------------------------ Tax and compliance calendar
reg("tax", {
  title: "Tax & statutory", group: "Finance", label: "Tax & statutory", roles: ACC,
  render: crudPage({
    title: "Statutory filing calendar", subtitle: "Generated for the whole season. Reminders go out 7 days before each due date. Confirm each deadline and rate with your tax adviser; they change.", table: "tax_filings", select: "*, tax_items(name,authority,notes)", order: [["due_date", true]], edit: ["accountant"], limit: 300,
    filter: { key: "status", label: "statuses", options: ["due", "filed", "late", "not_applicable"] }, fileBucket: "documents",
    columns: [{ label: "Filing", get: (r) => r.tax_items?.name || "" }, { label: "Authority", get: (r) => r.tax_items?.authority || "" }, { key: "period", label: "Period" }, { key: "due_date", label: "Due", type: "date" }, { key: "status", label: "Status", type: "badge" }, { key: "filed_date", label: "Filed", type: "date" }, { key: "reference", label: "Reference" }, { key: "document_path", label: "Document", type: "file" }],
    fields: [{ key: "status", label: "Status", type: "select", options: ["due", "filed", "late", "not_applicable"], required: true }, { key: "filed_date", label: "Date filed", type: "date" }, { key: "reference", label: "Reference or receipt number" }, { key: "document_path", label: "Proof of filing", type: "file", bucket: "documents", folder: "tax" }, { key: "notes", label: "Notes", type: "textarea" }],
    actions: [{ label: "Mark filed", roles: ["accountant"], kind: "good", show: (r) => r.status !== "filed", run: async (r, reload) => { const ref = await promptBox("Mark as filed", "Reference or receipt number (optional)"); if (ref === null) return; ok(await sb.from("tax_filings").update({ status: "filed", filed_date: today(), reference: ref || null }).eq("id", r.id)); toast("Marked filed", "ok"); reload(); } }],
  }),
});

// ------------------------------------------------------------ Audit trail
reg("audit", {
  title: "Audit trail", group: "Finance", label: "Audit trail", roles: ["accountant"],
  async render(el, { params }) {
    const t = params.t || "";
    let q = sb.from("audit_log").select("*").order("at", { ascending: false }).limit(300);
    if (t) q = q.eq("table_name", t);
    const [rows, people] = await Promise.all([q.then(ok), sb.from("profiles").select("id,full_name").then(ok)]);
    const names = Object.fromEntries(people.map((p) => [p.id, p.full_name]));
    const tables = ["transactions", "journal_entries", "invoices", "payments", "payroll_runs", "assets", "budget_lines", "bank_statement_lines", "profiles", "approval_rules", "phase_targets"];
    el.innerHTML = `<div class="page">${pageHead("Audit trail", "Every change to money records, approvals and users, with who and when. Entries cannot be edited.")}
      <div class="card flush"><div class="toolbar"><select id="t"><option value="">All tables</option>${tables.map((x) => `<option ${x === t ? "selected" : ""}>${x}</option>`).join("")}</select><span class="spacer"></span><button class="btn sm alt" id="csv">Export CSV</button></div>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Table</th><th>Action</th><th>Record</th></tr></thead><tbody>${rows.map((r, i) => `<tr class="click" data-i="${i}"><td>${datetime(r.at)}</td><td>${esc(names[r.user_id] || (r.user_id ? "" : "System"))}</td><td>${esc(r.table_name)}</td><td>${badge(r.action, r.action === "DELETE" ? "bad" : r.action === "INSERT" ? "ok" : "info")}</td><td class="small">${esc(String(r.record_id || "").slice(0, 8))}</td></tr>`).join("")}</tbody></table></div></div></div>`;
    $("#t").onchange = (e) => { location.hash = "#/audit" + (e.target.value ? "?t=" + e.target.value : ""); };
    $("#csv").onclick = () => csvDownload(rows, [{ label: "When", key: "at" }, { label: "Who", get: (r) => names[r.user_id] || "" }, { label: "Table", key: "table_name" }, { label: "Action", key: "action" }, { label: "Record", key: "record_id" }, { label: "Before", csv: (r) => JSON.stringify(r.old_data || "") }, { label: "After", csv: (r) => JSON.stringify(r.new_data || "") }], "audit-trail.csv");
    $$("tbody tr", el).forEach((tr) => (tr.onclick = () => { const r = rows[tr.dataset.i]; modal({ title: `${r.action} ${r.table_name}`, wide: true, body: `<div class="grid g2"><div><h4>Before</h4><pre style="white-space:pre-wrap;font-size:12px">${esc(JSON.stringify(r.old_data, null, 2) || "-")}</pre></div><div><h4>After</h4><pre style="white-space:pre-wrap;font-size:12px">${esc(JSON.stringify(r.new_data, null, 2) || "-")}</pre></div></div>` }); }));
  },
});

// ------------------------------------------------------------ Documents vault
reg("documents", {
  title: "Documents", group: "Finance", label: "Documents",
  async render(el) {
    const rows = ok(await sb.from("documents").select("*").order("created_at", { ascending: false }).limit(300));
    const del = can(["accountant"]);
    el.innerHTML = `<div class="page">${pageHead("Document vault", "Receipts, contracts, tax and audit papers. Finance and the manager see everything; everyone else sees what they uploaded.", `<button class="btn" id="up">+ Upload document</button>`)}
      <div class="card flush">${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Title</th><th>Type</th><th>Uploaded</th><th>Notes</th><th></th></tr></thead><tbody>${rows.map((r, i) => `<tr><td>${esc(r.title)}</td><td>${badge(r.doc_type, "info")}</td><td>${datetime(r.created_at)}</td><td class="small">${esc(r.notes || "")}</td><td style="white-space:nowrap"><button class="btn sm alt" data-open="${i}">Open</button>${del ? ` <button class="btn sm danger" data-del="${i}">Delete</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">No documents yet.</div>'}</div></div>`;
    $$("[data-open]", el).forEach((b) => (b.onclick = () => openFile("documents", rows[b.dataset.open].storage_path).catch(fail)));
    $$("[data-del]", el).forEach((b) => (b.onclick = async () => { if (!(await confirmBox("Delete this document record?"))) return; try { ok(await sb.from("documents").delete().eq("id", rows[b.dataset.del].id)); rerender(); } catch (e) { fail(e); } }));
    $("#up").onclick = () => modal({
      title: "Upload document", body: `<form class="form" id="uf"><div class="field full"><label>Title *</label><input name="title" required></div><div class="field"><label>Type</label><select name="doc_type">${["receipt", "invoice", "contract", "audit", "tax", "report", "other"].map((x) => `<option>${x}</option>`).join("")}</select></div>
      <div class="field"><label>File *</label><input type="file" name="file" required accept="image/*,application/pdf,.csv,.xlsx,.docx"></div><div class="field full"><label>Notes</label><textarea name="notes"></textarea></div></form>`,
      footer: `<button class="btn alt" data-c>Cancel</button><button class="btn" data-s>Upload</button>`,
      onMount: (m, close) => {
        $("[data-c]", m).onclick = close;
        $("[data-s]", m).onclick = async () => {
          const f = $("#uf", m); if (!f.reportValidity()) return;
          const fd = new FormData(f);
          try { const path = await upload("documents", fd.get("file"), "vault"); ok(await sb.from("documents").insert({ title: fd.get("title"), doc_type: fd.get("doc_type"), notes: fd.get("notes") || null, storage_path: path, uploaded_by: state.user.id })); toast("Uploaded", "ok"); close(); rerender(); } catch (e) { fail(e); }
        };
      },
    });
  },
});

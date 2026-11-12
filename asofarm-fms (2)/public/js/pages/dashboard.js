import { sb, ok, rpc, state, role, can, FIN, ROLE_LABEL, currentSeason } from "../supa.js";
import { reg } from "../router.js";
import { esc, money, date, num, pct, badge, statusBar, pageHead, today, daysBetween, datetime } from "../ui.js";
import { ganttSvg, ganttLegend, bindGantt } from "../gantt.js";
import { lineChart, barRows } from "../charts.js";
import { taskTableHtml, bindTaskControls } from "../tasklib.js";

const kpi = (label, value, small = "", cls = "") => `<div class="kpi ${cls}"><label>${esc(label)}</label><strong>${value}</strong><small>${small}</small></div>`;

reg("dashboard", {
  title: "Dashboard", group: "Overview", label: "Dashboard",
  async render(el) {
    const s = await currentSeason(true);
    if (!s) { el.innerHTML = `<div class="page"><div class="alert warn">No season found. An admin can create one under Admin > Schedule.</div></div>`; return; }
    const fin = can(FIN);
    const d = await rpc("dashboard_summary", { p_season: s.id });
    const stages = ok(await sb.from("v_stage_gantt").select("*").eq("season_id", s.id).order("seq"));
    const plus7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    let tq = sb.from("v_tasks").select("*").eq("season_id", s.id).neq("status", "done").lte("due_date", plus7).order("due_date").limit(12);
    if (!can(["ops_manager"])) tq = tq.eq("assignee_role", role());
    const [tasks, notes] = await Promise.all([
      tq.then(ok),
      sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(8).then(ok),
    ]);

    let forecast = [], bva = [], targets = [];
    if (fin) {
      [forecast, bva, targets] = await Promise.all([
        rpc("fn_cash_forecast", { p_season: s.id }),
        sb.from("v_budget_vs_actual").select("*").eq("season_id", s.id).then(ok),
        sb.from("v_phase_targets_vs_actual").select("*").eq("phase", s.phase).then(ok),
      ]);
    }

    const dayN = Math.max(0, daysBetween(s.start_date, today())), total = daysBetween(stages[0]?.planned_start || s.start_date, stages[stages.length - 1]?.planned_end || s.start_date);
    const behind = d.planned_progress - d.progress;
    const cassCover = d.sales.cassava_expected_t ? (d.sales.cassava_signed_t / d.sales.cassava_expected_t) * 100 : 0;

    let kpis = kpi("Season progress", pct(d.progress), `Plan says ${pct(d.planned_progress)} by today`, behind > 10 ? "bad" : behind > 3 ? "warn" : "ok")
      + kpi("Tasks done", `${d.tasks.done}/${d.tasks.total}`, `${d.tasks.in_progress} in progress`)
      + kpi("Overdue tasks", d.tasks.overdue, `${d.tasks.due_week} due in 7 days`, d.tasks.overdue ? "bad" : "ok");
    if (fin) {
      kpis += kpi("Cash on hand", money(d.cash.balance), `Working capital ${money(d.cash.working_capital)}`, d.cash.balance < d.cash.working_capital * 0.25 && d.budget.spent > 0 ? "bad" : "")
        + kpi("Spent vs budget", money(d.budget.spent), `of ${money(d.budget.total)}; ${money(d.budget.committed)} committed`)
        + kpi("Management expenses", money(d.management.spent), `target ${money(d.management.target)}`, d.management.spent > d.management.target ? "bad" : "")
        + kpi("Awaiting approval", d.pending_approvals, `Receivables ${money(d.receivables)}`, d.pending_approvals ? "warn" : "");
    }
    kpis += kpi("Cassava pre-sold", pct(cassCover), `${num(d.sales.cassava_signed_t, 1)} of ~${num(d.sales.cassava_expected_t, 0)} t`, cassCover < 60 ? "warn" : "ok")
      + kpi("Rain, last 7 days", `${num(d.rain_7d, 0)} mm`, `${num(d.rain_30d, 0)} mm in 30 days`);

    const alerts = [];
    if (fin && d.cash.shortfall > 0) {
      const low = forecast.reduce((a, b) => (Number(b.cumulative) < Number(a.cumulative) ? b : a), forecast[0]);
      alerts.push(`<div class="alert warn"><b>Cash warning.</b> Planned spending runs ${money(d.cash.shortfall)} past the ${money(d.cash.working_capital)} working capital, with the low point around ${new Date(low.month_start).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}. Stage the planting, delay non-urgent buys or arrange a bridge before then.</div>`);
    }
    if (d.harvest?.days_to_start !== null && d.harvest.days_to_start <= 45 && d.harvest.days_to_start >= -60) {
      alerts.push(`<div class="alert info"><b>Cassava harvest window.</b> Opens ${date(d.harvest.start)}${d.harvest.window_end ? ` and closes ${date(d.harvest.window_end)}` : ""}. ${cassCover < 60 ? "Less than 60% of expected tonnage is contracted." : "Buyer cover looks healthy."}</div>`);
    }

    const readiness = [
      ["No overdue tasks", d.tasks.overdue === 0],
      ["Cassava at least 60% pre-sold", cassCover >= 60],
      ["Cash forecast covers the plan", !fin || d.cash.shortfall === 0],
      ["Management expenses within target", !fin || d.management.spent <= d.management.target],
      ["Fewer than 3 high risks open", d.risks_high < 3],
    ];

    const byGrp = {};
    bva.forEach((b) => { const g = b.is_management ? "Management" : b.crop === "cassava" ? "Cassava field costs" : b.crop?.startsWith("maize") ? "Maize field costs" : "Other field costs"; byGrp[g] ??= { budget: 0, used: 0 }; byGrp[g].budget += Number(b.budget); byGrp[g].used += Number(b.spent) + Number(b.committed); });

    el.innerHTML = `<div class="page">${pageHead(s.name, `Day ${dayN} of about ${total}. Start ${date(s.start_date)}. ${ROLE_LABEL[role()]} view.`)}
      ${alerts.join("")}<div class="kpis">${kpis}</div>
      <div class="card flush" style="margin-bottom:16px"><div class="card-head"><h3>Season Gantt: planned vs actual</h3><a class="btn sm alt" href="#/gantt">Open full chart</a></div>
        <div class="gantt-wrap">${ganttSvg(stages, { compact: true })}</div>${ganttLegend()}</div>
      <div class="grid g2" style="margin-bottom:16px">
        <div class="card flush"><div class="card-head"><h3>${can(["ops_manager"]) ? "Tasks due soon or late" : "My tasks this week"}</h3><a class="btn sm alt" href="#/tasks">All tasks</a></div><div id="dash-tasks">${taskTableHtml(tasks, { id: state.user.id, role: role() })}</div></div>
        <div class="card flush"><div class="card-head"><h3>Latest alerts</h3><a class="btn sm alt" href="#/notifications">Open</a></div>
          ${notes.length ? `<div class="table-wrap"><table><tbody>${notes.map((n) => `<tr><td>${badge(n.level, n.level === "critical" ? "bad" : n.level === "warning" ? "warn" : "info")}</td><td><a href="${esc(n.link || "#/notifications")}">${esc(n.title)}</a><div class="muted small">${esc(n.body || "")}</div></td><td class="muted small">${datetime(n.created_at)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No alerts. The system checks every morning.</div>`}</div></div>
      ${fin ? `<div class="grid g2" style="margin-bottom:16px">
        <div class="card"><h3>Budget used by group</h3>${Object.keys(byGrp).length ? Object.entries(byGrp).map(([g, v]) => `<div class="row-bar"><div>${esc(g)}<div class="muted small">${money(v.used)} of ${money(v.budget)}</div></div>${statusBar(v.used, v.budget)}<div style="text-align:right">${pct(v.budget ? (v.used / v.budget) * 100 : 0)}</div></div>`).join("") : '<div class="empty">No budget lines.</div>'}</div>
        <div class="card"><h3>Phase ${s.phase} targets vs amount spent</h3>${targets.length ? targets.sort((a, b) => ["field", "management", "total"].indexOf(a.grp) - ["field", "management", "total"].indexOf(b.grp)).map((t) => `<div class="row-bar"><div><b>${t.grp === "management" ? "Management expenses" : t.grp === "field" ? "Field costs" : "Total"}</b><div class="muted small">${money(Number(t.spent))} spent of ${money(Number(t.target_amount))} target</div></div>${statusBar(Number(t.spent) + Number(t.committed), Number(t.target_amount))}<div style="text-align:right">${pct(Number(t.target_amount) ? (Number(t.spent) / Number(t.target_amount)) * 100 : 0)}</div></div>`).join("") : '<div class="empty">No targets.</div>'}</div></div>
      <div class="card" style="margin-bottom:16px"><h3>Cash forecast against ${money(s.working_capital)} working capital</h3>${lineChart([{ name: "Planned cash", color: "#283890", points: forecast.map((f) => ({ x: new Date(f.month_start).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }), y: Number(f.cumulative) })) }], { fmt: (v) => "₦" + (v / 1e6).toFixed(1) + "m" })}</div>` : ""}
      <div class="grid g2"><div class="card"><h3>Pre-harvest sales cover</h3>${barRows([
        { label: "Cassava signed", sub: `${num(d.sales.cassava_signed_t, 1)} t of ~${num(d.sales.cassava_expected_t, 0)} t expected`, value: d.sales.cassava_signed_t, target: d.sales.cassava_expected_t, kind: cassCover >= 60 ? "ok" : "warn" },
        { label: "Maize signed", sub: `${num(d.sales.maize_signed_t, 1)} t of ~${num(d.sales.maize_expected_t, 0)} t expected (2 cycles)`, value: d.sales.maize_signed_t, target: d.sales.maize_expected_t },
      ], { fmt: (v) => num(v, 1) + " t" })}<p class="muted small">Cassava harvest window: ${date(d.harvest.start)} to ${date(d.harvest.end)}${d.harvest.window_end ? `, flexible to ${date(d.harvest.window_end)}` : ""}.</p></div>
      ${can(["ops_manager"]) ? `<div class="card"><h3>Ready for the next acreage step?</h3>${readiness.map(([t, okk]) => `<div style="padding:4px 0">${okk ? "&#9989;" : "&#9888;&#65039;"} ${esc(t)}</div>`).join("")}<p class="muted small">Based on this season so far. Expansion also needs a full season of yield and cost data.</p></div>` : `<div class="card"><h3>Open risks</h3><p>${d.risks_high} high-scoring risks open. <a href="#/risks">Review the register</a>.</p></div>`}</div></div>`;
    bindGantt(el, () => reg_rerender());
    bindTaskControls(el, () => reg_rerender());
    function reg_rerender() { routesRerender(); }
  },
});

function routesRerender() { window.dispatchEvent(new HashChangeEvent("hashchange")); }

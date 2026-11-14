import { sb, configured } from "./supa.js";
import { esc, md, money, date, num, pct, toast } from "./ui.js";
import { ganttSvg, ganttLegend } from "./gantt.js";

const root = document.getElementById("root");
const cfg = window.FMS_CONFIG || {};
const mediaUrl = (p) => `${cfg.SUPABASE_URL}/storage/v1/object/public/public-media/${encodeURI(p)}`;
const MARK = `<svg width="34" height="34" viewBox="0 0 64 64" aria-hidden="true"><path d="M0 64 28 0h14L14 64z" fill="#283890"></path><path d="M32 64 50 22l14 42z" fill="#FFCC00"></path></svg>`;
const AMOUNTS = ["Under ₦500,000", "₦500,000 to ₦2m", "₦2m to ₦10m", "₦10m to ₦50m", "Above ₦50m", "Not sure yet"];
const KINDS = [["invest", "I want to invest"], ["support", "I want to support the farm"], ["partner", "I want to partner (inputs, land, equipment, services)"], ["buy", "I want to buy produce"], ["other", "Something else"]];

function contactBlock(c) {
  const tel = (c.phone || "").replace(/\s+/g, "");
  return `<div class="info"><h3>Talk to us</h3>
    ${c.phone ? `<p><b>Call:</b> <a href="tel:${esc(tel)}">${esc(c.phone)}</a></p>` : ""}
    ${c.whatsapp ? `<p><b>WhatsApp:</b> <a href="https://wa.me/${esc(c.whatsapp)}" target="_blank" rel="noopener">Message us</a></p>` : ""}
    ${c.email ? `<p><b>Email:</b> <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></p>` : ""}
    ${c.address ? `<p class="muted">${esc(c.address)}</p>` : ""}</div>`;
}

function closed(c) {
  root.innerHTML = `<header class="iv-top"><div class="iv-wrap"><a class="iv-brand" href="/invest">${MARK}<div><b>ASO FARM</b><small>INVESTORS &amp; SUPPORTERS</small></div></a></div></header>
    <section class="iv-sec"><div class="iv-wrap"><h2>Our investor and support page opens soon</h2><p class="lede">We are preparing the plan, the progress and the numbers. In the meantime, you can reach us directly.</p><div class="iv-card" style="padding:20px;max-width:460px">${contactBlock(c)}</div></div></section>`;
}

function render(d) {
  const c = d.contact || {}, s = d.season, stages = d.stages || [];
  const doneStages = stages.filter((x) => x.status === "done").length;
  const content = d.content || [];
  const byKey = Object.fromEntries(content.map((x) => [x.key, x]));
  const hero = byKey.hero;
  const sops = d.sops || [];
  const maxAmt = Math.max(...(d.budget.groups || []).map((g) => Number(g.amount)), 1);

  const stageAcc = stages.map((st) => {
    const steps = sops.filter((x) => x.stage_seq === st.seq);
    return `<details><summary>${st.seq}. ${esc(st.name)} <span class="pc">${Math.round(st.progress)}% ${st.status === "done" ? "· done" : st.status === "in_progress" ? "· under way" : ""}</span></summary>
      <div class="inner"><p class="muted small">Planned ${date(st.planned_start)} to ${date(st.planned_end)}${st.window_end ? `; harvest window runs to ${date(st.window_end)}` : ""}. ${st.tasks_total} tasks, ${st.tasks_done} done.</p>
      <div class="bar" style="margin:6px 0 10px"><i style="width:${st.progress}%"></i></div>${steps.map((x) => `<h4 style="margin:10px 0 2px">${esc(x.title)}</h4>${md(x.body)}`).join("") || `<p class="muted small">Step-by-step method for this stage is shared on request.</p>`}</div></details>`;
  }).join("");

  const funds = `<div class="iv-card" style="padding:18px;max-width:760px;margin-top:14px"><h3 style="margin-bottom:10px">Planned Phase 1 budget</h3>
    ${(d.budget.groups || []).map((g) => `<div class="row-bar"><div>${esc(g.label)}</div><div class="bar"><i style="width:${(Number(g.amount) / maxAmt) * 100}%"></i></div><div style="text-align:right">${money(g.amount)}</div></div>`).join("")}
    <div class="row-bar" style="border-top:1px solid var(--line);margin-top:6px"><div><b>Total planned</b></div><div></div><div style="text-align:right"><b>${money((d.budget.groups || []).reduce((a, g) => a + Number(g.amount), 0))}</b></div></div>
    <p class="muted small">Working capital committed by the founder: ${money(s.working_capital)}.${d.budget.spent !== null && d.budget.spent !== undefined ? ` Spent so far: ${money(d.budget.spent)}.` : ""}</p></div>`;

  const sections = content.filter((x) => x.key !== "hero").map((x) => {
    const nav = ["plan", "how", "use_of_funds", "support", "risks"].includes(x.key) ? ` id="${x.key}"` : "";
    return `<section class="iv-sec"${nav}><div class="iv-wrap"><h2>${esc(x.title)}</h2>${md(x.body_md)}${x.key === "how" ? `<div class="iv-card iv-acc" style="padding:6px 16px;margin-top:18px"><h3 style="padding:10px 4px 0">Stage by stage: what is being done and how</h3>${stageAcc}</div>` : ""}${x.key === "use_of_funds" ? funds : ""}</div></section>`;
  }).join("");
  const hasHow = !!byKey.how, hasFunds = !!byKey.use_of_funds;
  const extra = (!hasHow ? `<section class="iv-sec" id="how"><div class="iv-wrap"><h2>Stage by stage: what is being done and how</h2><div class="iv-card iv-acc" style="padding:6px 16px">${stageAcc}</div></div></section>` : "")
    + (!hasFunds ? `<section class="iv-sec" id="use_of_funds"><div class="iv-wrap"><h2>Planned use of funds</h2>${funds}</div></section>` : "");

  const updates = (d.updates || []).length ? `<section class="iv-sec" id="updates"><div class="iv-wrap"><h2>Farm updates</h2><p class="lede">Latest from the field.</p><div class="iv-updates">${d.updates.map((u) => `<article>${u.photo_path ? `<img loading="lazy" src="${esc(mediaUrl(u.photo_path))}" alt="">` : ""}<div><div class="muted small">${date(u.date)}</div><h3>${esc(u.title)}</h3><p style="margin:0">${esc(u.body || "")}</p></div></article>`).join("")}</div></div></section>` : "";

  root.innerHTML = `<header class="iv-top"><div class="iv-wrap"><a class="iv-brand" href="/invest">${MARK}<div><b>ASO FARM</b><small>INVESTORS &amp; SUPPORTERS</small></div></a>
      <nav class="iv-nav"><a href="#progress">Live progress</a>${byKey.plan ? '<a href="#plan">Plan</a>' : ""}<a href="#how">How it is done</a><a href="#use_of_funds">Use of funds</a>${byKey.support ? '<a href="#support">Ways to help</a>' : ""}${byKey.risks ? '<a href="#risks">Risks</a>' : ""}<a href="#contact">Contact</a></nav>
      <button class="btn sm" data-cta="support">Call for support</button><button class="btn sm yellow" data-cta="invest">Call for investment</button></div></header>
    <section class="iv-hero"><div class="iv-wrap"><h1>${esc(hero?.title || "Grow with a farm that shows its work")}</h1><p>${esc(hero?.body_md || "").replace(/\n/g, "<br>")}</p>
      <div class="iv-cta"><button class="btn yellow" data-cta="invest">Call for investment</button><button class="btn ghost" data-cta="support">Call for support</button>${c.phone ? `<a class="btn ghost" href="tel:${esc(c.phone.replace(/\s+/g, ""))}">Call ${esc(c.phone)}</a>` : ""}${c.whatsapp ? `<a class="btn ghost" href="https://wa.me/${esc(c.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}</div>
      <div class="iv-path" aria-label="Growth path">${[["10", "Year 1"], ["100", "Year 2"], ["300", "Years 3 to 4"], ["1,000", "Year 6"], ["1,500", "Year 8"], ["2,000", "Year 10"]].map(([a, y]) => `<div><b>${a}</b><span>acres · ${y}</span></div>`).join("")}</div></div></section>
    <div class="iv-wrap"><div class="iv-stats" id="progress"><div><label>This season</label><strong>${num(s.acres)} acres</strong><small>cassava, then two maize cycles</small></div><div><label>Season progress</label><strong>${pct(d.progress)}</strong><small>${doneStages} of ${stages.length} stages complete</small></div><div><label>Tasks done</label><strong>${d.tasks.done}/${d.tasks.total}</strong><small>updated daily</small></div><div><label>Cassava harvest window</label><strong style="font-size:17px">${date(d.harvest.start)}</strong><small>flexible to ${date(d.harvest.window_end)}</small></div></div></div>
    <section class="iv-sec"><div class="iv-wrap"><h2>The season at a glance</h2><p class="lede">Every stage from land preparation to post-harvest. Bars fill as the farm team completes tasks. Last updated ${date(d.generated_at)}.</p><div class="iv-card"><div class="iv-gantt">${ganttSvg(stages, { compact: true })}</div>${ganttLegend()}</div></div></section>
    ${sections}${extra}${updates}
    <section class="iv-sec" id="contact"><div class="iv-wrap"><h2>Talk to us</h2><p class="lede">Tell us how you would like to help. We reply personally, usually within two working days.</p>
      <div class="iv-two" style="margin-bottom:22px"><div class="iv-card"><h3>Call for investment</h3><p>Back the farm with capital. We share the plan, the numbers and the terms openly.</p><button class="btn yellow" data-cta="invest">Start an investment enquiry</button></div><div class="iv-card"><h3>Call for support</h3><p>Pre-buy produce, supply inputs or equipment, offer land, advice or introductions.</p><button class="btn" data-cta="support">Offer your support</button></div></div>
      <div class="iv-contact"><div class="iv-card" style="padding:20px">${contactBlock(c)}</div><div class="iv-card iv-form" style="padding:20px" id="formbox"></div></div></div></section>
    <footer class="iv-foot"><div class="iv-wrap"><p><b>Important.</b> This page describes plans and estimates. Figures are projections, not guarantees, and farming can lose money. Nothing here is an offer of securities or a promise of returns; any investment is subject to a separate written agreement and your own advice. Prices, yields and weather change.</p><p>ASO FARM is part of ASO INOVISION. ${esc(c.address || "")}</p></div></footer>`;
  formUi();
}

function formUi(kind = "invest") {
  const box = document.getElementById("formbox");
  box.innerHTML = `<h3 style="margin-bottom:10px">Send an enquiry</h3><form class="form" id="inq"><div class="field full"><label>I would like to *</label><select name="kind" required>${KINDS.map(([v, l]) => `<option value="${v}" ${v === kind ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
    <div class="field"><label>Your name *</label><input name="name" required maxlength="120" autocomplete="name"></div><div class="field"><label>Organisation</label><input name="org" maxlength="160" autocomplete="organization"></div>
    <div class="field"><label>Email *</label><input type="email" name="email" required maxlength="200" autocomplete="email"></div><div class="field"><label>Phone or WhatsApp</label><input name="phone" maxlength="40" autocomplete="tel"></div>
    <div class="field full"><label>Amount you have in mind (optional)</label><select name="amount"><option value=""></option>${AMOUNTS.map((a) => `<option>${esc(a)}</option>`).join("")}</select></div>
    <div class="field full"><label>Message</label><textarea name="message" maxlength="2000" placeholder="Tell us what you have in mind"></textarea></div>
    <div class="iv-hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>
    <div class="field full check"><input type="checkbox" name="consent" id="consent" required><label for="consent" style="font-weight:500;color:var(--ink)">You may contact me about this enquiry. I understand this is not a binding offer.</label></div>
    <div class="field full"><button class="btn" type="submit">Send enquiry</button></div></form>`;
  document.getElementById("inq").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    const { error } = await sb.rpc("submit_inquiry", { p_kind: f.get("kind"), p_name: f.get("name"), p_email: f.get("email"), p_phone: f.get("phone") || null, p_org: f.get("org") || null, p_amount: f.get("amount") || null, p_message: f.get("message") || null, p_website: f.get("website") || null });
    if (error) { btn.disabled = false; return toast(error.message, "bad"); }
    box.innerHTML = `<div class="iv-ok"><h3>Thank you</h3><p>We have your message and will reply by email or phone soon. You can also call or message us on WhatsApp using the details on this page.</p></div>`;
  };
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-cta]");
  if (!b) return;
  formUi(b.dataset.cta);
  document.getElementById("contact").scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => document.querySelector("#inq input[name=name]")?.focus(), 500);
});

(async function init() {
  if (!configured) { root.innerHTML = `<div class="boot">This page is not connected yet.</div>`; return; }
  const { data, error } = await sb.rpc("public_overview");
  if (error) { root.innerHTML = `<div class="boot">This page could not load right now. Please try again shortly.</div>`; console.error(error); return; }
  if (!data.enabled) return closed(data.contact || {});
  render(data);
})();

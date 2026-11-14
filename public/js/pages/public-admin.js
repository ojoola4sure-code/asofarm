import { sb, ok, state, can, isAdmin } from "../supa.js";
import { reg } from "../router.js";
import { esc, date, datetime, badge, toast, fail, today, $, $$, pageHead } from "../ui.js";
import { crudPage } from "../crud.js";

const SALES = ["sales", "ops_manager"];
const rerender = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
const KIND_LABEL = { invest: "Investment", support: "Support", partner: "Partnership", buy: "Buyer", other: "Other" };

reg("inquiries", {
  title: "Investor & support enquiries", group: "Sales", label: "Enquiries", roles: SALES,
  render: crudPage({
    title: "Investor and support enquiries", subtitle: "Everything sent from the public page at /invest. Reply personally and keep the status up to date.", table: "investor_inquiries", order: [["created_at", false]],
    create: [], edit: SALES, remove: [], wide: true,
    filter: { key: "status", label: "statuses", options: ["new", "contacted", "in_talks", "committed", "declined", "closed"] },
    columns: [{ key: "created_at", label: "Received", type: "datetime" }, { label: "Type", render: (r) => badge(KIND_LABEL[r.kind] || r.kind, r.kind === "invest" ? "ok" : "info") }, { key: "name", label: "Name" }, { key: "organisation", label: "Organisation" }, { key: "amount_range", label: "Amount" },
      { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { label: "Message", render: (r) => `<span class="small">${esc((r.message || "").slice(0, 90))}${(r.message || "").length > 90 ? "…" : ""}</span>` }, { key: "status", label: "Status", type: "badge" }],
    fields: [{ key: "name", label: "Name", readonly: true }, { key: "organisation", label: "Organisation", readonly: true }, { key: "email", label: "Email", readonly: true }, { key: "phone", label: "Phone", readonly: true }, { key: "amount_range", label: "Amount in mind", readonly: true },
      { key: "status", label: "Status", type: "select", options: ["new", "contacted", "in_talks", "committed", "declined", "closed"], required: true }, { key: "message", label: "Their message", type: "textarea", readonly: true }, { key: "notes", label: "Our notes", type: "textarea" }],
    actions: [
      { label: "Email", roles: SALES, run: async (r) => { window.location.href = `mailto:${r.email}?subject=${encodeURIComponent("Your enquiry to ASO FARM")}`; } },
      { label: "Mark contacted", roles: SALES, kind: "good", show: (r) => r.status === "new", run: async (r, reload) => { ok(await sb.from("investor_inquiries").update({ status: "contacted", contacted_at: new Date().toISOString() }).eq("id", r.id)); toast("Marked contacted", "ok"); reload(); } },
    ],
  }),
});

reg("public-page", {
  title: "Public investor page", group: "Sales", label: "Public page", roles: SALES,
  async render(el) {
    const set = ok(await sb.from("app_settings").select("key,value").in("key", ["public_page_enabled", "public_show_spend", "public_show_sops"]));
    const v = Object.fromEntries(set.map((x) => [x.key, Number(x.value) > 0]));
    const admin = isAdmin();
    const sw = (key, label, help) => `<label class="field check" style="gap:10px"><input type="checkbox" data-set="${key}" ${v[key] ? "checked" : ""} ${admin ? "" : "disabled"}><span><b>${label}</b><br><span class="muted small">${help}</span></span></label>`;
    el.innerHTML = `<div class="page">${pageHead("Public investor and support page", "Visitors see this at /invest without signing in. Nothing is shown until you open the page and publish sections.", `<a class="btn alt" href="/invest" target="_blank" rel="noopener">Open the page</a>`)}
      <div class="card" style="margin-bottom:16px"><div class="grid g3">${sw("public_page_enabled", "Page is open to the public", "Off = visitors see only a coming-soon message with your contact details.")}${sw("public_show_sops", "Show step-by-step methods", "Shares the SOP steps for each stage.")}${sw("public_show_spend", "Show money spent so far", "Shows actual spending next to the planned budget.")}</div>
      ${admin ? "" : '<p class="muted small">Only an admin can change these switches.</p>'}<p class="muted small" style="margin-top:10px">Always visible when open: the season Gantt (stage names, dates, progress), planned budget totals, and the sections and updates you publish. Never shown: individual payments, salaries, bank details, supplier names, buyer names or internal notes. Review each section before you publish it, and take legal advice before inviting investment from the public.</p></div>
      <div id="c1"></div><div id="c2" style="margin-top:16px"></div></div>`;
    $$("[data-set]", el).forEach((cb) => (cb.onchange = async () => {
      try { ok(await sb.from("app_settings").update({ value: cb.checked ? 1 : 0, updated_at: new Date().toISOString() }).eq("key", cb.dataset.set)); toast(cb.checked ? "Turned on" : "Turned off", "ok"); } catch (e) { fail(e); cb.checked = !cb.checked; }
    }));
    await crudPage({
      title: "Page sections", subtitle: "Write in plain text. Use ## for a heading and - for bullet points. Only published sections appear. Order by the number.", table: "public_content", order: [["sort", true]], create: [], edit: [], remove: [], newLabel: "New section", wide: true,
      columns: [{ key: "sort", label: "Order", type: "num" }, { key: "key", label: "Key" }, { key: "title", label: "Title" }, { key: "published", label: "Published", type: "bool" }, { key: "updated_at", label: "Updated", type: "date" }],
      fields: [{ key: "key", label: "Key (short, no spaces)", required: true, help: "hero, plan, how, use_of_funds, support, risks, reporting, projections, opportunity or your own" }, { key: "title", label: "Title", required: true }, { key: "sort", label: "Order", type: "number", default: 100 }, { key: "published", label: "Published", type: "checkbox" }, { key: "body_md", label: "Text", type: "textarea" }],
      beforeSave: (vals) => ({ ...vals, updated_at: new Date().toISOString() }),
    })($("#c1", el));
    await crudPage({
      title: "Farm updates", subtitle: "Photo posts shown on the page. Publish when ready.", table: "public_updates", order: [["update_date", false]], create: SALES, edit: SALES, remove: SALES, newLabel: "New update", fileBucket: "public-media",
      columns: [{ key: "update_date", label: "Date", type: "date" }, { key: "title", label: "Title" }, { key: "published", label: "Published", type: "bool" }, { key: "photo_path", label: "Photo", type: "file" }],
      fields: [{ key: "title", label: "Title", required: true, full: true }, { key: "update_date", label: "Date", type: "date", default: today, required: true }, { key: "published", label: "Published", type: "checkbox" }, { key: "photo_path", label: "Photo", type: "file", bucket: "public-media", folder: "updates", capture: true }, { key: "body", label: "What happened", type: "textarea" }],
    })($("#c2", el));
  },
});

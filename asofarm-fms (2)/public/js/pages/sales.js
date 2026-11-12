import { sb, ok, state, can, role, currentSeason } from "../supa.js";
import { reg } from "../router.js";
import { esc, money, date, num, badge, toast, fail, today } from "../ui.js";
import { crudPage } from "../crud.js";
import { lineChart } from "../charts.js";

const SALES = ["sales", "ops_manager"];
const VIEW = ["sales", "ops_manager", "accountant"];

reg("buyers", {
  title: "Buyers", group: "Sales", label: "Buyers", roles: VIEW,
  render: crudPage({
    title: "Buyer database", subtitle: "Processors, flour mills, starch producers, feed manufacturers, wholesalers and cooperatives.", table: "buyers", order: [["name", true]], create: SALES, edit: SALES, remove: SALES, newLabel: "New buyer",
    filter: { key: "buyer_type", label: "types", options: ["processor", "flour_mill", "starch_producer", "feed_manufacturer", "wholesaler", "distributor", "cooperative", "other"] },
    columns: [{ key: "name", label: "Buyer" }, { key: "buyer_type", label: "Type", type: "badge" }, { key: "status", label: "Status", type: "badge" }, { key: "crops", label: "Crops", type: "tags" }, { key: "location", label: "Location" }, { key: "contact_name", label: "Contact" }, { key: "phone", label: "Phone" }],
    fields: [{ key: "name", label: "Buyer name", required: true }, { key: "buyer_type", label: "Type", type: "select", required: true, options: ["processor", "flour_mill", "starch_producer", "feed_manufacturer", "wholesaler", "distributor", "cooperative", "other"] }, { key: "status", label: "Pipeline status", type: "select", required: true, default: "lead", options: ["lead", "contacted", "negotiating", "active", "inactive"] },
      { key: "crops", label: "Crops bought", type: "tags", help: "cassava, maize" }, { key: "location", label: "Location" }, { key: "contact_name", label: "Contact person" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email", type: "email" }, { key: "notes", label: "Notes", type: "textarea" }],
  }),
});

reg("prices", {
  title: "Market prices", group: "Sales", label: "Market prices", roles: VIEW,
  async render(el) {
    const since = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
    const rows = ok(await sb.from("market_prices").select("*").gte("price_date", since).order("price_date"));
    const series = ["cassava", "maize"].map((c, i) => {
      const byDate = {}; rows.filter((r) => r.crop === c).forEach((r) => { (byDate[r.price_date] ||= []).push(Number(r.price_per_tonne)); });
      return { name: c, color: i ? "#d98f00" : "#283890", points: Object.entries(byDate).map(([d, v]) => ({ x: d.slice(5), y: v.reduce((a, b) => a + b, 0) / v.length })) };
    }).filter((s) => s.points.length);
    el.innerHTML = `<div class="page"><div class="card" style="margin-bottom:16px"><h3>Average price per tonne, last 120 days</h3>${series.length ? lineChart(series, { zeroLine: false, fmt: (v) => "₦" + Math.round(v / 1000) + "k" }) : '<div class="empty">Log prices below to see the trend.</div>'}</div><div id="list"></div></div>`;
    await crudPage({
      title: "Price log", subtitle: "Record what you see at markets and from buyers each week. The AI market note uses this log.", table: "market_prices", order: [["price_date", false]], create: SALES, edit: SALES, remove: SALES, newLabel: "Log price",
      columns: [{ key: "price_date", label: "Date", type: "date" }, { key: "crop", label: "Crop", type: "badge" }, { key: "market", label: "Market or buyer" }, { key: "price_per_tonne", label: "₦ per tonne", type: "money" }, { key: "source", label: "Source" }],
      fields: [{ key: "price_date", label: "Date", type: "date", required: true, default: today }, { key: "crop", label: "Crop", type: "select", options: ["cassava", "maize", "cassava_flour", "garri", "other"], required: true }, { key: "market", label: "Market or buyer", required: true }, { key: "price_per_tonne", label: "Price per tonne (₦)", type: "number", required: true }, { key: "source", label: "Source", help: "Phone call, market visit, buyer quote" }],
    })(document.getElementById("list"));
  },
});

reg("agreements", {
  title: "Supply agreements", group: "Sales", label: "Agreements", roles: VIEW,
  render: crudPage({
    title: "Supply agreements and pre-harvest sales", subtitle: "Sign buyers before harvest. A daily check warns you if less than 60% of expected cassava is contracted.", table: "supply_agreements", select: "*, buyers(name)", order: [["created_at", false]], create: SALES, edit: SALES, remove: SALES, newLabel: "New agreement",
    filter: { key: "status", label: "statuses", options: ["prospect", "negotiating", "signed", "delivered", "cancelled"] },
    columns: [{ label: "Buyer", get: (r) => r.buyers?.name || "" }, { key: "crop", label: "Crop", type: "badge" }, { key: "qty_tonnes", label: "Tonnes", type: "num", dec: 1 }, { key: "price_per_tonne", label: "₦ / tonne", type: "money" }, { label: "Value", type: "money", get: (r) => Number(r.qty_tonnes) * Number(r.price_per_tonne) }, { label: "Delivery window", get: (r) => `${date(r.delivery_start)} to ${date(r.delivery_end)}` }, { key: "deposit_amount", label: "Deposit", type: "money" }, { key: "status", label: "Status", type: "badge" }],
    fields: [{ key: "buyer_id", label: "Buyer", type: "ref", required: true, ref: { table: "buyers" } }, { key: "crop", label: "Crop", type: "select", options: ["cassava", "maize"], required: true }, { key: "qty_tonnes", label: "Tonnes", type: "number", required: true }, { key: "price_per_tonne", label: "Price per tonne (₦)", type: "number", required: true },
      { key: "delivery_start", label: "Delivery from", type: "date" }, { key: "delivery_end", label: "Delivery to", type: "date" }, { key: "status", label: "Status", type: "select", required: true, default: "prospect", options: ["prospect", "negotiating", "signed", "delivered", "cancelled"] }, { key: "deposit_amount", label: "Deposit received (₦)", type: "number", default: 0 }, { key: "terms", label: "Terms", type: "textarea" }],
    defaults: () => ({ season_id: state.season?.id }),
    actions: [{ label: "Create order", roles: SALES, kind: "good", show: (r) => r.status === "signed", run: async (r, reload) => { ok(await sb.from("sales_orders").insert({ agreement_id: r.id, season_id: r.season_id, buyer_id: r.buyer_id, crop: r.crop, qty_tonnes: r.qty_tonnes, price_per_tonne: r.price_per_tonne })); toast("Order created. Schedule deliveries next.", "ok"); reload(); } }],
  }),
});

reg("orders", {
  title: "Sales orders", group: "Sales", label: "Orders", roles: VIEW,
  render: crudPage({
    title: "Sales orders", table: "sales_orders", select: "*, buyers(name)", order: [["order_date", false]], create: SALES, edit: SALES, remove: SALES, newLabel: "New order",
    columns: [{ key: "order_date", label: "Date", type: "date" }, { label: "Buyer", get: (r) => r.buyers?.name || "" }, { key: "crop", label: "Crop", type: "badge" }, { key: "qty_tonnes", label: "Tonnes", type: "num", dec: 1 }, { key: "price_per_tonne", label: "₦ / tonne", type: "money" }, { key: "amount", label: "Value", type: "money" }, { key: "status", label: "Status", type: "badge" }],
    fields: [{ key: "buyer_id", label: "Buyer", type: "ref", required: true, ref: { table: "buyers" } }, { key: "crop", label: "Crop", type: "select", options: ["cassava", "maize"], required: true }, { key: "qty_tonnes", label: "Tonnes", type: "number", required: true }, { key: "price_per_tonne", label: "Price per tonne (₦)", type: "number", required: true },
      { key: "order_date", label: "Order date", type: "date", default: today, required: true }, { key: "status", label: "Status", type: "select", options: ["open", "delivered", "invoiced", "cancelled"], default: "open", required: true }],
    defaults: () => ({ season_id: state.season?.id }),
  }),
});

reg("deliveries", {
  title: "Deliveries", group: "Sales", label: "Deliveries", roles: ["sales", "ops_manager", "supervisor", "accountant"],
  async render(el) {
    const orders = ok(await sb.from("sales_orders").select("id,crop,qty_tonnes,buyers(name)").neq("status", "cancelled").order("order_date", { ascending: false }));
    const options = orders.map((o) => ({ value: o.id, label: `${o.buyers?.name || "Buyer"} · ${o.crop} · ${o.qty_tonnes} t` }));
    const mk = ["sales", "ops_manager", "supervisor"];
    await crudPage({
      title: "Deliveries", subtitle: "Marking a delivery as delivered creates the invoice automatically for the accountant.", table: "deliveries", select: "*, sales_orders(crop, buyers(name))", order: [["delivery_date", false]], create: mk, edit: mk, remove: ["ops_manager"], newLabel: "Schedule delivery",
      columns: [{ key: "delivery_date", label: "Date", type: "date" }, { label: "Buyer", get: (r) => r.sales_orders?.buyers?.name || "" }, { label: "Crop", get: (r) => r.sales_orders?.crop || "" }, { key: "qty_tonnes", label: "Tonnes", type: "num", dec: 2 }, { key: "vehicle", label: "Vehicle" }, { key: "driver", label: "Driver" }, { key: "status", label: "Status", type: "badge" }],
      fields: [{ key: "order_id", label: "Order", type: "select", options, required: true }, { key: "delivery_date", label: "Date", type: "date", default: today, required: true }, { key: "qty_tonnes", label: "Tonnes delivered", type: "number", required: true }, { key: "vehicle", label: "Vehicle" }, { key: "driver", label: "Driver" },
        { key: "status", label: "Status", type: "select", options: ["scheduled", "in_transit", "delivered", "rejected"], default: "scheduled", required: true }, { key: "notes", label: "Notes", type: "textarea" }],
      actions: [{ label: "Mark delivered", roles: mk, kind: "good", show: (r) => ["scheduled", "in_transit"].includes(r.status), run: async (r, reload) => { ok(await sb.from("deliveries").update({ status: "delivered" }).eq("id", r.id)); toast("Delivered. Invoice created.", "ok"); reload(); } }],
    })(el);
  },
});

import { can } from "./supa.js";

export const routes = {};
export const GROUPS = ["Overview", "Field operations", "Finance", "Sales", "Research", "Admin"];

/** def: { title, roles?, group?, label?, render(el, ctx) } ; group+label put it in the sidebar */
export function reg(path, def) { routes[path] = { path, ...def }; }

export function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const [p, qs] = h.split("?");
  return { path: p || "dashboard", params: Object.fromEntries(new URLSearchParams(qs || "")) };
}
export const go = (p) => { location.hash = "#/" + p; };

export function navTree() {
  const tree = GROUPS.map((g) => ({ group: g, items: [] }));
  Object.values(routes).forEach((r) => {
    if (!r.group || !can(r.roles)) return;
    tree.find((t) => t.group === r.group)?.items.push(r);
  });
  return tree.filter((t) => t.items.length);
}

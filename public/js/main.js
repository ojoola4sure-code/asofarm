import { sb, configured, state, ok, rpc, can, role, ROLE_LABEL, currentSeason } from "./supa.js";
import { $, $$, esc, toast, fail } from "./ui.js";
import { routes, navTree, parseHash, go } from "./router.js";
import "./pages/dashboard.js";
import "./pages/operations.js";
import "./pages/finance.js";
import "./pages/accounting.js";
import "./pages/sales.js";
import "./pages/research.js";
import "./pages/platform.js";
import "./pages/public-admin.js";

const app = document.getElementById("app");
const MARK = `<svg width="38" height="38" viewBox="0 0 64 64" aria-hidden="true"><path d="M0 64 28 0h14L14 64z" fill="#fff"></path><path d="M32 64 50 22l14 42z" fill="#FFCC00"></path></svg>`;

function setupNeeded() {
  app.innerHTML = `<div class="login"><div class="form-side"><div style="max-width:460px"><h2>Connect Supabase</h2>
    <p>This site has no Supabase settings yet. In Netlify, add the environment variables <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code>, then redeploy. The build step writes them into <code>public/js/config.js</code>.</p></div></div></div>`;
}

function renderLogin(msg = "") {
  app.innerHTML = `<div class="login"><div class="art"><div class="brand">${MARK}<div><b>ASO</b><small>FARM</small></div></div>
    <div><h1>Run the whole season from one place.</h1><p>Land preparation to post-harvest, the money behind it, and the people doing it, in one system.</p></div>
    <div class="stripe"></div><small style="color:#9fa9e0">An ASO INOVISION product</small></div>
    <div class="form-side"><form id="lf"><h2>Sign in</h2><div class="field"><label for="em">Work email</label><input id="em" type="email" autocomplete="username" placeholder="name@asofarm.com" required></div>
    <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required></div>
    <div class="err" id="le">${esc(msg)}</div><button class="btn" type="submit">Sign in</button>
    <p class="muted small">Forgot your password? Ask the admin to reset it.</p><p class="small"><a href="/invest">Investors and supporters: view the farm plan</a></p></form></div></div>`;
  $("#lf").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("button", e.target); btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: $("#em").value.trim(), password: $("#pw").value });
    if (error) { $("#le").textContent = error.message; btn.disabled = false; }
  };
}

function renderNoRole() {
  app.innerHTML = `<div class="login"><div class="form-side"><div style="max-width:440px"><h2>No role assigned</h2><p>Your account exists but has no role yet. Ask the admin to assign one.</p>
    <button class="btn alt" id="so">Sign out</button></div></div></div>`;
  $("#so").onclick = () => sb.auth.signOut();
}

function renderForcePassword() {
  app.innerHTML = `<div class="login"><div class="form-side"><form id="pf"><h2>Choose your own password</h2>
    <p class="muted">Your account started with a shared starter password. Set a private one to continue.</p>
    <div class="field"><label for="p1">New password (10+ characters)</label><input id="p1" type="password" minlength="10" autocomplete="new-password" required></div>
    <div class="field"><label for="p2">Repeat new password</label><input id="p2" type="password" minlength="10" autocomplete="new-password" required></div>
    <div class="err" id="pe"></div><button class="btn" type="submit">Save and continue</button></form></div></div>`;
  $("#pf").onsubmit = async (e) => {
    e.preventDefault();
    const a = $("#p1").value, b = $("#p2").value;
    if (a !== b) return ($("#pe").textContent = "The two passwords do not match.");
    if (a === "labalaba@2019") return ($("#pe").textContent = "Pick a different password from the starter one.");
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) return ($("#pe").textContent = error.message);
    try { await rpc("complete_password_change"); } catch (err) { return ($("#pe").textContent = err.message); }
    state.profile.must_change_password = false;
    boot();
  };
}

async function unreadCount() {
  const { count } = await sb.from("notifications").select("id", { count: "exact", head: true }).not("read_by", "cs", `{${state.user.id}}`);
  return count || 0;
}

async function refreshBell() {
  try {
    const n = await unreadCount();
    $$("[data-bell]").forEach((b) => (b.textContent = n || ""));
    $$("[data-bell]").forEach((b) => (b.style.display = n ? "" : "none"));
  } catch { /* ignore */ }
}

function renderShell() {
  const tree = navTree();
  app.innerHTML = `<div class="shell"><aside class="side" id="side"><div class="brand">${MARK}<div><b>ASO</b><small>FARM</small></div></div>
    ${tree.map((g) => `<div class="nav-group"><h4>${esc(g.group)}</h4>${g.items.map((r) => `<a class="nav-item" href="#/${r.path}" data-nav="${r.path}"><span>${esc(r.label)}</span>${r.path === "notifications" ? `<span class="nav-count" data-bell style="display:none"></span>` : ""}</a>`).join("")}</div>`).join("")}</aside>
    <div class="main"><header class="top"><button class="btn alt sm menu-btn" id="menu" aria-label="Menu">Menu</button><h1 id="title"></h1>
      <span class="chip" id="seasonchip"></span><a class="bell" href="#/notifications" title="Alerts" aria-label="Alerts">&#128276;<span class="nav-count" data-bell style="display:none"></span></a>
      <div class="userbox"><b>${esc(state.profile.full_name || state.user.email)}</b><span>${esc(ROLE_LABEL[role()] || "")}</span></div><button class="btn alt sm" id="signout">Sign out</button></header>
      <main id="view"></main></div></div>`;
  $("#menu").onclick = () => $("#side").classList.toggle("open");
  $("#signout").onclick = () => sb.auth.signOut();
  const s = state.season;
  $("#seasonchip").textContent = s ? `${s.name.split(":")[0]} · ${s.acres} acres` : "No season";
  if (!s) $("#seasonchip").style.display = "none";
}

let renderToken = 0;
async function renderRoute() {
  const { path, params } = parseHash();
  const r = routes[path] || routes.dashboard;
  const token = ++renderToken;
  const view = $("#view");
  if (!view) return;
  if (!can(r.roles)) { view.innerHTML = `<div class="page"><div class="alert bad">Your role cannot open this page.</div></div>`; return; }
  $$("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === r.path));
  $("#title").textContent = r.title;
  document.title = `${r.title} · ASO FARM`;
  $("#side")?.classList.remove("open");
  view.innerHTML = `<div class="page"><div class="empty">Loading…</div></div>`;
  try {
    await r.render(view, { params, go, refreshBell });
  } catch (e) {
    if (token === renderToken) view.innerHTML = `<div class="page"><div class="alert bad">${esc(e.message || e)}</div></div>`;
  }
  window.scrollTo(0, 0);
}

let booted = false, poll;
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { renderLogin(); return; }
  state.user = session.user;
  const { data: profile, error } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  if (error || !profile) { renderLogin("Could not load your profile. " + (error?.message || "")); await sb.auth.signOut(); return; }
  if (!profile.active) { renderLogin("This account is switched off."); await sb.auth.signOut(); return; }
  state.profile = profile;
  if (!profile.role) return renderNoRole();
  if (profile.must_change_password) return renderForcePassword();
  await currentSeason(true).catch(() => null);
  renderShell();
  refreshBell();
  clearInterval(poll); poll = setInterval(refreshBell, 60000);
  if (!booted) { window.addEventListener("hashchange", renderRoute); booted = true; }
  if (!location.hash) location.hash = "#/dashboard";
  renderRoute();
}

if (!configured) setupNeeded();
else {
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") { state.user = null; state.profile = null; state.season = null; clearInterval(poll); renderLogin(); }
    if (event === "SIGNED_IN" && session?.user?.id !== state.user?.id) boot();
  });
  boot();
}

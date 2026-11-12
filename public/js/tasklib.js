import { sb, ok, can } from "./supa.js";
import { esc, date, badge, $$, fail, toast } from "./ui.js";
import { ROLE_LABEL } from "./supa.js";

const OPTIONS = [
  ["todo", "Not started"], ["p25", "25%"], ["p50", "50%"], ["p75", "75%"], ["done", "Done"], ["blocked", "Blocked"],
];

export function taskKey(t) {
  if (t.status === "done") return "done";
  if (t.status === "blocked") return "blocked";
  if (t.progress >= 75) return "p75";
  if (t.progress >= 50) return "p50";
  if (t.progress >= 25) return "p25";
  return t.status === "in_progress" ? "p25" : "todo";
}

const PATCH = {
  todo: { status: "todo", progress: 0 }, p25: { status: "in_progress", progress: 25 }, p50: { status: "in_progress", progress: 50 },
  p75: { status: "in_progress", progress: 75 }, done: { status: "done", progress: 100 }, blocked: { status: "blocked" },
};

export function canEditTask(t, me) {
  return can(["ops_manager", "supervisor"]) || t.assignee_id === me.id || t.assignee_role === me.role;
}

export function taskTableHtml(tasks, me, { showStage = true } = {}) {
  if (!tasks.length) return `<div class="empty">No tasks.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Task</th>${showStage ? "<th>Stage</th>" : ""}<th>For</th><th>Due</th><th>Progress</th></tr></thead><tbody>
    ${tasks.map((t) => `<tr><td>${esc(t.title)}${t.priority === "critical" || t.priority === "high" ? ` ${badge(t.priority)}` : ""}</td>
      ${showStage ? `<td class="muted small">${esc(t.stage_name || "")}</td>` : ""}
      <td class="small">${esc(t.assignee_name || ROLE_LABEL[t.assignee_role] || "")}</td>
      <td class="${t.days_overdue > 0 ? "" : ""}">${date(t.due_date)}${t.days_overdue > 0 ? ` <span class="badge bad">${t.days_overdue}d late</span>` : ""}</td>
      <td>${canEditTask(t, me)
        ? `<select class="mini" data-task="${t.id}">${OPTIONS.map(([v, l]) => `<option value="${v}" ${taskKey(t) === v ? "selected" : ""}>${l}</option>`).join("")}</select>`
        : badge(t.status)}</td></tr>`).join("")}</tbody></table></div>`;
}

export function bindTaskControls(root, onChange) {
  $$("[data-task]", root).forEach((s) => s.addEventListener("change", async () => {
    try {
      ok(await sb.from("tasks").update(PATCH[s.value]).eq("id", s.dataset.task));
      toast("Task updated", "ok");
      if (onChange) onChange();
    } catch (e) { fail(e); }
  }));
}

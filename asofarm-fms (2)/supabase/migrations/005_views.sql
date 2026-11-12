-- 005: views (security_invoker so row level security applies to the caller)

create or replace view v_stage_gantt with (security_invoker = true) as
select s.*,
  (select count(*) from tasks t where t.stage_id = s.id) as tasks_total,
  (select count(*) from tasks t where t.stage_id = s.id and t.status = 'done') as tasks_done,
  (select count(*) from tasks t where t.stage_id = s.id and t.status <> 'done' and t.due_date < current_date) as tasks_overdue
from stages s;

create or replace view v_tasks with (security_invoker = true) as
select t.*, st.name as stage_name, st.seq as stage_seq, st.crop as stage_crop,
       p.full_name as assignee_name,
       case when t.status <> 'done' and t.due_date < current_date then current_date - t.due_date else 0 end as days_overdue
from tasks t left join stages st on st.id = t.stage_id left join profiles p on p.id = t.assignee_id;

create or replace view v_budget_vs_actual with (security_invoker = true) as
select q.*, q.budget - q.spent - q.committed as remaining,
       case when q.budget > 0 then round((q.spent + q.committed) / q.budget * 100, 1) else 0 end as pct_used
from (
  select b.id, b.season_id, b.phase, b.stage_id, st.seq as stage_seq, st.name as stage_name, st.crop,
         b.category_id, c.name as category, c.grp, c.is_management, b.description, b.amount as budget, b.planned_date,
         coalesce(sum(t.amount) filter (where t.status = 'paid'), 0) as spent,
         coalesce(sum(t.amount) filter (where t.status in ('approved','pending_approval')), 0) as committed
  from budget_lines b
  join expense_categories c on c.id = b.category_id
  left join stages st on st.id = b.stage_id
  left join transactions t on t.budget_line_id = b.id
  group by b.id, st.seq, st.name, st.crop, c.name, c.grp, c.is_management
) q;

create or replace view v_phase_targets_vs_actual with (security_invoker = true) as
select p.id, p.phase, p.grp, p.label, p.target_amount, p.notes,
  coalesce((select sum(t.amount) from transactions t
            join seasons s on s.id = t.season_id
            join expense_categories c on c.id = t.category_id
            where s.phase = p.phase and t.kind = 'expense' and t.status = 'paid'
              and (p.grp = 'total'
                   or (p.grp = 'management' and c.is_management)
                   or (p.grp = 'field' and not c.is_management))), 0) as spent,
  coalesce((select sum(t.amount) from transactions t
            join seasons s on s.id = t.season_id
            join expense_categories c on c.id = t.category_id
            where s.phase = p.phase and t.kind = 'expense' and t.status in ('approved','pending_approval')
              and (p.grp = 'total'
                   or (p.grp = 'management' and c.is_management)
                   or (p.grp = 'field' and not c.is_management))), 0) as committed
from phase_targets p;

create or replace view v_transactions with (security_invoker = true) as
select t.*, c.name as category_name, c.grp as category_grp, st.name as stage_name, b.name as block_name,
       rp.full_name as requester_name, ap.full_name as approver_name, ba.name as bank_name
from transactions t
left join expense_categories c on c.id = t.category_id
left join stages st on st.id = t.stage_id
left join blocks b on b.id = t.block_id
left join profiles rp on rp.id = t.requested_by
left join profiles ap on ap.id = t.approved_by
left join bank_accounts ba on ba.id = t.bank_account_id;

create or replace view v_receivables with (security_invoker = true) as
select i.*, b.name as buyer_name,
       coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id), 0) as paid,
       i.amount - coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id), 0) as outstanding,
       case when i.status in ('issued','part_paid','overdue') and i.due_date < current_date then current_date - i.due_date else 0 end as days_overdue
from invoices i left join buyers b on b.id = i.buyer_id;

create or replace view v_yield_by_block with (security_invoker = true) as
select y.*, b.name as block_name,
       round(y.fresh_weight_kg / y.sample_area_m2 * 4046.86 / 1000, 2) as tonnes_per_acre
from yield_samples y left join blocks b on b.id = y.block_id;

create or replace view v_attendance_summary with (security_invoker = true) as
select a.employee_id, e.full_name, e.kind, date_trunc('month', a.work_date)::date as month,
       sum(a.days) as days_worked, sum(a.days * coalesce(a.rate, e.daily_rate)) as wages
from attendance a join employees e on e.id = a.employee_id
group by a.employee_id, e.full_name, e.kind, date_trunc('month', a.work_date);

create or replace view v_inventory with (security_invoker = true) as
select i.*, (i.reorder_level > 0 and i.qty_on_hand <= i.reorder_level) as low
from inventory_items i;

-- 003: row level security, storage and grants
-- Admin passes every has_role() check. Policies are the real security layer;
-- the web app also hides pages a role cannot use.

create or replace function _rls(p_table text, p_read app_role[], p_write app_role[], p_all_read boolean default false)
returns void language plpgsql as $$
declare v_read text; v_write text;
begin
  execute format('alter table %I enable row level security', p_table);
  execute format('drop policy if exists p_select on %I', p_table);
  execute format('drop policy if exists p_write on %I', p_table);
  if p_all_read then v_read := 'public.is_staff()';
  else v_read := format('public.has_role(%L::app_role[])', p_read::text); end if;
  execute format('create policy p_select on %I for select to authenticated using (%s)', p_table, v_read);
  if p_write is not null then
    v_write := format('public.has_role(%L::app_role[])', p_write::text);
    execute format('create policy p_write on %I for all to authenticated using (%s) with check (%s)', p_table, v_write, v_write);
  end if;
end $$;

-- readable by every active staff member
select _rls('seasons', null, array[]::app_role[], true);
select _rls('blocks', null, array['ops_manager']::app_role[], true);
select _rls('stages', null, array['ops_manager']::app_role[], true);
select _rls('stage_templates', null, array[]::app_role[], true);
select _rls('task_templates', null, array[]::app_role[], true);
select _rls('budget_templates', null, array[]::app_role[], true);
select _rls('revenue_templates', null, array[]::app_role[], true);
select _rls('responsibilities', null, array[]::app_role[], true);
select _rls('field_logs', null, array['ops_manager','supervisor']::app_role[], true);
select _rls('sops', null, array['ops_manager']::app_role[], true);
select _rls('risks', null, array['ops_manager','supervisor']::app_role[], true);
select _rls('incidents', null, array['ops_manager','supervisor','research']::app_role[], true);
select _rls('compliance_checks', null, array['ops_manager','supervisor']::app_role[], true);
select _rls('weather_readings', null, array['research']::app_role[], true);
select _rls('soil_samples', null, array['ops_manager','supervisor','research']::app_role[], true);
select _rls('crop_observations', null, array['ops_manager','supervisor','research']::app_role[], true);
select _rls('disease_cases', null, array['ops_manager','supervisor','research']::app_role[], true);
select _rls('yield_samples', null, array['ops_manager','supervisor','research']::app_role[], true);
select _rls('tech_pilots', null, array['ops_manager','research']::app_role[], true);
select _rls('research_notes', null, array['ops_manager','research']::app_role[], true);
select _rls('market_prices', null, array['sales','ops_manager']::app_role[], true);
select _rls('expense_categories', null, array['accountant']::app_role[], true);

-- operations
select _rls('suppliers', array['ops_manager','supervisor','accountant']::app_role[], array['ops_manager']::app_role[]);
select _rls('inventory_items', array['ops_manager','supervisor','accountant']::app_role[], array['ops_manager']::app_role[]);
select _rls('stock_moves', array['ops_manager','supervisor','accountant']::app_role[], array['ops_manager','supervisor']::app_role[]);
select _rls('attendance', array['ops_manager','supervisor','accountant']::app_role[], array['ops_manager','supervisor']::app_role[]);

-- sales
select _rls('buyers', array['sales','ops_manager','accountant']::app_role[], array['sales','ops_manager']::app_role[]);
select _rls('supply_agreements', array['sales','ops_manager','accountant']::app_role[], array['sales','ops_manager']::app_role[]);
select _rls('sales_orders', array['sales','ops_manager','accountant']::app_role[], array['sales','ops_manager']::app_role[]);
select _rls('deliveries', array['sales','ops_manager','accountant','supervisor']::app_role[], array['sales','ops_manager','supervisor']::app_role[]);
select _rls('revenue_plan', array['accountant','ops_manager','sales']::app_role[], array['accountant']::app_role[]);

-- finance
select _rls('accounts', array['accountant','ops_manager']::app_role[], array['accountant']::app_role[]);
select _rls('bank_accounts', array['accountant','ops_manager']::app_role[], array['accountant']::app_role[]);
select _rls('budget_lines', array['accountant','ops_manager','supervisor','sales']::app_role[], array['accountant','ops_manager']::app_role[]);
select _rls('phase_targets', array['accountant','ops_manager']::app_role[], array['accountant']::app_role[]);
select _rls('approval_rules', array['accountant','ops_manager']::app_role[], array[]::app_role[]);
select _rls('journal_entries', array['accountant','ops_manager']::app_role[], null);
select _rls('journal_lines', array['accountant','ops_manager']::app_role[], null);
select _rls('invoices', array['accountant','ops_manager','sales']::app_role[], array['accountant']::app_role[]);
select _rls('payments', array['accountant','ops_manager','sales']::app_role[], array['accountant']::app_role[]);
select _rls('bank_statement_lines', array['accountant']::app_role[], array['accountant']::app_role[]);
select _rls('payroll_runs', array['accountant','ops_manager']::app_role[], array['accountant']::app_role[]);
select _rls('payroll_items', array['accountant','ops_manager']::app_role[], array['accountant']::app_role[]);
select _rls('assets', array['accountant','ops_manager','supervisor']::app_role[], array['accountant','ops_manager']::app_role[]);
select _rls('tax_items', array['accountant','ops_manager']::app_role[], array['accountant']::app_role[]);
select _rls('tax_filings', array['accountant','ops_manager']::app_role[], array['accountant']::app_role[]);
select _rls('financial_snapshots', array['accountant','ops_manager']::app_role[], null);
select _rls('audit_log', array['accountant']::app_role[], null);
select _rls('automation_runs', array[]::app_role[], null);

-- ---------------------------------------------------------------- custom policies
-- profiles
alter table profiles enable row level security;
drop policy if exists profiles_select on profiles;
drop policy if exists profiles_update_own on profiles;
create policy profiles_select on profiles for select to authenticated using (is_staff() or id = auth.uid());
create policy profiles_update_own on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on profiles from authenticated;
grant update (full_name, phone) on profiles to authenticated;

-- tasks
alter table tasks enable row level security;
drop policy if exists tasks_select on tasks;
drop policy if exists tasks_insert on tasks;
drop policy if exists tasks_update on tasks;
drop policy if exists tasks_delete on tasks;
create policy tasks_select on tasks for select to authenticated using (is_staff());
create policy tasks_insert on tasks for insert to authenticated with check (has_role(array['ops_manager','supervisor']::app_role[]));
create policy tasks_update on tasks for update to authenticated
  using (has_role(array['ops_manager','supervisor']::app_role[]) or assignee_id = auth.uid() or assignee_role = auth_role())
  with check (has_role(array['ops_manager','supervisor']::app_role[]) or assignee_id = auth.uid() or assignee_role = auth_role());
create policy tasks_delete on tasks for delete to authenticated using (has_role(array['ops_manager']::app_role[]));

-- procurement
alter table procurement_orders enable row level security;
drop policy if exists po_select on procurement_orders;
drop policy if exists po_insert on procurement_orders;
drop policy if exists po_update on procurement_orders;
drop policy if exists po_delete on procurement_orders;
create policy po_select on procurement_orders for select to authenticated using (has_role(array['ops_manager','supervisor','accountant']::app_role[]));
create policy po_insert on procurement_orders for insert to authenticated with check (has_role(array['ops_manager','supervisor']::app_role[]) and requested_by = auth.uid());
create policy po_update on procurement_orders for update to authenticated using (has_role(array['ops_manager']::app_role[])) with check (has_role(array['ops_manager']::app_role[]));
create policy po_delete on procurement_orders for delete to authenticated using (has_role(array['ops_manager']::app_role[]));

-- employees (salary data stays with finance and the manager)
alter table employees enable row level security;
drop policy if exists emp_select on employees;
drop policy if exists emp_insert on employees;
drop policy if exists emp_update on employees;
drop policy if exists emp_delete on employees;
create policy emp_select on employees for select to authenticated using (has_role(array['accountant','ops_manager']::app_role[]));
create policy emp_insert on employees for insert to authenticated
  with check (has_role(array['accountant','ops_manager']::app_role[]) or (has_role(array['supervisor']::app_role[]) and kind = 'casual'));
create policy emp_update on employees for update to authenticated using (has_role(array['accountant','ops_manager']::app_role[])) with check (has_role(array['accountant','ops_manager']::app_role[]));
create policy emp_delete on employees for delete to authenticated using (has_role(array['accountant']::app_role[]));

create or replace view v_employee_directory as
  select id, full_name, kind, role_title, active from employees where public.is_staff();
grant select on v_employee_directory to authenticated;

-- transactions: status changes only through RPCs, never by direct update
alter table transactions enable row level security;
drop policy if exists txn_select on transactions;
drop policy if exists txn_insert on transactions;
drop policy if exists txn_update on transactions;
drop policy if exists txn_delete on transactions;
create policy txn_select on transactions for select to authenticated
  using (has_role(array['accountant','ops_manager']::app_role[]) or requested_by = auth.uid());
create policy txn_insert on transactions for insert to authenticated
  with check (has_role(array['accountant','ops_manager','supervisor','sales']::app_role[]) and requested_by = auth.uid()
              and (status in ('draft','submitted')
                   or (status = 'paid' and kind in ('income','capital') and has_role(array['accountant']::app_role[]))));
create policy txn_update on transactions for update to authenticated
  using (has_role(array['accountant']::app_role[]) or (requested_by = auth.uid() and status in ('draft','rejected')))
  with check (has_role(array['accountant']::app_role[]) or requested_by = auth.uid());
create policy txn_delete on transactions for delete to authenticated
  using (status = 'draft' and (requested_by = auth.uid() or has_role(array[]::app_role[])));
revoke update on transactions from authenticated;
grant update (txn_date, kind, category_id, income_account_id, stage_id, block_id, budget_line_id, bank_account_id, payee, description, amount, reference, receipt_path) on transactions to authenticated;

create or replace function submit_transaction(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t transactions;
begin
  select * into t from transactions where id = p_id for update;
  if t.id is null then raise exception 'Not found'; end if;
  if t.requested_by <> auth.uid() and not has_role(array['accountant']::app_role[]) then raise exception 'Only the requester or the accountant can submit'; end if;
  if t.status not in ('draft','rejected') then raise exception 'Only drafts or rejected requests can be submitted'; end if;
  update transactions set status = 'submitted', approval_note = null where id = p_id;
end $$;

-- reports
alter table reports enable row level security;
drop policy if exists rep_select on reports;
drop policy if exists rep_insert on reports;
drop policy if exists rep_delete on reports;
create policy rep_select on reports for select to authenticated using (has_role(array[]::app_role[]) or auth_role() = any(audience));
create policy rep_insert on reports for insert to authenticated
  with check (has_role(array['ops_manager','accountant','sales','research']::app_role[]) and created_by = auth.uid());
create policy rep_delete on reports for delete to authenticated using (has_role(array[]::app_role[]));

-- notifications
alter table notifications enable row level security;
drop policy if exists notif_select on notifications;
create policy notif_select on notifications for select to authenticated using (to_user = auth.uid() or to_role = auth_role());

-- documents
alter table documents enable row level security;
drop policy if exists doc_select on documents;
drop policy if exists doc_insert on documents;
drop policy if exists doc_delete on documents;
create policy doc_select on documents for select to authenticated using (has_role(array['accountant','ops_manager']::app_role[]) or uploaded_by = auth.uid());
create policy doc_insert on documents for insert to authenticated with check (is_staff() and uploaded_by = auth.uid());
create policy doc_delete on documents for delete to authenticated using (has_role(array['accountant']::app_role[]));

-- settings
alter table app_settings enable row level security;
drop policy if exists set_select on app_settings;
drop policy if exists set_write on app_settings;
create policy set_select on app_settings for select to authenticated using ((not is_secret and is_staff()) or has_role(array[]::app_role[]));
create policy set_write on app_settings for all to authenticated using (has_role(array[]::app_role[])) with check (has_role(array[]::app_role[]));

-- ---------------------------------------------------------------- storage
insert into storage.buckets(id, name, public) values ('documents', 'documents', false), ('field-photos', 'field-photos', false)
on conflict (id) do nothing;

drop policy if exists "fms upload" on storage.objects;
drop policy if exists "fms read" on storage.objects;
drop policy if exists "fms delete" on storage.objects;
create policy "fms upload" on storage.objects for insert to authenticated
  with check (bucket_id in ('documents','field-photos') and public.is_staff());
create policy "fms read" on storage.objects for select to authenticated
  using ((bucket_id = 'field-photos' and public.is_staff())
      or (bucket_id = 'documents' and (public.has_role(array['accountant','ops_manager']::app_role[]) or owner = auth.uid())));
create policy "fms delete" on storage.objects for delete to authenticated
  using (bucket_id in ('documents','field-photos') and (owner = auth.uid() or public.has_role(array['accountant']::app_role[])));

-- ---------------------------------------------------------------- manual runs
create or replace function run_daily_now() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role(array[]::app_role[]) then raise exception 'Admins only'; end if;
  perform job_daily();
end $$;

create or replace function run_month_end_now() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role(array['accountant']::app_role[]) then raise exception 'Accountant or admin only'; end if;
  perform job_month_end();
end $$;

create or replace function run_weekly_report_now() returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not has_role(array['ops_manager','accountant']::app_role[]) then raise exception 'Not allowed'; end if;
  return generate_basic_report('weekly');
end $$;

create or replace function run_finance_report_now() returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not has_role(array['accountant']::app_role[]) then raise exception 'Not allowed'; end if;
  return generate_basic_report('monthly');
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
-- internal helpers that must never be called from the browser
revoke execute on function post_journal(date, text, text, uuid, uuid, jsonb) from authenticated;
revoke execute on function notify(app_role, uuid, text, text, text, text, text) from authenticated;
revoke execute on function internal_generate_season(uuid, date) from authenticated;
revoke execute on function job_daily() from authenticated;
revoke execute on function job_weekly() from authenticated;
revoke execute on function job_month_end() from authenticated;
revoke execute on function run_depreciation(date) from authenticated;
revoke execute on function refresh_stage_progress(uuid) from authenticated;
revoke execute on function generate_tax_filings(date) from authenticated;
revoke execute on function dashboard_core(uuid, boolean) from authenticated;
revoke execute on function generate_basic_report(text) from authenticated;
revoke execute on function _rls(text, app_role[], app_role[], boolean) from authenticated;

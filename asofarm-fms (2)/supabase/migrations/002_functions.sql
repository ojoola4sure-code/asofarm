-- 002: helper functions, triggers and RPCs

-- ============================================================ helpers
create or replace function auth_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

create or replace function has_role(roles app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles
                 where id = auth.uid() and active and (role = 'admin' or role = any(roles)))
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and role is not null)
$$;

create or replace function acct(p_code text) returns uuid
language sql stable as $$ select id from accounts where code = p_code $$;

create or replace function current_season() returns uuid
language sql stable security definer set search_path = public as $$
  select id from seasons order by (status = 'active') desc, start_date desc limit 1
$$;

create or replace function setting_num(p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(value #>> '{}', '')::numeric from app_settings where key = p_key), p_default)
$$;

create or replace function notify(p_role app_role, p_user uuid, p_title text, p_body text,
                                  p_link text default null, p_level text default 'info',
                                  p_dedupe text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications(to_role, to_user, title, body, link, level, dedupe_key)
  values (p_role, p_user, p_title, p_body, p_link, p_level, p_dedupe)
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
end $$;

create or replace function fmt_money(p numeric) returns text
language sql immutable as $$ select 'N' || to_char(round(coalesce(p,0)), 'FM999,999,999,999') $$;

-- ============================================================ users
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role app_role;
begin
  begin v_role := (new.raw_app_meta_data ->> 'role')::app_role;
  exception when others then v_role := null; end;
  insert into profiles(id, email, full_name, role)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)), v_role)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create or replace function complete_password_change() returns void
language sql security definer set search_path = public as $$
  update profiles set must_change_password = false where id = auth.uid()
$$;

create or replace function admin_update_user(p_id uuid, p_role app_role, p_active boolean, p_full_name text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth_role() <> 'admin' then raise exception 'Admins only'; end if;
  update profiles set role = p_role, active = p_active, full_name = coalesce(p_full_name, full_name) where id = p_id;
end $$;

create or replace function mark_notifications_read(p_ids uuid[] default null) returns void
language sql security definer set search_path = public as $$
  update notifications set read_by = array_append(read_by, auth.uid())
  where not (auth.uid() = any(read_by))
    and (to_user = auth.uid() or to_role = auth_role())
    and (p_ids is null or id = any(p_ids))
$$;

-- ============================================================ audit
create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_row jsonb;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into audit_log(table_name, record_id, action, old_data, new_data, user_id)
  values (tg_table_name, v_row ->> 'id', tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
          auth.uid());
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['transactions','journal_entries','journal_lines','invoices','payments',
    'payroll_runs','payroll_items','assets','budget_lines','phase_targets','profiles','employees',
    'approval_rules','bank_statement_lines','tax_filings','seasons','supply_agreements','sales_orders']
  loop
    execute format('drop trigger if exists audit_%1$s on %1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I for each row execute function audit_row()', t);
  end loop;
end $$;

-- ============================================================ journal
create or replace function post_journal(p_date date, p_memo text, p_source_type text, p_source_id uuid,
                                        p_season uuid, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; l jsonb; v_acct uuid; v_d numeric; v_c numeric;
begin
  insert into journal_entries(entry_date, memo, source_type, source_id, season_id)
  values (p_date, p_memo, p_source_type, p_source_id, p_season) returning id into v_id;
  for l in select value from jsonb_array_elements(p_lines) loop
    v_d := coalesce((l ->> 'debit')::numeric, 0);
    v_c := coalesce((l ->> 'credit')::numeric, 0);
    continue when v_d = 0 and v_c = 0;
    v_acct := coalesce(nullif(l ->> 'account_id', '')::uuid, acct(l ->> 'code'));
    if v_acct is null then raise exception 'Unknown account %', coalesce(l ->> 'code', l ->> 'account_id'); end if;
    insert into journal_lines(entry_id, account_id, debit, credit, stage_id, block_id, memo)
    values (v_id, v_acct, round(v_d, 2), round(v_c, 2),
            nullif(l ->> 'stage_id', '')::uuid, nullif(l ->> 'block_id', '')::uuid, l ->> 'memo');
  end loop;
  return v_id;
end $$;

create or replace function check_entry_balanced() returns trigger
language plpgsql as $$
declare v_entry uuid; v_d numeric; v_c numeric;
begin
  v_entry := case when tg_op = 'DELETE' then old.entry_id else new.entry_id end;
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_d, v_c from journal_lines where entry_id = v_entry;
  if round(v_d, 2) <> round(v_c, 2) then
    raise exception 'Journal entry % is not balanced (debit %, credit %)', v_entry, v_d, v_c;
  end if;
  return null;
end $$;

drop trigger if exists journal_balanced on journal_lines;
create constraint trigger journal_balanced after insert or update or delete on journal_lines
  deferrable initially deferred for each row execute function check_entry_balanced();

create or replace function reverse_journal(p_entry uuid, p_memo text default 'Reversal') returns uuid
language plpgsql security definer set search_path = public as $$
declare e journal_entries; v_new uuid;
begin
  if auth.uid() is not null and not has_role(array['accountant']::app_role[]) then
    raise exception 'Only the accountant can reverse entries';
  end if;
  select * into e from journal_entries where id = p_entry;
  if e.id is null then raise exception 'Entry not found'; end if;
  insert into journal_entries(entry_date, memo, source_type, source_id, season_id)
  values (current_date, p_memo || ' of ' || coalesce(e.memo, p_entry::text), 'reversal', p_entry, e.season_id)
  returning id into v_new;
  insert into journal_lines(entry_id, account_id, debit, credit, stage_id, block_id, memo)
  select v_new, account_id, credit, debit, stage_id, block_id, memo from journal_lines where entry_id = p_entry;
  return v_new;
end $$;

create or replace function post_manual_journal(p_date date, p_memo text, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not has_role(array['accountant']::app_role[]) then raise exception 'Only the accountant can post journals'; end if;
  return post_journal(p_date, p_memo, 'manual', null, current_season(), p_lines);
end $$;

-- ============================================================ budgets
create or replace function budget_line_remaining(p_line uuid, p_exclude uuid default null) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select amount from budget_lines where id = p_line), 0)
       - coalesce((select sum(amount) from transactions
                   where budget_line_id = p_line
                     and status in ('pending_approval','approved','paid')
                     and (p_exclude is null or id <> p_exclude)), 0)
$$;

-- ============================================================ transactions: routing + posting
create or replace function transactions_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_limit numeric; v_rem numeric; v_role app_role; v_ba bank_accounts; v_cat expense_categories;
  v_date date; v_acct uuid; v_lines jsonb; v_asset uuid;
begin
  if tg_op = 'UPDATE' and old.status = 'paid' then
    if new.amount <> old.amount or new.kind <> old.kind
       or new.category_id is distinct from old.category_id
       or new.bank_account_id is distinct from old.bank_account_id then
      raise exception 'Paid transactions cannot be changed. Post a correcting entry instead.';
    end if;
  end if;

  if new.season_id is null then new.season_id := current_season(); end if;
  if tg_op = 'INSERT' then
    new.journal_entry_id := null; new.asset_id := null; new.approved_by := null; new.required_role := null;
    new.paid_at := case when new.status = 'paid' then coalesce(new.paid_at, new.txn_date) else null end;
  end if;

  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    if new.kind in ('income','capital') then
      new.status := 'approved'; new.approved_at := now();
      new.approval_note := 'Receipts need no approval';
    else
      v_limit := setting_num('auto_approve_limit', 0);
      if new.budget_line_id is not null then v_rem := budget_line_remaining(new.budget_line_id, new.id); end if;
      if v_limit > 0 and new.amount <= v_limit and new.budget_line_id is not null and v_rem >= new.amount then
        new.status := 'approved'; new.approved_at := now();
        new.approval_note := 'Auto-approved: under limit and within budget';
      else
        select approver_role into v_role from approval_rules
        where new.amount >= min_amount and (max_amount is null or new.amount <= max_amount)
        order by min_amount limit 1;
        if new.budget_line_id is not null and v_rem < new.amount then
          v_role := 'admin'; new.approval_note := 'Over budget line: admin approval needed';
        end if;
        new.required_role := coalesce(v_role, 'admin');
        new.status := 'pending_approval';
        perform notify(new.required_role, null, 'Expense awaiting approval',
          coalesce(new.payee, '') || ' ' || coalesce(new.description, '') || ' (' || fmt_money(new.amount) || ')',
          '#/approvals', 'warning', 'txn-pending:' || new.id);
      end if;
    end if;
    if new.status = 'approved' and new.kind in ('expense','asset_purchase') then
      perform notify('accountant', null, 'Approved expense ready to pay',
        coalesce(new.payee, '') || ' ' || coalesce(new.description, '') || ' (' || fmt_money(new.amount) || ')',
        '#/expenses', 'info', 'txn-ready:' || new.id);
    end if;
  end if;

  if new.status = 'paid' and new.journal_entry_id is null then
    if new.bank_account_id is null then raise exception 'Choose the bank or cash account used for this payment.'; end if;
    select * into v_ba from bank_accounts where id = new.bank_account_id;
    v_date := coalesce(new.paid_at, new.txn_date, current_date);
    new.paid_at := v_date;
    if new.kind = 'expense' then
      select * into v_cat from expense_categories where id = new.category_id;
      if v_cat.id is null then raise exception 'Pick an expense category.'; end if;
      v_lines := jsonb_build_array(
        jsonb_build_object('account_id', v_cat.account_id, 'debit', new.amount, 'stage_id', new.stage_id, 'block_id', new.block_id, 'memo', new.description),
        jsonb_build_object('account_id', v_ba.account_id, 'credit', new.amount));
    elsif new.kind = 'asset_purchase' then
      v_acct := coalesce((select account_id from expense_categories where id = new.category_id), acct('1500'));
      v_lines := jsonb_build_array(
        jsonb_build_object('account_id', v_acct, 'debit', new.amount, 'memo', new.description),
        jsonb_build_object('account_id', v_ba.account_id, 'credit', new.amount));
      insert into assets(name, category, purchase_date, cost, transaction_id)
      values (coalesce(new.description, 'Equipment'), 'equipment', v_date, new.amount, new.id)
      returning id into v_asset;
      new.asset_id := v_asset;
    elsif new.kind = 'income' then
      v_acct := coalesce(new.income_account_id, acct('4020'));
      v_lines := jsonb_build_array(
        jsonb_build_object('account_id', v_ba.account_id, 'debit', new.amount, 'memo', new.description),
        jsonb_build_object('account_id', v_acct, 'credit', new.amount));
    else
      v_lines := jsonb_build_array(
        jsonb_build_object('account_id', v_ba.account_id, 'debit', new.amount, 'memo', new.description),
        jsonb_build_object('code', '3000', 'credit', new.amount));
    end if;
    new.journal_entry_id := post_journal(v_date, coalesce(new.description, new.kind), 'transaction', new.id, new.season_id, v_lines);
  end if;
  return new;
end $$;

drop trigger if exists transactions_before_trg on transactions;
create trigger transactions_before_trg before insert or update on transactions
  for each row execute function transactions_before();

create or replace function decide_transaction(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t transactions; r app_role := auth_role();
begin
  select * into t from transactions where id = p_id for update;
  if t.id is null or t.status <> 'pending_approval' then raise exception 'This request is not awaiting approval'; end if;
  if r is null then raise exception 'Not authorised'; end if;
  if r <> 'admin' and r is distinct from t.required_role then
    raise exception 'Your role cannot approve this amount (needs %)', t.required_role;
  end if;
  if t.requested_by = auth.uid() and r <> 'admin' then raise exception 'You cannot approve your own request'; end if;
  update transactions set status = case when p_approve then 'approved' else 'rejected' end,
         approved_by = auth.uid(), approved_at = now(),
         approval_note = coalesce(p_note, approval_note) where id = p_id;
  if p_approve then
    perform notify('accountant', null, 'Approved expense ready to pay',
      coalesce(t.payee, '') || ' ' || coalesce(t.description, '') || ' (' || fmt_money(t.amount) || ')',
      '#/expenses', 'info', 'txn-ready:' || p_id);
  end if;
  perform notify(null, t.requested_by, case when p_approve then 'Request approved' else 'Request rejected' end,
    coalesce(t.description, '') || ' (' || fmt_money(t.amount) || ')' || coalesce(' - ' || p_note, ''), '#/expenses',
    case when p_approve then 'info' else 'warning' end, 'txn-decision:' || p_id || ':' || p_approve::text);
end $$;

create or replace function mark_paid(p_id uuid, p_bank uuid, p_date date default current_date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role(array['accountant']::app_role[]) then raise exception 'Only the accountant can record payments'; end if;
  update transactions set status = 'paid', bank_account_id = p_bank, paid_at = p_date
  where id = p_id and status = 'approved';
  if not found then raise exception 'Only approved transactions can be paid'; end if;
end $$;

-- ============================================================ invoices and payments
create or replace function invoices_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_rev uuid; v_crop text;
begin
  if new.season_id is null then new.season_id := current_season(); end if;
  if new.status = 'issued' and new.journal_entry_id is null then
    select crop into v_crop from sales_orders where id = new.order_id;
    v_rev := case v_crop when 'cassava' then acct('4000') when 'maize' then acct('4010') else acct('4020') end;
    new.journal_entry_id := post_journal(new.issue_date, 'Invoice ' || new.number, 'invoice', new.id, new.season_id,
      jsonb_build_array(jsonb_build_object('code', '1100', 'debit', new.amount),
                        jsonb_build_object('account_id', v_rev, 'credit', new.amount)));
  end if;
  if tg_op = 'UPDATE' and new.status = 'void' and old.status <> 'void' and old.journal_entry_id is not null then
    perform reverse_journal(old.journal_entry_id, 'Void invoice ' || old.number);
  end if;
  return new;
end $$;

drop trigger if exists invoices_before_trg on invoices;
create trigger invoices_before_trg before insert or update on invoices
  for each row execute function invoices_before();

create or replace function payments_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_inv invoices; v_ba bank_accounts;
begin
  select * into v_inv from invoices where id = new.invoice_id;
  if v_inv.status not in ('issued','part_paid','overdue') then
    raise exception 'Invoice % is %, so it cannot receive a payment', v_inv.number, v_inv.status;
  end if;
  select * into v_ba from bank_accounts where id = new.bank_account_id;
  new.journal_entry_id := post_journal(new.pay_date, 'Payment for ' || v_inv.number, 'payment', new.id, v_inv.season_id,
    jsonb_build_array(jsonb_build_object('account_id', v_ba.account_id, 'debit', new.amount),
                      jsonb_build_object('code', '1100', 'credit', new.amount)));
  return new;
end $$;

drop trigger if exists payments_before_trg on payments;
create trigger payments_before_trg before insert on payments
  for each row execute function payments_before();

create or replace function payments_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_paid numeric; v_amt numeric;
begin
  select amount into v_amt from invoices where id = new.invoice_id;
  select coalesce(sum(amount), 0) into v_paid from payments where invoice_id = new.invoice_id;
  update invoices set status = case when v_paid >= v_amt then 'paid' else 'part_paid' end
  where id = new.invoice_id and status in ('issued','part_paid','overdue');
  return null;
end $$;

drop trigger if exists payments_after_trg on payments;
create trigger payments_after_trg after insert on payments
  for each row execute function payments_after();

create or replace function deliveries_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare o sales_orders; v_terms numeric; v_auto numeric;
begin
  if new.status = 'delivered' and not exists (select 1 from invoices where delivery_id = new.id) then
    select * into o from sales_orders where id = new.order_id;
    v_terms := setting_num('invoice_terms_days', 14);
    v_auto := setting_num('auto_issue_invoices', 1);
    insert into invoices(buyer_id, order_id, delivery_id, season_id, issue_date, due_date, amount, status, description)
    values (o.buyer_id, o.id, new.id, o.season_id, new.delivery_date, new.delivery_date + v_terms::int,
            round(new.qty_tonnes * o.price_per_tonne, 2), case when v_auto > 0 then 'issued' else 'draft' end,
            o.crop || ' delivery of ' || new.qty_tonnes || ' t on ' || new.delivery_date);
    update sales_orders set status = 'delivered' where id = o.id and status = 'open';
    perform notify('accountant', null, 'Invoice created from delivery',
      o.crop || ' ' || new.qty_tonnes || ' t delivered - invoice ' || case when v_auto > 0 then 'issued' else 'drafted' end,
      '#/invoices', 'info', 'delivery-inv:' || new.id);
  end if;
  return null;
end $$;

drop trigger if exists deliveries_after_trg on deliveries;
create trigger deliveries_after_trg after insert or update on deliveries
  for each row execute function deliveries_after();

-- ============================================================ tasks and stages
create or replace function tasks_before() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.status = 'done' and new.status <> 'done' and new.progress = 100 then
    new.progress := 0;
  end if;
  if new.status = 'done' then
    new.progress := 100;
    if new.completed_at is null then new.completed_at := now(); new.completed_by := auth.uid(); end if;
  elsif new.progress = 100 then
    new.status := 'done';
    new.completed_at := coalesce(new.completed_at, now());
    new.completed_by := coalesce(new.completed_by, auth.uid());
  else
    new.completed_at := null;
    if new.progress > 0 and new.status = 'todo' then new.status := 'in_progress'; end if;
  end if;
  return new;
end $$;

drop trigger if exists tasks_before_trg on tasks;
create trigger tasks_before_trg before insert or update on tasks
  for each row execute function tasks_before();

create or replace function refresh_stage_progress(p_stage uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_avg numeric; v_total int; v_done int; v_started int;
begin
  select coalesce(avg(progress), 0), count(*), count(*) filter (where status = 'done'),
         count(*) filter (where progress > 0 or status in ('in_progress','done'))
    into v_avg, v_total, v_done, v_started from tasks where stage_id = p_stage;
  update stages set
    progress = round(v_avg, 1),
    status = case when v_total > 0 and v_done = v_total then 'done' when v_started > 0 then 'in_progress' else 'not_started' end,
    actual_start = case when v_started > 0 then coalesce(actual_start, current_date) else actual_start end,
    actual_end = case when v_total > 0 and v_done = v_total then coalesce(actual_end, current_date) else null end
  where id = p_stage;
end $$;

create or replace function tasks_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_stage uuid;
begin
  v_stage := case when tg_op = 'DELETE' then old.stage_id else new.stage_id end;
  if v_stage is not null then perform refresh_stage_progress(v_stage); end if;
  if tg_op = 'UPDATE' and old.stage_id is distinct from new.stage_id and old.stage_id is not null then
    perform refresh_stage_progress(old.stage_id);
  end if;
  return null;
end $$;

drop trigger if exists tasks_after_trg on tasks;
create trigger tasks_after_trg after insert or update or delete on tasks
  for each row execute function tasks_after();

-- ============================================================ inventory and procurement
create or replace function stock_moves_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update inventory_items set qty_on_hand = qty_on_hand + new.qty where id = new.item_id;
  return null;
end $$;

drop trigger if exists stock_moves_after_trg on stock_moves;
create trigger stock_moves_after_trg after insert on stock_moves
  for each row execute function stock_moves_after();

create or replace function procurement_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_txn uuid;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and new.transaction_id is null then
    insert into transactions(kind, status, category_id, season_id, stage_id, budget_line_id, payee, description, amount, requested_by, txn_date)
    values ('expense', 'submitted', coalesce(new.category_id, (select id from expense_categories where name = 'Admin & sundries')),
            new.season_id, new.stage_id, new.budget_line_id,
            (select name from suppliers where id = new.supplier_id), 'PO: ' || new.description,
            greatest(new.total, 1), new.requested_by, current_date)
    returning id into v_txn;
    update procurement_orders set transaction_id = v_txn where id = new.id;
  end if;
  if new.status = 'received' and old.status is distinct from 'received' and new.item_id is not null then
    insert into stock_moves(item_id, qty, reason, stage_id) values (new.item_id, new.qty, 'Received PO ' || new.description, new.stage_id);
  end if;
  return null;
end $$;

drop trigger if exists procurement_after_trg on procurement_orders;
create trigger procurement_after_trg after update on procurement_orders
  for each row execute function procurement_after();

-- ============================================================ payroll
create or replace function run_payroll_draft(p_start date, p_end date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_run uuid; v_pe numeric; v_pr numeric; e record; v_days numeric; v_gross numeric; v_inc_casual numeric;
begin
  if auth.uid() is not null and not has_role(array['accountant']::app_role[]) then
    raise exception 'Only the accountant can prepare payroll';
  end if;
  v_pe := setting_num('pension_employee_rate', 0.08);
  v_pr := setting_num('pension_employer_rate', 0.10);
  v_inc_casual := setting_num('payroll_includes_casual', 0);
  select id into v_run from payroll_runs where period_start = p_start and period_end = p_end;
  if v_run is not null then
    if (select status from payroll_runs where id = v_run) <> 'draft' then return v_run; end if;
    delete from payroll_items where run_id = v_run;
  else
    insert into payroll_runs(period_start, period_end) values (p_start, p_end) returning id into v_run;
  end if;
  for e in select * from employees where active loop
    if e.kind = 'casual' then
      continue when v_inc_casual = 0;
      select coalesce(sum(days), 0), coalesce(sum(days * coalesce(rate, e.daily_rate)), 0)
        into v_days, v_gross from attendance where employee_id = e.id and work_date between p_start and p_end;
      if v_gross > 0 then
        insert into payroll_items(run_id, employee_id, days, gross, net) values (v_run, e.id, v_days, v_gross, v_gross);
      end if;
    elsif e.monthly_salary > 0 then
      insert into payroll_items(run_id, employee_id, days, gross, pension_employee, pension_employer, net, notes)
      values (v_run, e.id, null, e.monthly_salary,
              case when e.pension_applicable then round(e.monthly_salary * v_pe, 2) else 0 end,
              case when e.pension_applicable then round(e.monthly_salary * v_pr, 2) else 0 end,
              e.monthly_salary - case when e.pension_applicable then round(e.monthly_salary * v_pe, 2) else 0 end,
              'PAYE not computed: enter per current tax rules');
    end if;
  end loop;
  update payroll_runs set total_gross = (select coalesce(sum(gross), 0) from payroll_items where run_id = v_run),
                          total_net = (select coalesce(sum(net), 0) from payroll_items where run_id = v_run)
  where id = v_run;
  return v_run;
end $$;

create or replace function payroll_items_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_run uuid := case when tg_op = 'DELETE' then old.run_id else new.run_id end;
begin
  update payroll_runs set total_gross = (select coalesce(sum(gross), 0) from payroll_items where run_id = v_run),
                          total_net = (select coalesce(sum(net), 0) from payroll_items where run_id = v_run)
  where id = v_run and status = 'draft';
  return null;
end $$;

drop trigger if exists payroll_items_after_trg on payroll_items;
create trigger payroll_items_after_trg after insert or update or delete on payroll_items
  for each row execute function payroll_items_after();

create or replace function approve_payroll(p_run uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth_role() is distinct from 'admin' then raise exception 'Only an admin can approve payroll'; end if;
  update payroll_runs set status = 'approved', approved_by = auth.uid() where id = p_run and status = 'draft';
  if not found then raise exception 'Only draft payroll can be approved'; end if;
  perform notify('accountant', null, 'Payroll approved', 'Pay the approved run and record it.', '#/payroll', 'info', 'payroll-approved:' || p_run);
end $$;

create or replace function pay_payroll(p_run uuid, p_bank uuid, p_date date default current_date) returns void
language plpgsql security definer set search_path = public as $$
declare r payroll_runs; v_ba bank_accounts; v_cas numeric; v_staff numeric; v_paye numeric; v_pe numeric; v_pr numeric; v_net numeric; v_entry uuid;
begin
  if not has_role(array['accountant']::app_role[]) then raise exception 'Only the accountant can pay payroll'; end if;
  select * into r from payroll_runs where id = p_run for update;
  if r.status <> 'approved' then raise exception 'Payroll must be approved before payment'; end if;
  select * into v_ba from bank_accounts where id = p_bank;
  select coalesce(sum(i.gross) filter (where e.kind = 'casual'), 0), coalesce(sum(i.gross) filter (where e.kind = 'staff'), 0),
         coalesce(sum(i.paye), 0), coalesce(sum(i.pension_employee), 0), coalesce(sum(i.pension_employer), 0), coalesce(sum(i.net), 0)
    into v_cas, v_staff, v_paye, v_pe, v_pr, v_net
    from payroll_items i join employees e on e.id = i.employee_id where i.run_id = p_run;
  v_entry := post_journal(p_date, 'Payroll ' || r.period_start || ' to ' || r.period_end, 'payroll', p_run, current_season(),
    jsonb_build_array(
      jsonb_build_object('code', '5200', 'debit', v_cas),
      jsonb_build_object('code', '5210', 'debit', v_staff),
      jsonb_build_object('code', '5220', 'debit', v_pr),
      jsonb_build_object('account_id', v_ba.account_id, 'credit', v_net),
      jsonb_build_object('code', '2100', 'credit', v_paye + v_pe + v_pr)));
  update payroll_runs set status = 'paid', paid_at = p_date, journal_entry_id = v_entry where id = p_run;
end $$;

-- ============================================================ assets
create or replace function run_depreciation(p_asof date default current_date) returns numeric
language plpgsql security definer set search_path = public as $$
declare a record; v_month numeric; v_amt numeric; v_total numeric := 0; v_first date := date_trunc('month', p_asof)::date;
begin
  for a in select * from assets where status = 'active' and cost > 0 and purchase_date <= p_asof
             and (last_depreciated is null or last_depreciated < v_first) loop
    v_month := (a.cost - a.salvage_value) / nullif(a.useful_life_years * 12, 0);
    v_amt := round(least(coalesce(v_month, 0), (a.cost - a.salvage_value) - a.accumulated_depreciation), 2);
    if v_amt > 0 then
      update assets set accumulated_depreciation = accumulated_depreciation + v_amt, last_depreciated = v_first where id = a.id;
      v_total := v_total + v_amt;
    else
      update assets set last_depreciated = v_first where id = a.id;
    end if;
  end loop;
  if v_total > 0 then
    perform post_journal(p_asof, 'Monthly depreciation', 'depreciation', null, current_season(),
      jsonb_build_array(jsonb_build_object('code', '5400', 'debit', v_total), jsonb_build_object('code', '1510', 'credit', v_total)));
  end if;
  return v_total;
end $$;

-- ============================================================ bank reconciliation
create or replace function reconcile_bank(p_bank uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l record; v_id uuid; v_type text; v_m int := 0; v_u int := 0;
begin
  if auth.uid() is not null and not has_role(array['accountant']::app_role[]) then
    raise exception 'Only the accountant can reconcile';
  end if;
  for l in select * from bank_statement_lines where bank_account_id = p_bank and status = 'unmatched' order by line_date loop
    v_id := null; v_type := null;
    if l.debit > 0 then
      select t.id into v_id from transactions t
      where t.bank_account_id = p_bank and t.status = 'paid' and t.kind in ('expense','asset_purchase')
        and t.amount = l.debit and abs(t.paid_at - l.line_date) <= 3
        and not exists (select 1 from bank_statement_lines b where b.matched_id = t.id and b.status = 'matched')
      order by (case when t.reference is not null and lower(t.reference) = lower(coalesce(l.reference, '')) then 0 else 1 end),
               abs(t.paid_at - l.line_date) limit 1;
      v_type := 'transaction';
      if v_id is null then
        select r.id into v_id from payroll_runs r
        where r.status = 'paid' and r.total_net = l.debit and abs(r.paid_at - l.line_date) <= 3
          and not exists (select 1 from bank_statement_lines b where b.matched_id = r.id and b.status = 'matched') limit 1;
        v_type := 'payroll';
      end if;
    elsif l.credit > 0 then
      select p.id into v_id from payments p
      where p.bank_account_id = p_bank and p.amount = l.credit and abs(p.pay_date - l.line_date) <= 3
        and not exists (select 1 from bank_statement_lines b where b.matched_id = p.id and b.status = 'matched')
      order by abs(p.pay_date - l.line_date) limit 1;
      v_type := 'payment';
      if v_id is null then
        select t.id into v_id from transactions t
        where t.bank_account_id = p_bank and t.status = 'paid' and t.kind in ('income','capital')
          and t.amount = l.credit and abs(t.paid_at - l.line_date) <= 3
          and not exists (select 1 from bank_statement_lines b where b.matched_id = t.id and b.status = 'matched') limit 1;
        v_type := 'transaction';
      end if;
    end if;
    if v_id is not null then
      update bank_statement_lines set status = 'matched', matched_type = v_type, matched_id = v_id where id = l.id;
      v_m := v_m + 1;
    else
      v_u := v_u + 1;
    end if;
  end loop;
  return jsonb_build_object('matched', v_m, 'unmatched', v_u);
end $$;

-- ============================================================ statements
create or replace function fn_pnl(p_from date, p_to date)
returns table(code text, name text, type text, amount numeric)
language sql stable set search_path = public as $$
  select a.code, a.name, a.type,
         coalesce(sum(case when a.type = 'income' then x.credit - x.debit else x.debit - x.credit end), 0)
  from accounts a
  left join (select l.account_id, l.debit, l.credit from journal_lines l
             join journal_entries e on e.id = l.entry_id where e.entry_date between p_from and p_to) x on x.account_id = a.id
  where a.type in ('income','expense')
  group by a.code, a.name, a.type order by a.code
$$;

create or replace function fn_balance_sheet(p_asof date)
returns table(code text, name text, type text, amount numeric)
language sql stable set search_path = public as $$
  with x as (select l.account_id, l.debit, l.credit from journal_lines l
             join journal_entries e on e.id = l.entry_id where e.entry_date <= p_asof)
  select * from (
    select a.code, a.name, a.type,
           coalesce(sum(case when a.type = 'asset' then x.debit - x.credit else x.credit - x.debit end), 0) as amount
    from accounts a left join x on x.account_id = a.id
    where a.type in ('asset','liability','equity') group by a.code, a.name, a.type
    union all
    select '3999'::text, 'Current earnings'::text, 'equity'::text, coalesce(sum(x.credit - x.debit), 0)
    from x join accounts a on a.id = x.account_id where a.type in ('income','expense')
  ) q order by code
$$;

create or replace function fn_trial_balance(p_asof date)
returns table(code text, name text, type text, debit numeric, credit numeric)
language sql stable set search_path = public as $$
  select a.code, a.name, a.type, coalesce(sum(x.debit), 0), coalesce(sum(x.credit), 0)
  from accounts a
  left join (select l.account_id, l.debit, l.credit from journal_lines l
             join journal_entries e on e.id = l.entry_id where e.entry_date <= p_asof) x on x.account_id = a.id
  group by a.code, a.name, a.type having coalesce(sum(x.debit), 0) + coalesce(sum(x.credit), 0) > 0 order by a.code
$$;

create or replace function fn_cashflow(p_from date, p_to date)
returns table(category text, inflow numeric, outflow numeric)
language sql stable set search_path = public as $$
  select coalesce(e.source_type, 'other'), coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0)
  from journal_lines l join journal_entries e on e.id = l.entry_id
  join bank_accounts b on b.account_id = l.account_id
  where e.entry_date between p_from and p_to group by 1 order by 1
$$;

create or replace function fn_cash_balance(p_asof date default current_date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(opening_balance) from bank_accounts), 0)
       + coalesce((select sum(l.debit - l.credit) from journal_lines l
                   join journal_entries e on e.id = l.entry_id
                   join bank_accounts b on b.account_id = l.account_id where e.entry_date <= p_asof), 0)
$$;

create or replace function fn_profitability(p_season uuid)
returns table(crop text, cost numeric, revenue numeric, profit numeric, acres numeric,
              cost_per_acre numeric, revenue_per_acre numeric, profit_per_acre numeric)
language sql stable set search_path = public as $$
  with s as (select acres from seasons where id = p_season),
  cost as (
    select case when st.crop like 'maize%' then 'maize' when st.crop = 'cassava' then 'cassava' else 'general' end as crop,
           sum(l.debit - l.credit) as amt
    from journal_lines l join accounts a on a.id = l.account_id and a.type = 'expense'
    join journal_entries e on e.id = l.entry_id and e.season_id = p_season
    left join stages st on st.id = l.stage_id group by 1),
  rev as (
    select case a.code when '4000' then 'cassava' when '4010' then 'maize' else 'general' end as crop,
           sum(l.credit - l.debit) as amt
    from journal_lines l join accounts a on a.id = l.account_id and a.type = 'income'
    join journal_entries e on e.id = l.entry_id and e.season_id = p_season group by 1),
  keys as (select crop from cost union select crop from rev),
  allrows as (
    select k.crop, coalesce(c.amt, 0) as cost, coalesce(r.amt, 0) as revenue
    from keys k left join cost c on c.crop = k.crop left join rev r on r.crop = k.crop
    union all select 'TOTAL', coalesce((select sum(amt) from cost), 0), coalesce((select sum(amt) from rev), 0))
  select allrows.crop, allrows.cost, allrows.revenue, allrows.revenue - allrows.cost, s.acres,
         round(allrows.cost / nullif(s.acres, 0), 2), round(allrows.revenue / nullif(s.acres, 0), 2),
         round((allrows.revenue - allrows.cost) / nullif(s.acres, 0), 2)
  from allrows cross join s order by (allrows.crop = 'TOTAL'), allrows.crop
$$;

create or replace function fn_cash_forecast(p_season uuid)
returns table(month_start date, planned_in numeric, planned_out numeric, net numeric, cumulative numeric)
language sql stable security definer set search_path = public as $$
  with s as (select start_date, working_capital from seasons where id = p_season),
  months as (
    select (date_trunc('month', s.start_date) + make_interval(months => g))::date as m
    from s, generate_series(0, 17) g),
  outs as (
    select (date_trunc('month', b.planned_date) + make_interval(months => g.i))::date as m, b.amount / b.spread_months as amt
    from budget_lines b cross join lateral generate_series(0, b.spread_months - 1) as g(i)
    where b.season_id = p_season and b.planned_date is not null),
  ins as (select date_trunc('month', planned_date)::date as m, amount as amt from revenue_plan where season_id = p_season),
  calc as (
    select months.m, coalesce((select sum(amt) from ins where ins.m = months.m), 0) as pin,
           coalesce((select sum(amt) from outs where outs.m = months.m), 0) as pout
    from months)
  select calc.m, calc.pin, calc.pout, calc.pin - calc.pout,
         (select working_capital from s) + sum(calc.pin - calc.pout) over (order by calc.m)
  from calc order by calc.m
$$;

-- ============================================================ season generator
create or replace function generate_tax_filings(p_period_start date) returns void
language plpgsql security definer set search_path = public as $$
declare i record; v_period text := to_char(p_period_start, 'YYYY-MM');
begin
  for i in select * from tax_items where active loop
    insert into tax_filings(item_id, period, due_date)
    values (i.id, v_period, ((p_period_start + interval '1 month')::date + (i.due_day - 1)))
    on conflict (item_id, period) do nothing;
  end loop;
end $$;

create or replace function internal_generate_season(p_season uuid, p_start date) returns void
language plpgsql security definer set search_path = public as $$
declare v_s seasons; v_scale numeric; i int; n int;
begin
  select * into v_s from seasons where id = p_season;
  if v_s.id is null then raise exception 'Season not found'; end if;
  if exists (select 1 from tasks where season_id = p_season and progress > 0)
     or exists (select 1 from transactions where season_id = p_season and kind in ('expense','asset_purchase')) then
    raise exception 'Work or spending has started. The schedule cannot be regenerated.';
  end if;
  v_scale := v_s.acres / 10.0;
  delete from budget_lines where season_id = p_season;
  delete from revenue_plan where season_id = p_season;
  delete from tasks where season_id = p_season;
  delete from stages where season_id = p_season;
  update seasons set start_date = p_start where id = p_season;

  if not exists (select 1 from blocks where season_id = p_season) then
    n := 5;
    for i in 1..n loop
      insert into blocks(season_id, name, acres) values (p_season, 'Block ' || chr(64 + i), v_s.acres / n);
    end loop;
  end if;

  insert into stages(season_id, seq, name, crop, grp, planned_start, planned_end, window_end, weight, owner_role)
  select p_season, seq, name, crop, grp, p_start + start_offset, p_start + end_offset,
         case when window_end_offset is not null then p_start + window_end_offset end, weight, owner_role
  from stage_templates;

  insert into tasks(season_id, stage_id, title, assignee_role, start_date, due_date, priority)
  select p_season, st.id, t.title, t.assignee_role, st.planned_start + t.start_offset,
         st.planned_start + t.start_offset + t.duration_days, t.priority
  from task_templates t join stages st on st.season_id = p_season and st.seq = t.stage_seq;

  insert into budget_lines(season_id, phase, stage_id, category_id, description, amount, planned_date, spread_months)
  select p_season, v_s.phase, st.id, ec.id, bt.description, bt.amount_per_10_acres * v_scale,
         st.planned_start + bt.offset_days, bt.spread_months
  from budget_templates bt
  join expense_categories ec on ec.name = bt.category_name
  left join stages st on st.season_id = p_season and st.seq = bt.stage_seq;

  insert into revenue_plan(season_id, crop, planned_date, amount, description)
  select p_season, rt.crop, st.planned_end + rt.days_after_end, rt.amount_per_10_acres * v_scale, rt.description
  from revenue_templates rt join stages st on st.season_id = p_season and st.seq = rt.stage_seq;

  for i in 0..17 loop
    perform generate_tax_filings((date_trunc('month', p_start) + make_interval(months => i))::date);
  end loop;
end $$;

create or replace function generate_season(p_season uuid, p_start date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role(array['ops_manager']::app_role[]) then raise exception 'Only the Farm Operations Manager or an admin can generate the schedule'; end if;
  perform internal_generate_season(p_season, p_start);
  perform notify('ops_manager', null, 'Season schedule generated', 'Stages, tasks and budgets were created from ' || p_start, '#/gantt', 'info', 'season-gen:' || p_season || ':' || p_start);
end $$;

-- ============================================================ dashboard
create or replace function dashboard_core(p_season uuid, p_full boolean) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_s seasons; v_out jsonb; v_prog numeric; v_plan numeric; v_cash numeric; v_min numeric;
  v_budget numeric; v_spent numeric; v_commit numeric; v_mg_target numeric; v_mg_spent numeric;
  v_recv numeric; v_rev_plan numeric; v_rev_act numeric; v_exp_cass numeric; v_exp_maize numeric;
  v_sign_cass numeric; v_sign_maize numeric; v_h stages;
begin
  select * into v_s from seasons where id = coalesce(p_season, current_season());
  if v_s.id is null then return jsonb_build_object('season', null); end if;
  select coalesce(sum(progress * weight) / nullif(sum(weight), 0), 0) into v_prog from stages where season_id = v_s.id;
  select coalesce(sum(weight * least(greatest((current_date - planned_start)::numeric / nullif(planned_end - planned_start, 0), 0), 1))
                  / nullif(sum(weight), 0) * 100, 0) into v_plan from stages where season_id = v_s.id;
  select * into v_h from stages where season_id = v_s.id and seq = 11;
  v_exp_cass := v_s.acres * setting_num('expected_yield_cassava', 8);
  v_exp_maize := v_s.acres * setting_num('expected_yield_maize', 1.5) * 2;
  select coalesce(sum(qty_tonnes), 0) into v_sign_cass from supply_agreements where season_id = v_s.id and crop = 'cassava' and status in ('signed','delivered');
  select coalesce(sum(qty_tonnes), 0) into v_sign_maize from supply_agreements where season_id = v_s.id and crop = 'maize' and status in ('signed','delivered');
  v_out := jsonb_build_object(
    'season', to_jsonb(v_s),
    'progress', round(v_prog, 1), 'planned_progress', round(v_plan, 1),
    'tasks', (select jsonb_build_object('total', count(*), 'done', count(*) filter (where status = 'done'),
                'in_progress', count(*) filter (where status = 'in_progress'),
                'overdue', count(*) filter (where status <> 'done' and due_date < current_date),
                'due_week', count(*) filter (where status <> 'done' and due_date between current_date and current_date + 7))
              from tasks where season_id = v_s.id),
    'harvest', jsonb_build_object('start', v_h.planned_start, 'end', v_h.planned_end, 'window_end', v_h.window_end,
                'days_to_start', (v_h.planned_start - current_date)),
    'sales', jsonb_build_object('cassava_expected_t', v_exp_cass, 'cassava_signed_t', v_sign_cass,
                'maize_expected_t', v_exp_maize, 'maize_signed_t', v_sign_maize),
    'risks_high', (select count(*) from risks where status <> 'closed' and score >= 15),
    'low_stock', (select count(*) from inventory_items where reorder_level > 0 and qty_on_hand <= reorder_level),
    'rain_7d', (select coalesce(sum(rain_mm), 0) from weather_readings where reading_date > current_date - 7),
    'rain_30d', (select coalesce(sum(rain_mm), 0) from weather_readings where reading_date > current_date - 30),
    'pending_approvals', (select count(*) from transactions where status = 'pending_approval'),
    'unread', (select count(*) from notifications n where (n.to_user = auth.uid() or n.to_role = auth_role()) and not (auth.uid() = any(n.read_by)))
  );
  if p_full then
    select coalesce(sum(amount), 0) into v_budget from budget_lines where season_id = v_s.id;
    select coalesce(sum(amount), 0) into v_spent from transactions where season_id = v_s.id and status = 'paid' and kind in ('expense','asset_purchase');
    select coalesce(sum(amount), 0) into v_commit from transactions where season_id = v_s.id and status in ('approved','pending_approval') and kind in ('expense','asset_purchase');
    select coalesce(sum(target_amount), 0) into v_mg_target from phase_targets where phase = v_s.phase and grp = 'management';
    select coalesce(sum(t.amount), 0) into v_mg_spent from transactions t join expense_categories c on c.id = t.category_id
      join seasons s on s.id = t.season_id where s.phase = v_s.phase and c.is_management and t.status = 'paid';
    v_cash := fn_cash_balance(current_date);
    select min(cumulative) into v_min from fn_cash_forecast(v_s.id);
    select coalesce(sum(i.amount), 0) - coalesce((select sum(p.amount) from payments p join invoices i2 on i2.id = p.invoice_id where i2.status in ('issued','part_paid','overdue','paid')), 0)
      into v_recv from invoices i where i.status in ('issued','part_paid','overdue','paid');
    select coalesce(sum(amount), 0) into v_rev_plan from revenue_plan where season_id = v_s.id;
    select coalesce(sum(l.credit - l.debit), 0) into v_rev_act from journal_lines l
      join accounts a on a.id = l.account_id and a.type = 'income'
      join journal_entries e on e.id = l.entry_id where e.season_id = v_s.id;
    v_out := v_out || jsonb_build_object(
      'budget', jsonb_build_object('total', v_budget, 'spent', v_spent, 'committed', v_commit),
      'management', jsonb_build_object('target', v_mg_target, 'spent', v_mg_spent),
      'cash', jsonb_build_object('balance', v_cash, 'working_capital', v_s.working_capital,
                'forecast_min', v_min, 'shortfall', greatest(0, -coalesce(v_min, 0))),
      'receivables', greatest(v_recv, 0),
      'revenue', jsonb_build_object('planned', v_rev_plan, 'actual', v_rev_act));
  end if;
  return v_out;
end $$;

create or replace function dashboard_summary(p_season uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth_role() is null then raise exception 'Not authorised'; end if;
  return dashboard_core(p_season, auth_role() in ('admin','accountant','ops_manager'));
end $$;

-- ============================================================ reports
create or replace function generate_basic_report(p_type text) returns uuid
language plpgsql security definer set search_path = public as $$
declare d jsonb; v_body text; v_title text; v_aud app_role[]; v_id uuid; v_period text;
begin
  d := dashboard_core(null, true);
  if d -> 'season' is null or d ->> 'season' is null then return null; end if;
  v_period := case when p_type = 'weekly' then to_char(current_date, 'IYYY-"W"IW') else to_char(current_date - interval '1 month', 'YYYY-MM') end;
  v_title := case when p_type = 'weekly' then 'Weekly farm performance ' || v_period else 'Monthly management report ' || v_period end;
  v_aud := case when p_type = 'weekly' then array['admin','ops_manager','supervisor']::app_role[]
                else array['admin','ops_manager','accountant']::app_role[] end;
  v_body := format(E'## %s\n\n**Season:** %s\n\n**Progress:** %s%% complete vs %s%% planned for today.\n\n**Tasks:** %s done of %s; %s in progress; %s overdue; %s due this week.\n\n**Money:** budget %s, paid %s, committed %s. Management expenses %s of target %s. Cash balance %s against working capital %s. Projected low point %s (shortfall %s).\n\n**Sales cover:** cassava %s t signed of about %s t expected; maize %s t signed of about %s t expected.\n\n**Other:** %s pending approvals, %s high risks open, %s low-stock items, %s mm rain in the last 7 days.\n',
    v_title, d #>> '{season,name}', d ->> 'progress', d ->> 'planned_progress',
    d #>> '{tasks,done}', d #>> '{tasks,total}', d #>> '{tasks,in_progress}', d #>> '{tasks,overdue}', d #>> '{tasks,due_week}',
    fmt_money((d #>> '{budget,total}')::numeric), fmt_money((d #>> '{budget,spent}')::numeric), fmt_money((d #>> '{budget,committed}')::numeric),
    fmt_money((d #>> '{management,spent}')::numeric), fmt_money((d #>> '{management,target}')::numeric),
    fmt_money((d #>> '{cash,balance}')::numeric), fmt_money((d #>> '{cash,working_capital}')::numeric),
    fmt_money((d #>> '{cash,forecast_min}')::numeric), fmt_money((d #>> '{cash,shortfall}')::numeric),
    d #>> '{sales,cassava_signed_t}', d #>> '{sales,cassava_expected_t}', d #>> '{sales,maize_signed_t}', d #>> '{sales,maize_expected_t}',
    d ->> 'pending_approvals', d ->> 'risks_high', d ->> 'low_stock', d ->> 'rain_7d');
  insert into reports(report_type, period, title, body_md, data, audience, generated_by)
  values (case when p_type = 'weekly' then 'weekly' else 'finance_monthly' end, v_period, v_title, v_body, d, v_aud, 'system')
  returning id into v_id;
  return v_id;
end $$;

create or replace function snapshot_month(p_period text) returns void
language plpgsql security definer set search_path = public as $$
declare v_from date := (p_period || '-01')::date; v_to date; v_season uuid := current_season();
begin
  if auth.uid() is not null and not has_role(array['accountant']::app_role[]) then raise exception 'Only the accountant can close a month'; end if;
  v_to := (v_from + interval '1 month - 1 day')::date;
  insert into financial_snapshots(period, kind, data) values
    (p_period, 'pnl', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from fn_pnl(v_from, v_to) p where p.amount <> 0)),
    (p_period, 'balance_sheet', (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) from fn_balance_sheet(v_to) b where b.amount <> 0)),
    (p_period, 'cashflow', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from fn_cashflow(v_from, v_to) c)),
    (p_period, 'profitability', (select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) from fn_profitability(v_season) f))
  on conflict (period, kind) do update set data = excluded.data, created_at = now();
end $$;

-- ============================================================ automation jobs
create or replace function job_daily() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_run uuid; r record; v_s seasons; v_cnt int := 0; v_min numeric; v_cash numeric; v_used numeric; v_sign numeric; v_exp numeric; b record;
begin
  insert into automation_runs(job) values ('job_daily') returning id into v_run;
  begin
    select * into v_s from seasons where id = current_season();

    for r in select t.*, st.name as stage_name from tasks t left join stages st on st.id = t.stage_id
             where t.status <> 'done' and t.due_date < current_date loop
      perform notify(coalesce(r.assignee_role, 'ops_manager'), r.assignee_id, 'Task overdue: ' || r.title,
        'Due ' || r.due_date || coalesce(' - ' || r.stage_name, ''), '#/tasks', 'warning', 'overdue1:' || r.id);
      if current_date - r.due_date >= 3 then
        perform notify('ops_manager', null, 'Overdue 3+ days: ' || r.title, 'Due ' || r.due_date, '#/tasks', 'warning', 'overdue3:' || r.id);
      end if;
      if current_date - r.due_date >= 7 then
        perform notify('admin', null, 'Overdue 7+ days: ' || r.title, 'Due ' || r.due_date, '#/tasks', 'critical', 'overdue7:' || r.id);
      end if;
      v_cnt := v_cnt + 1;
    end loop;

    for r in select * from tasks where status <> 'done' and due_date between current_date and current_date + 2 loop
      perform notify(coalesce(r.assignee_role, 'ops_manager'), r.assignee_id, 'Task due soon: ' || r.title, 'Due ' || r.due_date, '#/tasks', 'info', 'duesoon:' || r.id);
    end loop;

    for r in select * from stages where season_id = v_s.id and status = 'not_started' and planned_start between current_date and current_date + 7 loop
      perform notify(r.owner_role, null, 'Stage starting soon: ' || r.name, 'Planned start ' || r.planned_start, '#/gantt', 'info', 'stage-start:' || r.id);
    end loop;
    for r in select * from stages where season_id = v_s.id and status <> 'done' and planned_end < current_date loop
      perform notify('ops_manager', null, 'Stage behind schedule: ' || r.name, 'Planned end was ' || r.planned_end || ' (' || r.progress || '% done)', '#/gantt', 'warning', 'stage-late:' || r.id);
    end loop;

    for b in select bl.id, bl.amount, bl.description, ec.name as cat,
                    coalesce((select sum(t.amount) from transactions t where t.budget_line_id = bl.id and t.status in ('pending_approval','approved','paid')), 0) as used
             from budget_lines bl join expense_categories ec on ec.id = bl.category_id where bl.season_id = v_s.id and bl.amount > 0 loop
      if b.used >= b.amount then
        perform notify('accountant', null, 'Budget line exhausted: ' || b.cat, coalesce(b.description, '') || ' - used ' || fmt_money(b.used) || ' of ' || fmt_money(b.amount), '#/budgets', 'critical', 'bud100:' || b.id);
        perform notify('ops_manager', null, 'Budget line exhausted: ' || b.cat, coalesce(b.description, ''), '#/budgets', 'critical', 'bud100o:' || b.id);
      elsif b.used >= 0.9 * b.amount then
        perform notify('accountant', null, 'Budget line at 90%: ' || b.cat, coalesce(b.description, '') || ' - used ' || fmt_money(b.used) || ' of ' || fmt_money(b.amount), '#/budgets', 'warning', 'bud90:' || b.id);
      end if;
    end loop;

    v_cash := fn_cash_balance(current_date);
    if v_s.working_capital > 0 and v_cash < 0.25 * v_s.working_capital and exists (select 1 from transactions where season_id = v_s.id and status = 'paid') then
      perform notify('admin', null, 'Working capital is low', 'Cash ' || fmt_money(v_cash) || ' vs working capital ' || fmt_money(v_s.working_capital), '#/dashboard', 'critical', 'wc-low:' || to_char(current_date, 'IYYY-IW'));
      perform notify('accountant', null, 'Working capital is low', 'Cash ' || fmt_money(v_cash), '#/cashflow', 'critical', 'wc-lowa:' || to_char(current_date, 'IYYY-IW'));
    end if;
    select min(cumulative) into v_min from fn_cash_forecast(v_s.id);
    if v_min < 0 then
      perform notify('admin', null, 'Forecast cash shortfall', 'Planned spending exceeds working capital by ' || fmt_money(-v_min) || '. Stage the planting or arrange a bridge.', '#/cashflow', 'warning', 'wc-forecast:' || v_s.id || ':' || round(-v_min));
    end if;

    update invoices set status = 'overdue' where status in ('issued','part_paid') and due_date < current_date;
    for r in select i.*, b2.name as buyer from invoices i left join buyers b2 on b2.id = i.buyer_id where i.status = 'overdue' loop
      perform notify('accountant', null, 'Invoice overdue: ' || r.number, coalesce(r.buyer, '') || ' ' || fmt_money(r.amount), '#/invoices', 'warning', 'inv-overdue:' || r.id);
      perform notify('sales', null, 'Chase payment: ' || r.number, coalesce(r.buyer, '') || ' ' || fmt_money(r.amount), '#/invoices', 'warning', 'inv-overdue-s:' || r.id);
    end loop;

    for r in select * from inventory_items where reorder_level > 0 and qty_on_hand <= reorder_level loop
      perform notify('ops_manager', null, 'Low stock: ' || r.name, r.qty_on_hand || ' ' || r.unit || ' left (reorder at ' || r.reorder_level || ')', '#/inventory', 'warning', 'lowstock:' || r.id || ':' || to_char(current_date, 'IYYY-IW'));
    end loop;

    update tax_filings set status = 'late' where status = 'due' and due_date < current_date;
    for r in select f.*, i.name from tax_filings f join tax_items i on i.id = f.item_id where f.status = 'due' and f.due_date between current_date and current_date + 7 loop
      perform notify('accountant', null, 'Filing due soon: ' || r.name, 'Period ' || r.period || ', due ' || r.due_date, '#/tax', 'warning', 'tax-due:' || r.id);
    end loop;
    for r in select f.*, i.name from tax_filings f join tax_items i on i.id = f.item_id where f.status = 'late' loop
      perform notify('admin', null, 'Filing overdue: ' || r.name, 'Period ' || r.period || ', was due ' || r.due_date, '#/tax', 'critical', 'tax-late:' || r.id);
    end loop;

    update compliance_checks set status = case
      when last_checked is null then 'attention'
      when frequency = 'weekly' and last_checked < current_date - 7 then 'overdue'
      when frequency = 'monthly' and last_checked < current_date - 31 then 'overdue'
      when frequency = 'seasonal' and last_checked < current_date - 120 then 'overdue'
      else 'ok' end;
    for r in select * from compliance_checks where status = 'overdue' loop
      perform notify(coalesce(r.owner_role, 'supervisor'), null, 'Safety/compliance check overdue: ' || r.item, r.area, '#/compliance', 'warning', 'comp:' || r.id || ':' || to_char(current_date, 'IYYY-IW'));
    end loop;

    for r in select * from transactions where status = 'pending_approval' and created_at < now() - interval '2 days' loop
      perform notify(coalesce(r.required_role, 'admin'), null, 'Approval waiting 2+ days', coalesce(r.description, '') || ' (' || fmt_money(r.amount) || ')', '#/approvals', 'warning', 'appr-old:' || r.id);
    end loop;

    select * into r from stages where season_id = v_s.id and seq = 10;
    if r.id is not null and current_date >= r.planned_start - 45 and current_date <= r.planned_end + 30 then
      select coalesce(sum(qty_tonnes), 0) into v_sign from supply_agreements where season_id = v_s.id and crop = 'cassava' and status in ('signed','delivered');
      v_exp := v_s.acres * setting_num('expected_yield_cassava', 8);
      if v_sign < 0.6 * v_exp then
        perform notify('sales', null, 'Lock in cassava buyers', 'Only ' || round(v_sign) || ' t of about ' || round(v_exp) || ' t expected is under signed agreements.', '#/agreements', 'warning', 'buyers-low:' || to_char(current_date, 'IYYY-IW'));
        perform notify('ops_manager', null, 'Cassava not yet pre-sold', 'Under 60% of expected tonnage is contracted.', '#/agreements', 'warning', 'buyers-low-o:' || to_char(current_date, 'IYYY-IW'));
      end if;
    end if;
    select * into r from stages where season_id = v_s.id and seq = 11;
    if r.id is not null then
      if current_date = r.planned_start - 14 then
        perform notify('ops_manager', null, 'Cassava harvest window opens in 14 days', 'Plan sample digs, labour and transport.', '#/gantt', 'info', 'hw-open:' || r.id);
      end if;
      if r.window_end is not null and current_date = r.window_end - 14 then
        perform notify('admin', null, 'Cassava harvest window closes in 14 days', 'Roots past 8 months lose starch quality and price.', '#/gantt', 'warning', 'hw-close:' || r.id);
      end if;
    end if;

    for r in select id from bank_accounts loop perform reconcile_bank(r.id); end loop;
    if exists (select 1 from bank_statement_lines where status = 'unmatched' and line_date < current_date - 14) then
      perform notify('accountant', null, 'Unreconciled bank lines older than 14 days', 'Review exceptions in Bank reconciliation.', '#/bank', 'warning', 'unrec:' || to_char(current_date, 'IYYY-IW'));
    end if;

    update automation_runs set status = 'ok', finished_at = now(), detail = jsonb_build_object('overdue_tasks', v_cnt) where id = v_run;
  exception when others then
    update automation_runs set status = 'failed', finished_at = now(), detail = jsonb_build_object('error', sqlerrm) where id = v_run;
  end;
end $$;

create or replace function job_weekly() returns void
language plpgsql security definer set search_path = public as $$
declare v_run uuid; v_id uuid;
begin
  insert into automation_runs(job) values ('job_weekly') returning id into v_run;
  begin
    v_id := generate_basic_report('weekly');
    perform notify('admin', null, 'Weekly farm report is ready', 'Open Reports to read it.', '#/reports', 'info', 'weekly:' || to_char(current_date, 'IYYY-IW'));
    perform notify('ops_manager', null, 'Weekly farm report is ready', 'Open Reports to read it.', '#/reports', 'info', 'weekly-o:' || to_char(current_date, 'IYYY-IW'));
    update automation_runs set status = 'ok', finished_at = now(), detail = jsonb_build_object('report', v_id) where id = v_run;
  exception when others then
    update automation_runs set status = 'failed', finished_at = now(), detail = jsonb_build_object('error', sqlerrm) where id = v_run;
  end;
end $$;

create or replace function job_month_end() returns void
language plpgsql security definer set search_path = public as $$
declare v_run uuid; v_start date := (date_trunc('month', current_date) - interval '1 month')::date; v_end date := (date_trunc('month', current_date) - interval '1 day')::date;
        v_dep numeric; v_pay uuid; v_id uuid;
begin
  insert into automation_runs(job) values ('job_month_end') returning id into v_run;
  begin
    v_dep := run_depreciation(v_end);
    v_pay := run_payroll_draft(v_start, v_end);
    perform snapshot_month(to_char(v_start, 'YYYY-MM'));
    perform generate_tax_filings(v_start);
    v_id := generate_basic_report('monthly');
    perform notify('accountant', null, 'Month-end drafted', 'Depreciation posted, payroll drafted and statements saved for ' || to_char(v_start, 'YYYY-MM') || '. Review and approve.', '#/statements', 'info', 'month-end:' || to_char(v_start, 'YYYY-MM'));
    perform notify('admin', null, 'Payroll draft awaiting approval', 'Review the draft payroll for ' || to_char(v_start, 'YYYY-MM'), '#/payroll', 'info', 'payroll-draft:' || to_char(v_start, 'YYYY-MM'));
    update automation_runs set status = 'ok', finished_at = now(), detail = jsonb_build_object('depreciation', v_dep, 'payroll_run', v_pay, 'report', v_id) where id = v_run;
  exception when others then
    update automation_runs set status = 'failed', finished_at = now(), detail = jsonb_build_object('error', sqlerrm) where id = v_run;
  end;
end $$;

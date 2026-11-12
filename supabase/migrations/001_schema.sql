-- ASO FARM Management System, Phase 1
-- 001: schema (tables, enums, indexes)
-- Run order: 001 -> 002 -> 003 -> 004 -> 005 -> 006

create extension if not exists pgcrypto;

do $$ begin
  create type app_role as enum ('admin','ops_manager','supervisor','accountant','sales','research');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- core
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role app_role,
  phone text,
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  is_secret boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phase int not null default 1,
  acres numeric not null default 10,
  start_date date not null,
  working_capital numeric not null default 2000000,
  status text not null default 'planning' check (status in ('planning','active','closed')),
  cassava_harvest_min_months int not null default 6,
  cassava_harvest_max_months int not null default 8,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists blocks (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references seasons(id) on delete cascade,
  name text not null,
  acres numeric not null,
  crop text default 'cassava',
  status text default 'active',
  created_at timestamptz not null default now()
);

-- templates used to generate a season
create table if not exists stage_templates (
  seq int primary key,
  name text not null,
  crop text not null check (crop in ('cassava','maize1','maize2','general')),
  grp text not null,
  start_offset int not null,
  end_offset int not null,
  window_end_offset int,
  owner_role app_role not null,
  weight numeric not null default 1
);

create table if not exists task_templates (
  id serial primary key,
  stage_seq int not null references stage_templates(seq) on delete cascade,
  title text not null,
  assignee_role app_role not null,
  start_offset int not null default 0,
  duration_days int not null default 7,
  priority text not null default 'normal'
);

create table if not exists budget_templates (
  id serial primary key,
  stage_seq int references stage_templates(seq) on delete cascade,
  category_name text not null,
  description text,
  amount_per_10_acres numeric not null,
  offset_days int not null default 0,
  spread_months int not null default 1
);

create table if not exists revenue_templates (
  id serial primary key,
  crop text not null,
  stage_seq int not null references stage_templates(seq) on delete cascade,
  days_after_end int not null default 0,
  amount_per_10_acres numeric not null,
  description text
);

create table if not exists stages (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  seq int not null,
  name text not null,
  crop text not null,
  grp text not null,
  planned_start date not null,
  planned_end date not null,
  window_end date,
  actual_start date,
  actual_end date,
  weight numeric not null default 1,
  owner_role app_role,
  progress numeric not null default 0,
  status text not null default 'not_started' check (status in ('not_started','in_progress','done')),
  unique (season_id, seq)
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references seasons(id) on delete cascade,
  stage_id uuid references stages(id) on delete cascade,
  title text not null,
  description text,
  assignee_role app_role,
  assignee_id uuid references profiles(id) on delete set null,
  start_date date,
  due_date date,
  status text not null default 'todo' check (status in ('todo','in_progress','done','blocked')),
  progress int not null default 0 check (progress between 0 and 100),
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists field_logs (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references seasons(id) on delete cascade,
  block_id uuid references blocks(id) on delete set null,
  stage_id uuid references stages(id) on delete set null,
  log_date date not null default current_date,
  activity text not null,
  labour_count int default 0,
  hours numeric default 0,
  labour_cost numeric default 0,
  notes text,
  photo_path text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  kind text not null default 'casual' check (kind in ('staff','casual')),
  role_title text,
  profile_id uuid references profiles(id) on delete set null,
  monthly_salary numeric not null default 0,
  daily_rate numeric not null default 0,
  phone text,
  bank_name text,
  account_no text,
  pension_applicable boolean not null default false,
  active boolean not null default true,
  start_date date default current_date,
  created_at timestamptz not null default now()
);

create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  work_date date not null default current_date,
  employee_id uuid not null references employees(id) on delete cascade,
  days numeric not null default 1 check (days > 0 and days <= 1),
  rate numeric,
  block_id uuid references blocks(id) on delete set null,
  stage_id uuid references stages(id) on delete set null,
  notes text,
  recorded_by uuid default auth.uid(),
  unique (employee_id, work_date)
);

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  contact text,
  phone text,
  email text,
  location text,
  rating int check (rating between 1 and 5),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  unit text not null default 'unit',
  qty_on_hand numeric not null default 0,
  reorder_level numeric not null default 0,
  unit_cost numeric not null default 0
);

create table if not exists stock_moves (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references inventory_items(id) on delete cascade,
  move_date date not null default current_date,
  qty numeric not null,
  reason text,
  stage_id uuid references stages(id) on delete set null,
  block_id uuid references blocks(id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists procurement_orders (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references seasons(id) on delete cascade,
  stage_id uuid references stages(id) on delete set null,
  item_id uuid references inventory_items(id) on delete set null,
  description text not null,
  qty numeric not null default 1,
  unit text,
  unit_cost numeric not null default 0,
  total numeric generated always as (qty * unit_cost) stored,
  supplier_id uuid references suppliers(id) on delete set null,
  needed_by date,
  status text not null default 'requested' check (status in ('requested','approved','ordered','received','cancelled')),
  transaction_id uuid,
  requested_by uuid default auth.uid(),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists sops (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  stage_seq int,
  version text not null default '1.0',
  body text not null,
  owner_role app_role,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists risks (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references seasons(id) on delete cascade,
  title text not null,
  category text,
  likelihood int not null default 3 check (likelihood between 1 and 5),
  impact int not null default 3 check (impact between 1 and 5),
  score int generated always as (likelihood * impact) stored,
  mitigation text,
  owner_role app_role,
  status text not null default 'open' check (status in ('open','mitigating','closed')),
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  incident_date date not null default current_date,
  type text not null default 'safety' check (type in ('safety','environment','theft','equipment','other')),
  severity text not null default 'low' check (severity in ('low','medium','high')),
  description text not null,
  action_taken text,
  status text not null default 'open' check (status in ('open','closed')),
  reported_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists compliance_checks (
  id uuid primary key default gen_random_uuid(),
  area text not null check (area in ('safety','environment','agrochemical','labour')),
  item text not null,
  frequency text not null default 'monthly' check (frequency in ('weekly','monthly','seasonal')),
  last_checked date,
  status text not null default 'attention' check (status in ('ok','attention','overdue')),
  notes text,
  owner_role app_role default 'supervisor'
);

-- ---------------------------------------------------------------- research
create table if not exists weather_readings (
  id uuid primary key default gen_random_uuid(),
  reading_date date not null unique,
  rain_mm numeric,
  temp_max numeric,
  temp_min numeric,
  source text default 'open-meteo',
  created_at timestamptz not null default now()
);

create table if not exists soil_samples (
  id uuid primary key default gen_random_uuid(),
  block_id uuid references blocks(id) on delete set null,
  sample_date date not null default current_date,
  ph numeric,
  organic_matter_pct numeric,
  nitrogen_pct numeric,
  phosphorus_ppm numeric,
  potassium_cmol numeric,
  texture text,
  notes text,
  created_by uuid default auth.uid()
);

create table if not exists crop_observations (
  id uuid primary key default gen_random_uuid(),
  block_id uuid references blocks(id) on delete set null,
  obs_date date not null default current_date,
  crop text default 'cassava',
  growth_stage text,
  plant_height_cm numeric,
  canopy_cover_pct numeric,
  disease_score int check (disease_score between 0 and 5),
  pest_score int check (pest_score between 0 and 5),
  notes text,
  photo_path text,
  created_by uuid default auth.uid()
);

create table if not exists disease_cases (
  id uuid primary key default gen_random_uuid(),
  block_id uuid references blocks(id) on delete set null,
  case_date date not null default current_date,
  crop text default 'cassava',
  symptoms text,
  photo_path text,
  ai_assessment text,
  status text not null default 'new' check (status in ('new','assessed','treated','closed')),
  treatment text,
  created_by uuid default auth.uid()
);

create table if not exists yield_samples (
  id uuid primary key default gen_random_uuid(),
  block_id uuid references blocks(id) on delete set null,
  sample_date date not null default current_date,
  crop text not null default 'cassava',
  sample_area_m2 numeric not null check (sample_area_m2 > 0),
  fresh_weight_kg numeric not null,
  notes text,
  created_by uuid default auth.uid()
);

create table if not exists tech_pilots (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tech text not null default 'ai_cv' check (tech in ('ai_cv','drone','satellite','sensors','other')),
  objective text,
  status text not null default 'idea' check (status in ('idea','planning','running','review','done')),
  owner text,
  start_date date,
  findings text
);

create table if not exists research_notes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  tags text[] default '{}',
  document_path text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- sales
create table if not exists buyers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  buyer_type text not null default 'processor' check (buyer_type in ('processor','flour_mill','starch_producer','feed_manufacturer','wholesaler','distributor','cooperative','other')),
  crops text[] default '{cassava,maize}',
  location text,
  contact_name text,
  phone text,
  email text,
  status text not null default 'lead' check (status in ('lead','contacted','negotiating','active','inactive')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists market_prices (
  id uuid primary key default gen_random_uuid(),
  price_date date not null default current_date,
  crop text not null check (crop in ('cassava','maize','cassava_flour','garri','other')),
  market text not null,
  price_per_tonne numeric not null,
  source text,
  unique (price_date, crop, market)
);

create table if not exists supply_agreements (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references seasons(id) on delete cascade,
  buyer_id uuid not null references buyers(id) on delete cascade,
  crop text not null check (crop in ('cassava','maize')),
  qty_tonnes numeric not null,
  price_per_tonne numeric not null,
  delivery_start date,
  delivery_end date,
  status text not null default 'prospect' check (status in ('prospect','negotiating','signed','delivered','cancelled')),
  deposit_amount numeric not null default 0,
  terms text,
  created_at timestamptz not null default now()
);

create table if not exists sales_orders (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references seasons(id) on delete cascade,
  agreement_id uuid references supply_agreements(id) on delete set null,
  buyer_id uuid not null references buyers(id),
  crop text not null check (crop in ('cassava','maize')),
  qty_tonnes numeric not null,
  price_per_tonne numeric not null,
  amount numeric generated always as (qty_tonnes * price_per_tonne) stored,
  order_date date not null default current_date,
  status text not null default 'open' check (status in ('open','delivered','invoiced','cancelled'))
);

create table if not exists deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references sales_orders(id) on delete cascade,
  delivery_date date not null default current_date,
  qty_tonnes numeric not null,
  vehicle text,
  driver text,
  status text not null default 'scheduled' check (status in ('scheduled','in_transit','delivered','rejected')),
  notes text
);

create table if not exists revenue_plan (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  crop text,
  planned_date date not null,
  amount numeric not null,
  description text
);

-- ---------------------------------------------------------------- finance
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type text not null check (type in ('asset','liability','equity','income','expense')),
  active boolean not null default true
);

create table if not exists expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  account_id uuid not null references accounts(id),
  grp text not null check (grp in ('field','labour','inputs','management','equipment','payroll','other')),
  is_management boolean not null default false
);

create table if not exists bank_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'bank' check (kind in ('bank','cash')),
  account_id uuid not null references accounts(id),
  opening_balance numeric not null default 0
);

create table if not exists budget_lines (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  phase int not null default 1,
  stage_id uuid references stages(id) on delete set null,
  category_id uuid not null references expense_categories(id),
  description text,
  amount numeric not null check (amount >= 0),
  planned_date date,
  spread_months int not null default 1
);

create table if not exists phase_targets (
  id uuid primary key default gen_random_uuid(),
  phase int not null,
  grp text not null check (grp in ('field','management','total')),
  label text not null,
  target_amount numeric not null,
  notes text,
  unique (phase, grp)
);

create table if not exists approval_rules (
  id serial primary key,
  min_amount numeric not null,
  max_amount numeric,
  approver_role app_role not null
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  txn_date date not null default current_date,
  kind text not null check (kind in ('expense','income','capital','asset_purchase')),
  status text not null default 'draft' check (status in ('draft','submitted','pending_approval','approved','paid','rejected')),
  category_id uuid references expense_categories(id),
  income_account_id uuid references accounts(id),
  season_id uuid references seasons(id) on delete set null,
  stage_id uuid references stages(id) on delete set null,
  block_id uuid references blocks(id) on delete set null,
  budget_line_id uuid references budget_lines(id) on delete set null,
  bank_account_id uuid references bank_accounts(id),
  payee text,
  description text,
  amount numeric not null check (amount > 0),
  reference text,
  receipt_path text,
  requested_by uuid default auth.uid(),
  required_role app_role,
  approved_by uuid,
  approved_at timestamptz,
  approval_note text,
  paid_at date,
  journal_entry_id uuid,
  asset_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  memo text,
  source_type text,
  source_id uuid,
  season_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references journal_entries(id) on delete cascade,
  account_id uuid not null references accounts(id),
  debit numeric not null default 0 check (debit >= 0),
  credit numeric not null default 0 check (credit >= 0),
  stage_id uuid,
  block_id uuid,
  memo text,
  check (debit = 0 or credit = 0)
);

create sequence if not exists invoice_seq start 1;

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('INV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('invoice_seq')::text, 4, '0')),
  buyer_id uuid references buyers(id),
  order_id uuid references sales_orders(id) on delete set null,
  delivery_id uuid unique references deliveries(id) on delete set null,
  season_id uuid references seasons(id) on delete set null,
  issue_date date not null default current_date,
  due_date date not null default (current_date + 14),
  amount numeric not null check (amount > 0),
  status text not null default 'draft' check (status in ('draft','issued','part_paid','paid','overdue','void')),
  description text,
  journal_entry_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  pay_date date not null default current_date,
  amount numeric not null check (amount > 0),
  bank_account_id uuid not null references bank_accounts(id),
  method text default 'transfer',
  reference text,
  journal_entry_id uuid,
  created_by uuid default auth.uid()
);

create table if not exists bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references bank_accounts(id) on delete cascade,
  line_date date not null,
  description text,
  reference text,
  debit numeric not null default 0,
  credit numeric not null default 0,
  balance numeric,
  status text not null default 'unmatched' check (status in ('unmatched','matched','ignored')),
  matched_type text,
  matched_id uuid,
  import_batch text,
  created_at timestamptz not null default now()
);

create table if not exists payroll_runs (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft','approved','paid')),
  total_gross numeric not null default 0,
  total_net numeric not null default 0,
  notes text,
  journal_entry_id uuid,
  created_by uuid default auth.uid(),
  approved_by uuid,
  paid_at date,
  created_at timestamptz not null default now(),
  unique (period_start, period_end)
);

create table if not exists payroll_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references payroll_runs(id) on delete cascade,
  employee_id uuid not null references employees(id),
  days numeric default 0,
  gross numeric not null default 0,
  paye numeric not null default 0,
  pension_employee numeric not null default 0,
  pension_employer numeric not null default 0,
  net numeric not null default 0,
  notes text
);

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'equipment' check (category in ('equipment','tools','vehicle','land_improvement','investment','other')),
  purchase_date date not null default current_date,
  cost numeric not null check (cost >= 0),
  useful_life_years numeric not null default 5,
  salvage_value numeric not null default 0,
  location text,
  serial_no text,
  status text not null default 'active' check (status in ('active','under_repair','disposed')),
  transaction_id uuid,
  accumulated_depreciation numeric not null default 0,
  last_depreciated date,
  notes text
);

create table if not exists tax_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  authority text,
  frequency text not null default 'monthly' check (frequency in ('monthly')),
  due_day int not null default 10,
  owner_role app_role default 'accountant',
  notes text,
  active boolean not null default true
);

create table if not exists tax_filings (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references tax_items(id) on delete cascade,
  period text not null,
  due_date date not null,
  status text not null default 'due' check (status in ('due','filed','late','not_applicable')),
  filed_date date,
  reference text,
  document_path text,
  notes text,
  unique (item_id, period)
);

create table if not exists financial_snapshots (
  id uuid primary key default gen_random_uuid(),
  period text not null,
  kind text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique (period, kind)
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  doc_type text not null default 'other' check (doc_type in ('receipt','invoice','contract','audit','tax','report','other')),
  storage_path text not null,
  linked_table text,
  linked_id uuid,
  notes text,
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- platform
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  report_type text not null check (report_type in ('weekly','monthly','finance_monthly','market','research','custom')),
  period text,
  title text not null,
  body_md text,
  data jsonb,
  audience app_role[] not null default '{admin}',
  generated_by text not null default 'system',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  to_user uuid references profiles(id) on delete cascade,
  to_role app_role,
  title text not null,
  body text,
  link text,
  level text not null default 'info' check (level in ('info','warning','critical')),
  read_by uuid[] not null default '{}',
  dedupe_key text,
  created_at timestamptz not null default now()
);
create unique index if not exists notifications_dedupe_idx on notifications(dedupe_key) where dedupe_key is not null;

create table if not exists audit_log (
  id bigserial primary key,
  table_name text not null,
  record_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  user_id uuid,
  at timestamptz not null default now()
);

create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  detail jsonb
);

create table if not exists responsibilities (
  id serial primary key,
  role app_role not null,
  seq int not null,
  text text not null,
  module text,
  automation text
);

-- ---------------------------------------------------------------- indexes
create index if not exists idx_tasks_stage on tasks(stage_id);
create index if not exists idx_tasks_due on tasks(due_date) where status <> 'done';
create index if not exists idx_txn_status on transactions(status);
create index if not exists idx_txn_budget on transactions(budget_line_id);
create index if not exists idx_jl_entry on journal_lines(entry_id);
create index if not exists idx_jl_account on journal_lines(account_id);
create index if not exists idx_bsl_bank on bank_statement_lines(bank_account_id, status);
create index if not exists idx_inv_status on invoices(status);
create index if not exists idx_notif_role on notifications(to_role);
create index if not exists idx_audit_table on audit_log(table_name, at desc);

-- procurement links to finance tables (added after those tables exist)
alter table procurement_orders add column if not exists category_id uuid references expense_categories(id);
alter table procurement_orders add column if not exists budget_line_id uuid references budget_lines(id) on delete set null;

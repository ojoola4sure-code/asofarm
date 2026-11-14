-- 007: public investor and support page
-- Nothing is public until an admin turns on setting public_page_enabled and publishes content.
-- Visitors (not signed in) can only call two functions: public_overview() and submit_inquiry().

create table if not exists public_content (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  title text not null,
  body_md text not null default '',
  sort int not null default 100,
  published boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public_updates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  photo_path text,
  update_date date not null default current_date,
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists investor_inquiries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('invest','support','partner','buy','other')),
  name text not null,
  email text not null,
  phone text,
  organisation text,
  amount_range text,
  message text,
  status text not null default 'new' check (status in ('new','contacted','in_talks','committed','declined','closed')),
  notes text,
  contacted_at timestamptz,
  created_at timestamptz not null default now()
);

-- staff access (admin passes every check)
select _rls('public_content', array['ops_manager','sales']::app_role[], array[]::app_role[]);
select _rls('public_updates', array['ops_manager','sales']::app_role[], array['ops_manager','sales']::app_role[]);
select _rls('investor_inquiries', array['sales','ops_manager']::app_role[], array['sales','ops_manager']::app_role[]);
revoke execute on function _rls(text, app_role[], app_role[], boolean) from authenticated;

insert into app_settings(key, value, description, is_secret) values
  ('public_page_enabled', '0', '1 = the public investor and support page at /invest is open to everyone', false),
  ('public_show_spend', '0', '1 = show money spent so far on the public page (planned budget is always shown when the page is open)', false),
  ('public_show_sops', '1', '1 = show the step-by-step method for each stage on the public page', false),
  ('public_name', '"ASO FARM"', 'Name shown on the public page', false),
  ('public_phone', '"09068290425"', 'Phone number shown on the public page (tap to call)', false),
  ('public_whatsapp', '"2349068290425"', 'WhatsApp number in international format without +', false),
  ('public_email', '"asoinovisionpro@gmail.com"', 'Email shown on the public page', false),
  ('public_address', '"The Professional Place, 9B Ololade Odeyemi Close, Anthony Village, Lagos, Nigeria"', 'Address shown on the public page', false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------- public read
create or replace function public_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_s seasons; v_contact jsonb; v_prog numeric; v_stages jsonb; v_budget jsonb; v_content jsonb; v_updates jsonb;
  v_sops jsonb; v_h stages; v_spent numeric; v_show_spend numeric; v_show_sops numeric; v_tasks jsonb;
begin
  v_contact := jsonb_build_object(
    'name', (select value #>> '{}' from app_settings where key = 'public_name'),
    'phone', (select value #>> '{}' from app_settings where key = 'public_phone'),
    'whatsapp', (select value #>> '{}' from app_settings where key = 'public_whatsapp'),
    'email', (select value #>> '{}' from app_settings where key = 'public_email'),
    'address', (select value #>> '{}' from app_settings where key = 'public_address'));
  if setting_num('public_page_enabled', 0) <= 0 then
    return jsonb_build_object('enabled', false, 'contact', v_contact);
  end if;
  v_show_spend := setting_num('public_show_spend', 0);
  v_show_sops := setting_num('public_show_sops', 1);
  select * into v_s from seasons where id = current_season();

  select coalesce(sum(progress * weight) / nullif(sum(weight), 0), 0) into v_prog from stages where season_id = v_s.id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'seq', s.seq, 'name', s.name, 'grp', s.grp, 'crop', s.crop,
      'planned_start', s.planned_start, 'planned_end', s.planned_end, 'window_end', s.window_end,
      'progress', s.progress, 'status', s.status,
      'tasks_total', (select count(*) from tasks t where t.stage_id = s.id),
      'tasks_done', (select count(*) from tasks t where t.stage_id = s.id and t.status = 'done')) order by s.seq), '[]'::jsonb)
    into v_stages from stages s where s.season_id = v_s.id;
  select * into v_h from stages where season_id = v_s.id and seq = 11;
  select jsonb_build_object('total', count(*), 'done', count(*) filter (where status = 'done')) into v_tasks from tasks where season_id = v_s.id;

  select coalesce(jsonb_agg(jsonb_build_object('label', g.label, 'amount', g.amt) order by g.ord), '[]'::jsonb) into v_budget
  from (select x.label, x.ord, sum(x.amount) as amt from (
          select case when c.is_management then 'Management expenses' when st.crop = 'cassava' then 'Cassava field costs'
                      when st.crop like 'maize%' then 'Maize field costs' else 'Other costs' end as label,
                 case when c.is_management then 3 when st.crop = 'cassava' then 1 when st.crop like 'maize%' then 2 else 4 end as ord,
                 b.amount
          from budget_lines b join expense_categories c on c.id = b.category_id left join stages st on st.id = b.stage_id
          where b.season_id = v_s.id) x group by x.label, x.ord) g;
  if v_show_spend > 0 then
    select coalesce(sum(amount), 0) into v_spent from transactions where season_id = v_s.id and status = 'paid' and kind = 'expense';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'title', title, 'body_md', body_md) order by sort, key), '[]'::jsonb)
    into v_content from public_content where published;
  select coalesce(jsonb_agg(jsonb_build_object('title', u.title, 'body', u.body, 'photo_path', u.photo_path, 'date', u.update_date) order by u.update_date desc), '[]'::jsonb)
    into v_updates from (select * from public_updates where published order by update_date desc limit 12) u;
  if v_show_sops > 0 then
    select coalesce(jsonb_agg(jsonb_build_object('stage_seq', stage_seq, 'title', title, 'body', body) order by stage_seq), '[]'::jsonb)
      into v_sops from sops where active and stage_seq is not null;
  else v_sops := '[]'::jsonb; end if;

  return jsonb_build_object(
    'enabled', true, 'contact', v_contact,
    'season', jsonb_build_object('name', v_s.name, 'acres', v_s.acres, 'start_date', v_s.start_date, 'status', v_s.status, 'working_capital', v_s.working_capital),
    'progress', round(v_prog, 1), 'tasks', v_tasks, 'stages', v_stages,
    'harvest', jsonb_build_object('start', v_h.planned_start, 'end', v_h.planned_end, 'window_end', v_h.window_end),
    'budget', jsonb_build_object('groups', v_budget, 'spent', v_spent),
    'content', v_content, 'updates', v_updates, 'sops', v_sops, 'generated_at', now());
end $$;

-- ---------------------------------------------------------------- public write
create or replace function submit_inquiry(p_kind text, p_name text, p_email text, p_phone text, p_org text,
                                          p_amount text, p_message text, p_website text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_label text;
begin
  if coalesce(p_website, '') <> '' then return jsonb_build_object('ok', true); end if;          -- honeypot: bots fill hidden fields
  if setting_num('public_page_enabled', 0) <= 0 then raise exception 'This page is not open yet.'; end if;
  if p_kind not in ('invest','support','partner','buy','other') then raise exception 'Choose what you would like to do.'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 or length(p_name) > 120 then raise exception 'Please enter your name.'; end if;
  if coalesce(p_email, '') !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(p_email) > 200 then raise exception 'Please enter a valid email address.'; end if;
  if length(coalesce(p_message, '')) > 2000 or length(coalesce(p_phone, '')) > 40 or length(coalesce(p_org, '')) > 160 or length(coalesce(p_amount, '')) > 60 then
    raise exception 'One of the fields is too long.';
  end if;
  if (select count(*) from investor_inquiries where lower(email) = lower(p_email) and created_at > now() - interval '1 day') >= 3 then
    raise exception 'We already have your messages. We will reply soon.';
  end if;
  if (select count(*) from investor_inquiries where created_at > now() - interval '1 hour') >= 60 then
    raise exception 'We are receiving many messages right now. Please call or email us directly.';
  end if;
  insert into investor_inquiries(kind, name, email, phone, organisation, amount_range, message)
  values (p_kind, trim(p_name), trim(p_email), nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_org, '')), ''),
          nullif(trim(coalesce(p_amount, '')), ''), nullif(trim(coalesce(p_message, '')), '')) returning id into v_id;
  v_label := case p_kind when 'invest' then 'Investment enquiry' when 'support' then 'Support offer' when 'partner' then 'Partnership enquiry' when 'buy' then 'Buyer enquiry' else 'Enquiry' end;
  perform notify('admin', null, v_label || ' from ' || trim(p_name), coalesce(nullif(p_amount, ''), '') || ' ' || left(coalesce(p_message, ''), 140), '#/inquiries', 'info', 'inq-a:' || v_id);
  perform notify('sales', null, v_label || ' from ' || trim(p_name), coalesce(nullif(p_amount, ''), '') || ' ' || left(coalesce(p_message, ''), 140), '#/inquiries', 'info', 'inq-s:' || v_id);
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public_overview() to anon, authenticated;
grant execute on function submit_inquiry(text, text, text, text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------- public photos
insert into storage.buckets(id, name, public) values ('public-media', 'public-media', true) on conflict (id) do nothing;
drop policy if exists "public media upload" on storage.objects;
drop policy if exists "public media delete" on storage.objects;
create policy "public media upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'public-media' and public.has_role(array['sales','ops_manager']::app_role[]));
create policy "public media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'public-media' and public.has_role(array['sales','ops_manager']::app_role[]));

-- ---------------------------------------------------------------- draft content (unpublished; edit, then publish)
insert into public_content(key, title, body_md, sort, published) values
('hero', 'Grow with a farm that shows its work',
 $md$ASO FARM is the agribusiness arm of ASO INOVISION. We start with 10 acres of cassava and maize in Oyo State, prove the numbers season by season, and scale step by step toward 2,000 acres and processing. Every task, naira and harvest is tracked in a live system, and you can watch the progress below.$md$, 10, false),
('opportunity', 'Why cassava and maize',
 $md$- Cassava and maize are staple crops with steady demand from flour mills, starch producers, feed manufacturers and traders.
- Prices move a lot between seasons, so we line up buyers before harvest and stage our harvest instead of selling everything at once.
- The larger margin is in processing (flour, starch, feed). We plan it for Year 5, once volumes justify a plant.$md$, 20, false),
('plan', 'The plan',
 $md$- **Phase 1, Year 1: 10 acres.** Prove yields, costs and buyers with one cassava crop (harvested at 6 to 8 months) and two maize cycles on the same land.
- **Phase 2, Year 2: 100 acres.** Add a small specialist team and sign buyers before harvest.
- **Phase 3, Years 3 and 4: 300 acres.** Own tractors, run the farm through a manager, and fund growth from profit.
- **Year 5: processing.** Turn cassava into flour and maize into feed once volumes justify a plant.
- **Years 6 to 10: 1,000, then 1,500, then 2,000 acres,** with the machinery bought by Year 8.

Each step starts only when the one before it has met its yield, cost and sales targets.$md$, 30, false),
('how', 'How it is done',
 $md$We follow the same four moves every time, because skipping one is where farms and systems usually break.

- **Diagnose.** Survey the land, test the soil, and plan each block before spending money.
- **Prototype.** Plant a first season at small scale and measure real yields and real costs.
- **Deploy.** Run the season to a written schedule with named people, budgets and approvals.
- **Scale.** Add acres only when the numbers from the last step say we can.$md$, 40, false),
('use_of_funds', 'Use of funds, Phase 1',
 $md$Phase 1 costs about ₦8.1m across the full year: about ₦7.5m on field work (land preparation, stems, labour, fertiliser, herbicide, harvest and shelling) and about ₦0.6m on transport, storage, insurance and admin. There are no salaried staff in Phase 1.

The founder has committed ₦2m of working capital. Our cash forecast shows a temporary gap of roughly ₦1.2m around the months before the first cassava sales. A bridge of that size, plus a safety margin, is the immediate need.$md$, 50, false),
('projections', 'What we expect (estimates, not promises)',
 $md$For Phase 1, before any pay to the founder:

- **Cautious case:** income about ₦9.0m, result about ₦0.9m.
- **Realistic case:** income about ₦14.5m, result about ₦6.4m.
- **Target case:** income about ₦19.2m, result about ₦11.1m.

These depend on yields, prices and weather. A poor season can produce a loss. Later phases are plans, not forecasts.$md$, 60, false),
('support', 'Ways to back the farm',
 $md$- **Invest.** Structure and terms (for example equity, revenue share or a loan) are agreed one-to-one.
- **Pre-buy produce.** Sign a supply agreement with a deposit; we deliver at harvest.
- **Supply inputs or services.** Stems, fertiliser, tractor hire, transport or storage on supplier terms.
- **Land and equipment.** Access to farmland, tractors, irrigation or processing equipment.
- **Knowledge and introductions.** Agronomy advice, buyer introductions, mentorship.$md$, 70, false),
('reporting', 'How we keep you informed',
 $md$- A weekly farm report and a monthly management report, written from live data.
- Separate books for the farm, with every payment approved, posted and kept in an audit trail.
- Photos and a plain-language update after each stage.
- Supporters and investors receive the monthly report; further access can be arranged.$md$, 80, false),
('risks', 'What can go wrong, and what we do about it',
 $md$- **Prices fall or buyers delay.** We contract buyers before harvest and sell in stages.
- **Low yields.** Certified stems, soil tests, on-time planting and an agronomist.
- **Dry-season maize.** We plan water before the second maize cycle.
- **Cash shortfall.** Weekly cash forecast and staged spending.
- **Pests and disease.** Weekly scouting with photo records.
- **Theft, labour or land issues.** Fencing, written agreements and early crew booking.$md$, 90, false)
on conflict (key) do nothing;

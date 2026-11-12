-- 004: seed data. Safe to re-run (templates are replaced, reference data is skipped if present).

-- ---------------------------------------------------------------- settings
insert into app_settings(key, value, description, is_secret) values
  ('auto_approve_limit', '20000', 'Expenses at or under this amount, inside budget, are approved automatically (naira)', false),
  ('invoice_terms_days', '14', 'Default days from delivery to invoice due date', false),
  ('auto_issue_invoices', '1', '1 = invoices are issued automatically when a delivery is marked delivered', false),
  ('pension_employee_rate', '0.08', 'Employee pension rate used in payroll drafts (confirm with PenCom rules)', false),
  ('pension_employer_rate', '0.10', 'Employer pension rate used in payroll drafts (confirm with PenCom rules)', false),
  ('payroll_includes_casual', '0', '1 = casual attendance wages are included in monthly payroll drafts. Keep 0 if casual labour is paid through expense requests, to avoid double counting', false),
  ('expected_yield_cassava', '8', 'Expected cassava tonnes per acre (used for buyer cover alerts)', false),
  ('expected_yield_maize', '1.5', 'Expected maize tonnes per acre per cycle', false),
  ('farm_lat', '8.2', 'Farm latitude for weather sync. Replace with the exact Okaka, Itesiwaju coordinates', false),
  ('farm_lon', '3.6', 'Farm longitude for weather sync. Replace with the exact coordinates', false),
  ('openai_model', '"gpt-4o-mini"', 'Model used by AI reports and photo checks', false),
  ('function_base_url', '""', 'https://<project-ref>.supabase.co/functions/v1 (set after deploying edge functions)', false),
  ('cron_secret', '""', 'Shared secret sent by pg_cron to edge functions', true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------- chart of accounts
insert into accounts(code, name, type) values
  ('1000','Cash on hand','asset'),
  ('1010','Bank - main account','asset'),
  ('1100','Accounts receivable','asset'),
  ('1200','Inventory - farm inputs','asset'),
  ('1500','Farm equipment and tools','asset'),
  ('1510','Accumulated depreciation - equipment','asset'),
  ('1520','Land improvements','asset'),
  ('2000','Accounts payable','liability'),
  ('2100','Payroll and statutory liabilities','liability'),
  ('2200','Tax payable','liability'),
  ('2300','Loans','liability'),
  ('3000','Owner capital','equity'),
  ('3100','Retained earnings','equity'),
  ('4000','Cassava sales','income'),
  ('4010','Maize sales','income'),
  ('4020','Other income (stems, residues, services)','income'),
  ('5100','Land preparation','expense'),
  ('5110','Planting material','expense'),
  ('5120','Planting labour','expense'),
  ('5130','Weeding and herbicide','expense'),
  ('5140','Fertiliser','expense'),
  ('5150','Pest and disease control','expense'),
  ('5160','Harvest labour','expense'),
  ('5170','Maize seed','expense'),
  ('5180','Shelling, drying and bagging','expense'),
  ('5190','Land rent','expense'),
  ('5200','Casual wages','expense'),
  ('5210','Staff salaries','expense'),
  ('5220','Employer pension and on-costs','expense'),
  ('5300','Transport and fuel','expense'),
  ('5310','Storage and handling','expense'),
  ('5320','Insurance','expense'),
  ('5330','Admin and sundries','expense'),
  ('5340','Professional fees','expense'),
  ('5400','Depreciation','expense'),
  ('5410','Repairs and maintenance','expense'),
  ('5900','Contingency','expense')
on conflict (code) do nothing;

insert into expense_categories(name, account_id, grp, is_management)
select v.name, a.id, v.grp, v.mgmt
from (values
  ('Land preparation','5100','field',false),
  ('Planting material (stems)','5110','inputs',false),
  ('Planting labour','5120','labour',false),
  ('Weeding & herbicide','5130','field',false),
  ('Fertiliser','5140','inputs',false),
  ('Pest & disease control','5150','inputs',false),
  ('Harvest labour','5160','labour',false),
  ('Maize seed','5170','inputs',false),
  ('Shelling, drying & bagging','5180','field',false),
  ('Land rent','5190','field',false),
  ('Casual wages','5200','labour',false),
  ('Staff salaries','5210','payroll',true),
  ('Employer pension & on-costs','5220','payroll',true),
  ('Transport & fuel','5300','management',true),
  ('Storage & handling','5310','management',true),
  ('Insurance','5320','management',true),
  ('Admin & sundries','5330','management',true),
  ('Professional fees','5340','management',true),
  ('Repairs & maintenance','5410','field',false),
  ('Contingency','5900','field',false),
  ('Equipment & tools (asset)','1500','equipment',false),
  ('Land improvement (asset)','1520','equipment',false)
) as v(name, code, grp, mgmt)
join accounts a on a.code = v.code
on conflict (name) do nothing;

insert into bank_accounts(name, kind, account_id)
select v.name, v.kind, a.id from (values ('Main bank account','bank','1010'), ('Cash on hand','cash','1000')) v(name, kind, code)
join accounts a on a.code = v.code
where not exists (select 1 from bank_accounts b where b.name = v.name);

delete from approval_rules;
insert into approval_rules(min_amount, max_amount, approver_role) values
  (0, 250000, 'ops_manager'),
  (250000.01, null, 'admin');

-- ---------------------------------------------------------------- season templates
delete from task_templates; delete from budget_templates; delete from revenue_templates; delete from stage_templates;

insert into stage_templates(seq, name, crop, grp, start_offset, end_offset, window_end_offset, owner_role, weight) values
  (1,  'Site survey, soil test & season plan',          'general', 'Preparation',    0,  14, null, 'ops_manager', 1),
  (2,  'Land preparation (cassava)',                     'cassava', 'Preparation',    7,  28, null, 'supervisor',  1.5),
  (3,  'Planting material sourcing & treatment',         'cassava', 'Preparation',   10,  27, null, 'ops_manager', 1),
  (4,  'Cassava planting',                               'cassava', 'Establishment', 28,  42, null, 'supervisor',  1.5),
  (5,  'Gap filling & establishment',                    'cassava', 'Establishment', 56,  70, null, 'supervisor',  1),
  (6,  'First weeding & herbicide',                      'cassava', 'Maintenance',   70,  90, null, 'supervisor',  1),
  (7,  'Fertiliser application',                         'cassava', 'Maintenance',  100, 120, null, 'supervisor',  1),
  (8,  'Second weeding & maintenance',                   'cassava', 'Maintenance',  130, 150, null, 'supervisor',  1),
  (9,  'Pest & disease scouting',                        'cassava', 'Maintenance',   42, 215, null, 'research',    1),
  (10, 'Harvest readiness & buyer lock-in',              'cassava', 'Harvest',      185, 215, null, 'sales',       1),
  (11, 'Cassava harvest (6 to 8 month window)',          'cassava', 'Harvest',      215, 245, 275,  'supervisor',  2),
  (12, 'Cassava post-harvest, delivery & payment',       'cassava', 'Post-harvest', 220, 270, null, 'sales',       1.5),
  (13, 'Maize 1: land prep & planting',                  'maize1',  'Establishment',240, 255, null, 'supervisor',  1),
  (14, 'Maize 1: fertiliser & weed control',             'maize1',  'Maintenance',  275, 305, null, 'supervisor',  1),
  (15, 'Maize 1: maintenance & scouting',                'maize1',  'Maintenance',  255, 335, null, 'research',    1),
  (16, 'Maize 1: harvest',                               'maize1',  'Harvest',      335, 350, null, 'supervisor',  1.5),
  (17, 'Maize 1: post-harvest, storage & sales',         'maize1',  'Post-harvest', 345, 380, null, 'sales',       1),
  (18, 'Maize 2: land prep & planting',                  'maize2',  'Establishment',350, 365, null, 'supervisor',  1),
  (19, 'Maize 2: fertiliser & weed control',             'maize2',  'Maintenance',  385, 415, null, 'supervisor',  1),
  (20, 'Maize 2: maintenance, irrigation & scouting',    'maize2',  'Maintenance',  365, 440, null, 'research',    1),
  (21, 'Maize 2: harvest',                               'maize2',  'Harvest',      440, 455, null, 'supervisor',  1.5),
  (22, 'Maize 2: post-harvest, storage & sales',         'maize2',  'Post-harvest', 450, 485, null, 'sales',       1),
  (23, 'Season close-out & Phase 2 readiness',           'general', 'Close-out',    470, 500, null, 'accountant',  1);

insert into task_templates(stage_seq, title, assignee_role, start_offset, duration_days, priority) values
  (1,'Confirm land access, lease terms and block boundaries','ops_manager',0,5,'high'),
  (1,'Take soil samples per block and send for lab test','research',0,7,'normal'),
  (1,'Approve season plan, budget and working capital','admin',0,5,'high'),
  (1,'Open bank account and set approval limits in the system','accountant',0,7,'high'),
  (1,'Register suppliers and collect three quotes for stems, fertiliser and herbicide','ops_manager',3,9,'normal'),
  (1,'Set up buyer pipeline and start market price tracking','sales',3,10,'normal'),
  (2,'Clear vegetation and remove stumps','supervisor',0,7,'high'),
  (2,'Plough and harrow (hired tractor)','supervisor',6,7,'high'),
  (2,'Ridge or mound the blocks','supervisor',12,7,'normal'),
  (2,'Pay land preparation contractor and log the cost','accountant',16,5,'normal'),
  (2,'Photograph each block and record baseline GPS points','research',18,3,'low'),
  (3,'Source certified stems from an approved supplier','ops_manager',0,8,'high'),
  (3,'Inspect stems for disease before purchase','research',5,3,'high'),
  (3,'Approve and pay the stem order','accountant',6,4,'normal'),
  (3,'Cut stems and treat with fungicide and insecticide dip','supervisor',9,5,'high'),
  (4,'Mark spacing and plant stems block by block','supervisor',0,10,'critical'),
  (4,'Record planting date and area planted per block','supervisor',10,2,'high'),
  (4,'Set up baseline monitoring plots','research',2,5,'normal'),
  (5,'Count sprouting and replant gaps','supervisor',0,10,'high'),
  (5,'Record establishment percentage per block','research',8,5,'normal'),
  (6,'Apply herbicide and record product and rate','supervisor',0,8,'high'),
  (6,'Deploy manual weeding crew','supervisor',4,12,'normal'),
  (6,'Approve and pay weeding labour against attendance','accountant',10,8,'normal'),
  (7,'Raise purchase order for fertiliser','ops_manager',0,7,'high'),
  (7,'Apply NPK to each block as recommended','supervisor',7,10,'critical'),
  (7,'Log fertiliser used per block','supervisor',17,3,'normal'),
  (8,'Complete second weeding round','supervisor',0,14,'normal'),
  (8,'Assess crop vigour and canopy cover','research',5,10,'normal'),
  (8,'Mid-season cost and budget review','accountant',10,7,'normal'),
  (9,'Weekly scouting and disease logging (continuous)','research',0,173,'normal'),
  (9,'Review disease photos and agree treatment','ops_manager',0,173,'normal'),
  (10,'Sign supply agreements covering at least 60% of expected cassava','sales',0,25,'critical'),
  (10,'Confirm harvest crew and transport','supervisor',5,20,'high'),
  (10,'Take sample digs and test root dry matter','research',10,10,'high'),
  (10,'Agree payment terms and prepare invoice templates','accountant',10,10,'normal'),
  (11,'Decide harvest timing from sample digs and buyer schedule','ops_manager',0,5,'critical'),
  (11,'Harvest block by block, weigh and record tonnes','supervisor',3,25,'critical'),
  (11,'Approve and pay harvest labour','accountant',10,20,'high'),
  (12,'Load and deliver to buyers, record delivery notes','sales',0,40,'critical'),
  (12,'Issue invoices and follow up payment','accountant',5,40,'high'),
  (12,'Reconcile cassava receipts to the bank statement','accountant',30,15,'normal'),
  (13,'Light tillage and weed control for maize','supervisor',0,6,'normal'),
  (13,'Buy maize seed and basal fertiliser','ops_manager',0,5,'high'),
  (13,'Plant maize at correct spacing','supervisor',6,8,'critical'),
  (14,'Top-dress with urea or NPK','supervisor',0,10,'high'),
  (14,'Herbicide and hand weeding','supervisor',8,15,'normal'),
  (15,'Weekly scouting for fall armyworm and disease','research',0,80,'normal'),
  (15,'Keep field labour and input log up to date','supervisor',0,80,'normal'),
  (16,'Check maturity and grain moisture','research',0,5,'high'),
  (16,'Harvest and move cobs to the drying area','supervisor',3,12,'critical'),
  (17,'Shell, dry to safe moisture and bag','supervisor',0,20,'high'),
  (17,'Sell or store maize and deliver to buyers','sales',5,30,'high'),
  (17,'Invoice, collect payment and reconcile','accountant',10,25,'normal'),
  (18,'Light tillage and plant second maize cycle','supervisor',0,12,'critical'),
  (18,'Buy maize seed and basal fertiliser','ops_manager',0,5,'high'),
  (19,'Top-dress and set up irrigation for the dry season','supervisor',0,12,'high'),
  (19,'Weed control','supervisor',10,15,'normal'),
  (20,'Irrigation schedule and pump log','supervisor',0,70,'high'),
  (20,'Weekly scouting and growth observations','research',0,70,'normal'),
  (21,'Check maturity and moisture, then harvest','supervisor',0,12,'critical'),
  (22,'Shell, dry, bag and store','supervisor',0,20,'high'),
  (22,'Sell maize and deliver to buyers','sales',5,30,'high'),
  (22,'Invoice, collect and reconcile maize receipts','accountant',10,25,'normal'),
  (23,'Close books: reconcile, depreciation, final statements','accountant',0,15,'high'),
  (23,'Compute profit per acre by crop and block','accountant',5,10,'high'),
  (23,'Review yields and write lessons learned','ops_manager',0,15,'normal'),
  (23,'Update SOPs and the expansion plan','ops_manager',10,15,'normal'),
  (23,'Complete the audit file','accountant',15,10,'normal'),
  (23,'Decide Phase 2 readiness using the checklist','admin',20,10,'high');

insert into budget_templates(stage_seq, category_name, description, amount_per_10_acres, offset_days, spread_months) values
  (1,  'Land rent', 'Land rent for the season', 30000, 0, 1),
  (1,  'Contingency', 'Contingency and sundries (cassava)', 70000, 0, 1),
  (2,  'Land preparation', 'Clearing, ploughing and ridging (hired tractor)', 450000, 7, 1),
  (3,  'Planting material (stems)', 'Certified cassava stems', 420000, 10, 1),
  (4,  'Planting labour', 'Planting crew', 280000, 0, 1),
  (6,  'Weeding & herbicide', 'Cassava first weeding and herbicide', 550000, 0, 1),
  (7,  'Fertiliser', 'NPK for cassava', 450000, 0, 1),
  (11, 'Harvest labour', 'Cassava harvest crew', 550000, 0, 1),
  (13, 'Maize seed', 'Maize cycle 1 seed', 280000, 0, 1),
  (14, 'Fertiliser', 'Maize cycle 1 fertiliser', 800000, 0, 1),
  (14, 'Weeding & herbicide', 'Maize cycle 1 herbicide and pest control', 270000, 0, 1),
  (15, 'Casual wages', 'Maize cycle 1 field labour', 550000, 0, 2),
  (17, 'Shelling, drying & bagging', 'Maize cycle 1 shelling, drying, bagging', 450000, 0, 1),
  (18, 'Maize seed', 'Maize cycle 2 seed', 280000, 0, 1),
  (19, 'Fertiliser', 'Maize cycle 2 fertiliser', 800000, 0, 1),
  (19, 'Weeding & herbicide', 'Maize cycle 2 herbicide and pest control', 270000, 0, 1),
  (20, 'Casual wages', 'Maize cycle 2 field labour', 550000, 0, 2),
  (22, 'Shelling, drying & bagging', 'Maize cycle 2 shelling, drying, bagging', 450000, 0, 1),
  (1,  'Transport & fuel', 'Transport and fuel (management expense)', 240000, 0, 12),
  (1,  'Storage & handling', 'Storage and handling (management expense)', 150000, 0, 12),
  (1,  'Insurance', 'Crop and stock insurance (management expense)', 120000, 0, 12),
  (1,  'Admin & sundries', 'Admin and sundries (management expense)', 90000, 0, 12);

insert into revenue_templates(crop, stage_seq, days_after_end, amount_per_10_acres, description) values
  ('cassava', 12, -25, 5500000, 'Cassava sales (plan, target case; paid mid-way through deliveries)'),
  ('maize',   17, -15, 6840000, 'Maize cycle 1 sales (plan, target case)'),
  ('maize',   22, -15, 6840000, 'Maize cycle 2 sales (plan, target case)');

-- ---------------------------------------------------------------- compliance, tax, SOPs, stock
delete from tax_filings; delete from tax_items;
insert into tax_items(name, authority, due_day, notes) values
  ('PAYE remittance', 'State Internal Revenue Service', 10, 'Remit PAYE deducted from salaries. Confirm the current deadline and rates before relying on this date.'),
  ('Pension remittance', 'PFA / PenCom', 7, 'Employer and employee pension contributions. Confirm the current deadline.'),
  ('NSITF contribution', 'NSITF', 16, 'Employee compensation contribution. Confirm the current rate and deadline.'),
  ('Withholding tax remittance', 'FIRS / State IRS', 21, 'WHT on supplier payments where applicable. Confirm applicability.'),
  ('VAT return', 'FIRS', 21, 'Unprocessed agricultural produce is generally VAT-exempt. Confirm your status with a tax adviser.');

delete from compliance_checks;
insert into compliance_checks(area, item, frequency, owner_role) values
  ('safety', 'PPE issued and worn by all workers (gloves, boots, spray masks)', 'weekly', 'supervisor'),
  ('safety', 'First-aid kit stocked and within reach of the field crew', 'monthly', 'supervisor'),
  ('safety', 'Briefing held before any tractor or pump is used', 'weekly', 'supervisor'),
  ('agrochemical', 'Agrochemicals stored locked, labelled and away from food and water', 'monthly', 'supervisor'),
  ('agrochemical', 'Spray records kept: product, rate, date, re-entry period', 'weekly', 'supervisor'),
  ('environment', 'Empty chemical containers disposed of safely, not reused', 'monthly', 'supervisor'),
  ('environment', 'Ridges checked for erosion and run-off; no burning near streams or neighbours', 'monthly', 'ops_manager'),
  ('labour', 'Daily attendance register signed by every casual worker', 'weekly', 'supervisor'),
  ('labour', 'Wages paid on time and at or above the legal minimum', 'monthly', 'accountant');

delete from sops;
insert into sops(title, stage_seq, body, owner_role) values
  ('Land preparation', 2, E'1. Walk the site and mark boundaries and drainage lines.\n2. Clear vegetation; do not burn near streams, roads or neighbouring farms.\n3. Plough and harrow when the soil is moist, not waterlogged.\n4. Ridge or mound along the contour to limit erosion.\n5. Log hours, cost and photos in the field log.', 'supervisor'),
  ('Cassava planting', 4, E'1. Use certified, disease-free stems of 25 to 30 cm with 4 to 6 nodes.\n2. Dip stems in the approved treatment and plant within 3 days of cutting.\n3. Plant at the agreed spacing, slanted or horizontal on ridges.\n4. Record the planting date and area per block the same day.\n5. Count sprouting after 2 to 3 weeks and replace gaps.', 'supervisor'),
  ('Weeding and herbicide use', 6, E'1. Weed at 4 to 6 weeks and again before canopy closes.\n2. Wear PPE; mix chemicals as labelled; never spray in strong wind.\n3. Record product, rate, block, date and who sprayed.\n4. Observe the re-entry period before sending crews back.\n5. Rinse equipment away from water sources.', 'supervisor'),
  ('Fertiliser application', 7, E'1. Apply to moist soil, 10 cm from the plant, not on leaves.\n2. Use the agronomist rate per block.\n3. Weigh and record bags used per block.\n4. Keep the store tally in line with stock moves.', 'supervisor'),
  ('Scouting and disease reporting', 9, E'1. Walk each block weekly in a fixed pattern.\n2. Score disease and pest from 0 to 5; take a photo of any unusual symptom.\n3. Log the case in Disease cases; the AI check is advisory and the agronomist decides treatment.\n4. Close the case after treatment and recheck.', 'research'),
  ('Cassava harvest and handling', 11, E'1. Take sample digs from each block and confirm root size and dry matter.\n2. Harvest only what can be delivered within 24 to 48 hours; cassava spoils fast.\n3. Weigh every load and record tonnes per block.\n4. Raise the delivery note at the gate and hand over to Sales.', 'supervisor'),
  ('Maize harvest, drying and storage', 16, E'1. Harvest at maturity and check grain moisture.\n2. Dry to safe moisture (about 13 to 14 percent) before bagging.\n3. Store on pallets, away from walls, with pest control.\n4. Record bags and weight before sale or storage.', 'supervisor'),
  ('Cash handling and expense requests', null, E'1. Every spend starts as an expense request linked to a budget line and stage.\n2. Attach the receipt or quote.\n3. Small requests inside budget are approved automatically; others go to the approver.\n4. Only the accountant records payment. Nobody approves their own request unless they are an admin.', 'accountant');

insert into inventory_items(name, category, unit, reorder_level) values
  ('Cassava stems','planting material','bundle',0),
  ('NPK 15-15-15','fertiliser','50 kg bag',0),
  ('Urea','fertiliser','50 kg bag',0),
  ('Maize seed','seed','kg',0),
  ('Glyphosate herbicide','agrochemical','litre',0),
  ('Pre-emergence herbicide','agrochemical','litre',0),
  ('Diesel','fuel','litre',0)
on conflict (name) do nothing;

-- ---------------------------------------------------------------- phase targets (from the v10 plan, target case)
delete from phase_targets;
insert into phase_targets(phase, grp, label, target_amount, notes) values
  (1, 'field',      'Field costs, Phase 1 (10 acres)',                 7500000,   'Land prep, stems, labour, inputs, shelling for 1 cassava + 2 maize cycles'),
  (1, 'management', 'Management expenses, Phase 1',                     600000,   'Transport, storage, insurance, admin. No paid staff in Phase 1'),
  (1, 'total',      'Total expenses, Phase 1',                         8100000,   null),
  (2, 'field',      'Field costs, Phase 2 (100 acres)',               72000000,   null),
  (2, 'management', 'Management expenses, Phase 2',                   23860000,   'Overheads N10m + staff payroll N13.86m (4 specialists)'),
  (2, 'total',      'Total expenses, Phase 2',                        95860000,   null),
  (3, 'field',      'Field costs, Phase 3 (300 acres, per year)',    207000000,   null),
  (3, 'management', 'Management expenses, Phase 3 (per year)',        77652000,   'Overheads N30m + staff payroll N47.652m'),
  (3, 'total',      'Total expenses, Phase 3 (per year)',            284652000,   null),
  (4, 'field',      'Field + conversion costs, Phase 4 (year 5)',    288081000,   'Includes flour conversion cost'),
  (4, 'management', 'Management expenses, Phase 4 (year 5)',         129792000,   'Overheads N30m + farm payroll N47.652m + plant payroll N52.14m'),
  (4, 'total',      'Total expenses, Phase 4 (year 5)',              417873000,   null);

-- ---------------------------------------------------------------- responsibilities map
delete from responsibilities;
insert into responsibilities(role, seq, text, module, automation) values
 ('accountant',1,'Maintain accurate financial records and accounting documentation','journal','Every paid expense, invoice, payment and payroll run posts a balanced double-entry journal automatically; receipts are stored in the Documents vault.'),
 ('accountant',2,'Prepare operational budgets and expenditure forecasts','budgets','Budget lines are generated per stage when the season is created; the cash forecast updates itself.'),
 ('accountant',3,'Monitor farm production costs and departmental spending','budgets','Budget vs actual by stage, crop and category with alerts at 90% and 100%.'),
 ('accountant',4,'Track income, expenses, payments and outstanding receivables','invoices','Deliveries create invoices automatically; payments update status; overdue invoices are flagged and chased daily.'),
 ('accountant',5,'Prepare monthly financial statements and management reports','statements','Month-end job saves the P&L, balance sheet, cash flow and costing, and writes the monthly report (AI commentary optional).'),
 ('accountant',6,'Monitor cash flow and support financial planning','cashflow','Monthly forecast against the N2m working capital with a shortfall alert.'),
 ('accountant',7,'Maintain payroll records and support salary administration','payroll','Employees and attendance feed a monthly payroll draft; accountant reviews, admin approves, the system posts the journal.'),
 ('accountant',8,'Reconcile bank statements and financial transactions','bank','Upload a CSV; lines are auto-matched by amount, date and reference every day; exceptions are listed.'),
 ('accountant',9,'Track agricultural investment, equipment purchases and company assets','assets','Asset purchases create register entries; depreciation posts monthly.'),
 ('accountant',10,'Calculate production costs and profitability per acre','profitability','Live cost, revenue and profit per acre by crop.'),
 ('accountant',11,'Support tax documentation and statutory financial compliance','tax','A monthly filing calendar is generated for the whole season with reminders 7 days before each due date.'),
 ('accountant',12,'Establish financial controls and expenditure approval procedures','approvals','Amount-based approval routing, no self-approval, auto-approval under the limit and inside budget, locked paid entries.'),
 ('accountant',13,'Assist management with financial analysis and investment decisions','dashboard','Dashboard margin, cash runway and phase targets; AI commentary in the monthly report.'),
 ('accountant',14,'Maintain proper documentation for audits and financial reviews','audit','Every change to money records is written to the audit trail; documents are filed against records.'),

 ('ops_manager',1,'Develop and implement farm operational plans and production schedules','gantt','The season generator builds stages, tasks and budgets from your start date; the Gantt compares planned and actual.'),
 ('ops_manager',2,'Coordinate land preparation, planting, crop maintenance and harvesting activities','tasks','Tasks are assigned by role with due dates; reminders go out and late tasks escalate to you, then to the admin.'),
 ('ops_manager',3,'Supervise agronomists, farm supervisors, field workers and contractors','tasks','Overdue tasks, attendance and field logs roll up on the dashboard without chasing people.'),
 ('ops_manager',4,'Manage farm budgets, labour costs and operational expenditure','budgets','Budget vs actual by stage; approvals route by amount; budget alerts are automatic.'),
 ('ops_manager',5,'Monitor crop performance, productivity and resource utilization','dashboard','Progress, yield samples, observations and stock levels appear in one view.'),
 ('ops_manager',6,'Coordinate procurement of seeds, planting materials, fertilizers and farm equipment','procurement','Requests become purchase orders; approved orders create expense approvals; receipts update stock.'),
 ('ops_manager',7,'Establish relationships with agricultural suppliers, service providers and buyers','suppliers','Supplier directory with ratings; the buyer pipeline from Sales is visible to you.'),
 ('ops_manager',8,'Maintain accurate farm production and operational records','field-logs','Field logs, attendance and stock moves are captured as work happens.'),
 ('ops_manager',9,'Prepare weekly and monthly farm performance reports','reports','A weekly report is generated every Monday and a monthly report at month-end.'),
 ('ops_manager',10,'Identify operational risks and implement corrective measures','risks','Risk register with scores; rainfall rules and late stages raise alerts.'),
 ('ops_manager',11,'Ensure compliance with agricultural safety and environmental practices','compliance','Checklist statuses refresh daily and overdue checks alert the owner.'),
 ('ops_manager',12,'Develop standard operating procedures for farm activities','sops','SOP library linked to stages with version numbers.'),
 ('ops_manager',13,'Support the company expansion from 20 acres towards 100 acres','dashboard','Expansion readiness card: progress, cost per acre, buyer cover and cash position.'),

 ('supervisor',1,'Develop and implement farm operational plans and production schedules','my-day','Your tasks for today and this week come from the season schedule.'),
 ('supervisor',2,'Coordinate land preparation, planting, crop maintenance and harvesting activities','tasks','Tick progress on each task; the stage progress and Gantt update by themselves.'),
 ('supervisor',3,'Supervise agronomists, farm supervisors, field workers and contractors','attendance','Daily attendance for casual workers; totals feed expense requests.'),
 ('supervisor',4,'Manage farm budgets, labour costs and operational expenditure','expenses','Submit expense requests against budget lines; small requests inside budget are auto-approved.'),
 ('supervisor',5,'Monitor crop performance, productivity and resource utilization','field-logs','Daily field log with labour, hours and photos.'),
 ('supervisor',6,'Coordinate procurement of seeds, planting materials, fertilizers and farm equipment','procurement','Raise purchase requests; the manager approves.'),
 ('supervisor',7,'Establish relationships with agricultural suppliers, service providers and buyers','suppliers','Supplier directory and quotes in one place.'),
 ('supervisor',8,'Maintain accurate farm production and operational records','field-logs','Everything you enter is time-stamped and attributed.'),
 ('supervisor',9,'Prepare weekly and monthly farm performance reports','reports','The weekly report is generated automatically; you add notes.'),
 ('supervisor',10,'Identify operational risks and implement corrective measures','incidents','Log incidents and near misses; risks are escalated to the manager.'),
 ('supervisor',11,'Ensure compliance with agricultural safety and environmental practices','compliance','Weekly and monthly checklists with reminders.'),
 ('supervisor',12,'Develop standard operating procedures for farm activities','sops','Read and propose changes to SOPs for each stage.'),
 ('supervisor',13,'Support the company expansion from 20 acres towards 100 acres','gantt','See the schedule and capacity before each new block is added.'),

 ('sales',1,'Identify potential buyers of cassava and maize','buyers','Buyer database with type, status and contacts.'),
 ('sales',2,'Develop relationships with agricultural processors, wholesalers and distributors','buyers','Pipeline stages from lead to active buyer.'),
 ('sales',3,'Research agricultural market prices and demand trends','prices','Price log by crop and market; the weekly AI market note summarises trends.'),
 ('sales',4,'Identify opportunities with flour mills, starch producers and feed manufacturers','buyers','Filter buyers by type; AI market report suggests targets.'),
 ('sales',5,'Negotiate produce sales and supply agreements','agreements','Agreements with tonnage, price, delivery window and deposit.'),
 ('sales',6,'Develop and maintain a database of agricultural buyers','buyers','One shared buyer register.'),
 ('sales',7,'Secure prospective customers before harvest periods','agreements','Daily check warns when under 60% of expected cassava is contracted before harvest.'),
 ('sales',8,'Coordinate produce delivery arrangements with operations and logistics teams','deliveries','Schedule deliveries; marking delivered creates the invoice for the accountant.'),
 ('sales',9,'Monitor sales performance and revenue targets','dashboard','Contracted tonnes vs expected and revenue vs plan.'),
 ('sales',10,'Prepare market intelligence and commercial reports','reports','AI market report from your price log and pipeline.'),
 ('sales',11,'Identify new agricultural business opportunities','buyers','Track opportunities as leads with notes.'),
 ('sales',12,'Develop partnerships with cooperatives and agricultural organizations','buyers','Cooperatives are a buyer type with their own status.'),
 ('sales',13,'Maintain customer relationships and manage commercial negotiations','agreements','Status history and terms stored per agreement.'),
 ('sales',14,'Support the development of long-term agricultural distribution channels','orders','Orders and delivery history show repeat buyers.'),

 ('research',1,'Support agricultural field research and data collection','observations','Structured forms for observations, soil, yield samples and weather.'),
 ('research',2,'Assist in monitoring cassava and maize crop development','observations','Growth stage, height, canopy and scores per block with a trend chart.'),
 ('research',3,'Collect and organize soil, weather and crop performance data','soil','Soil samples per block; weather is pulled automatically every day.'),
 ('research',4,'Support digital documentation of farm activities','field-logs','Field logs and photos are stored with dates.'),
 ('research',5,'Research crop disease identification and management techniques','disease','Disease cases with photo; AI gives an advisory assessment.'),
 ('research',6,'Assist with agricultural productivity and yield analysis','yields','Yield samples convert to tonnes per acre by block.'),
 ('research',7,'Explore the application of AI and computer vision in crop monitoring','pilots','Pilot tracker for AI and computer vision experiments.'),
 ('research',8,'Support research into drone-based and satellite-based farm monitoring','pilots','Pilot tracker covers drone and satellite tests.'),
 ('research',9,'Assist in developing digital farm management solutions','pilots','Feature ideas and findings recorded against this system.'),
 ('research',10,'Conduct research on precision agriculture technologies','notes','Research notes with tags and file links.'),
 ('research',11,'Prepare research summaries and technical documentation','reports','AI research summary from your observations and notes.'),
 ('research',12,'Collaborate with software engineers and agricultural professionals','notes','Shared notes visible to the manager and admin.'),
 ('research',13,'Support pilot testing of agricultural technology solutions','pilots','Pilots move through idea, planning, running, review, done.'),
 ('research',14,'Maintain research datasets and project documentation','documents','Upload datasets and documents; each is attributed and dated.'),
 ('research',15,'Present findings and recommendations to the research team','reports','Reports you create are shared with the audience you choose.');

-- ---------------------------------------------------------------- Phase 1 season
insert into seasons(name, phase, acres, start_date, working_capital, status, notes)
select 'Phase 1: cassava then two maize cycles (10 acres)', 1, 10, date '2027-03-15', 2000000, 'planning',
       'Start date is a placeholder for the start of the rains. Change it in Admin > Schedule and regenerate before any work starts.'
where not exists (select 1 from seasons);

select internal_generate_season(s.id, s.start_date)
from (select id, start_date from seasons order by created_at limit 1) s
where not exists (select 1 from stages);

-- working capital (N2m) recorded as owner capital in the main bank account
insert into transactions(kind, status, description, amount, bank_account_id, txn_date, season_id, payee)
select 'capital', 'paid', 'Phase 1 working capital', 2000000, b.id, current_date, s.id, 'Owner'
from bank_accounts b, (select id from seasons order by created_at limit 1) s
where b.name = 'Main bank account' and not exists (select 1 from transactions where kind = 'capital');

-- starter risk register
insert into risks(season_id, title, category, likelihood, impact, mitigation, owner_role)
select s.id, v.title, v.cat, v.l, v.i, v.m, v.r::app_role
from (select id from seasons order by created_at limit 1) s,
(values
  ('Cassava price falls or buyers delay at harvest','market',4,4,'Sign supply agreements before harvest; sell in stages; keep reserves','sales'),
  ('Low yield from weak stems or late planting','production',3,5,'Certified stems, soil test, planting on schedule, agronomist visits','ops_manager'),
  ('Dry-season maize cycle fails without irrigation','production',4,4,'Plan pump and water source before cycle 2; test on a small block','ops_manager'),
  ('Cash runs short before the first harvest','finance',4,5,'Stage spending, watch the cash forecast weekly, arrange a bridge before month 5','accountant'),
  ('Pest or disease outbreak (cassava mosaic, fall armyworm)','production',3,4,'Weekly scouting, early photos, quick treatment decisions','research'),
  ('Theft or livestock damage','security',3,3,'Fencing, night watch, neighbour agreements','supervisor'),
  ('Labour shortage at planting or harvest','labour',3,4,'Book crews early; keep a contact list; pay on time','supervisor'),
  ('Land tenure dispute','legal',2,5,'Written lease for the full cycle; community and legal confirmation','admin')
) as v(title, cat, l, i, m, r)
where not exists (select 1 from risks);

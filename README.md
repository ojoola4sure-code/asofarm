# ASO FARM Management System (Phase 1)

A complete farm management system for the Phase 1 season: 10 acres of cassava (6 to 8 month harvest window) followed by two maize cycles. It covers every stage from land preparation to post-harvest, with an accounting dashboard that does the routine accounting automatically, and a workspace for each role.

- **Backend:** Supabase (Postgres, Auth, Storage, Row Level Security, pg_cron, Edge Functions)
- **Frontend:** static site on Netlify (plain JavaScript, no build tools beyond one config script)
- **AI:** OpenAI, called only from Supabase Edge Functions so your key never reaches the browser

## What you get

| Area | What it does |
|---|---|
| Dashboard | Season progress vs plan, tasks, cash vs the N2m working capital, budget vs spent, management expenses vs target, pre-harvest sales cover, rain, alerts, and the Gantt chart |
| Gantt | 23 stages from site survey to close-out, planned vs actual, cassava harvest window (6 to 8 months), click a stage to update its tasks |
| Operations | Tasks (about 75, auto-assigned by role), field logs with photos, attendance, procurement, inventory, suppliers, SOPs, risks, incidents, safety and compliance checks |
| Accounting | Expense requests and approvals, budgets vs actual, phase targets vs spent, invoices and receivables, bank reconciliation (CSV), payroll, assets and depreciation, journal, P&L, balance sheet, trial balance, cash flow, cash forecast, profit per acre, tax calendar, audit trail, document vault |
| Sales | Buyer database, price log with chart, supply agreements, orders, deliveries (delivery creates the invoice) |
| Research | Observations, soil, weather (auto), disease cases with an AI photo check, yield samples (tonnes per acre), technology pilots, notes |
| Platform | Role-based access, alerts, weekly and monthly reports (data and AI versions), responsibility map for every role, admin screens |

## Accounts (seeded)

| Email | Role |
|---|---|
| admin@asofarm.com | Admin / Owner (sees everything) |
| operations.manager@asofarm.com | Farm Operations Manager |
| supervisor@asofarm.com | Farm Supervisor |
| accountant@asofarm.com | Finance and Accounts (accounting dashboard) |
| sales@asofarm.com | Agribusiness Sales and Partnerships Officer |
| research@asofarm.com | AgricTech Research and Innovation Intern |

The starter password is set by `scripts/seed-users.mjs` (default `labalaba@2019`, or `SEED_PASSWORD`). **Everyone must choose their own password at first sign-in; the app enforces this.** Do not keep a shared password in use, and do not commit this repository to a public place with the password in it. Change the default in your own environment variable before sharing the repo.

## Deploy (about 30 minutes)

1. **Create a Supabase project.** Authentication > Providers > Email: turn **off** "Allow new users to sign up". (Roles are only ever set by the admin API, but there is no reason to leave sign-up open.)
2. **Enable extensions:** Database > Extensions > enable `pg_cron` and `pg_net`.
3. **Run the SQL** in the SQL Editor, in order: `001_schema.sql`, `002_functions.sql`, `003_rls.sql`, `004_seed.sql`, `005_views.sql`, `006_cron.sql`, `007_public.sql`. Read any error before moving on; do not skip a file.
4. **Create the users** on your computer:
   ```bash
   npm install
   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service role key> npm run seed
   ```
   The service role key is a master key. Use it only here, never in Netlify or in the browser.
5. **Deploy the edge functions** (needs the Supabase CLI):
   ```bash
   supabase login
   supabase link --project-ref <ref>
   supabase secrets set OPENAI_API_KEY=<your OpenAI key>
   supabase functions deploy ai-report ai-vision weather-sync
   ```
6. **Deploy the site on Netlify:** connect the repository. Set environment variables `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the anon key is meant to be public). Build command and publish folder are already in `netlify.toml`.
7. **Sign in as admin@asofarm.com**, choose a new password, then:
   - **Settings:** set `function_base_url` to `https://<ref>.supabase.co/functions/v1`, press **Generate** on `cron_secret`, and set `farm_lat` and `farm_lon` to the exact Okaka coordinates.
   - **Schedule:** set the real start date and regenerate before any work starts. The seed uses 15 March 2027 as a placeholder for the start of the rains.
   - **Automation:** press "Run daily checks now" once and confirm it shows `ok`.
8. Sign in as each role and run the checklist below.

## How the accounting is automated

- **Books:** paying an approved expense, issuing an invoice, receiving a payment, running payroll and monthly depreciation all post balanced double-entry journals by themselves. Paid entries are locked; corrections are reversing entries.
- **Approvals:** a request inside its budget line and at or under the auto-approve limit (₦20,000 by default) is approved automatically. Up to ₦250,000 goes to the Farm Operations Manager; above that, or over budget, to the admin. Nobody approves their own request except an admin. Only the accountant records payment.
- **Receivables:** marking a delivery delivered issues the invoice; overdue invoices are flagged and chased daily.
- **Bank:** upload a CSV; lines match to payments, receipts and payroll by amount, date and reference, and matching reruns every morning.
- **Month-end (1st, 02:00 Lagos):** depreciation, payroll draft, statements snapshot, tax calendar, monthly report.
- **Cash:** forecast from budget lines and the revenue plan against the ₦2m working capital, with a shortfall alert. With the seeded plan the forecast dips about ₦1.2m below working capital around October 2027, before the first cassava sales, so plan to stage planting, delay non-urgent purchases or arrange a bridge.
- **Targets:** field costs and management expenses are tracked against each phase's target; only Phase 1 is active.

## Test checklist (do this on a staging Supabase project first)

1. As **supervisor**: log a field activity with a photo; mark attendance; raise an expense of ₦15,000 against "Weeding & herbicide". It should auto-approve.
2. As **accountant**: pay it from the main bank account; open Journal and confirm a balanced entry; check Budgets vs actual moved.
3. As **supervisor**: raise ₦300,000 against a budget line. It should go to the **admin** (over ₦250,000). Raise ₦100,000: it should go to the **manager**.
4. As **operations manager**: approve the ₦100,000 request. Try to approve your own: it must be refused.
5. As **sales**: add a buyer, sign an agreement, create the order, schedule and mark a delivery delivered. As **accountant**, confirm the invoice, record a payment, and see receivables update.
6. As **accountant**: import a small CSV bank statement and run auto-match; open P&L, balance sheet (assets minus liabilities and equity should be zero) and trial balance.
7. As **research**: add an observation and a disease case with a photo, press **AI check**; press **Sync now** on Weather.
8. As **admin**: Automation > run daily checks; open Audit trail (via the accountant) and confirm the changes are listed.
9. Confirm a role cannot open another role's pages or read its data (for example, the supervisor cannot see Journal or Payroll).

## Public investor and support page (`/invest`)

A page anyone can open without signing in, showing the plan, the live season progress and how each stage is done, with two calls to action: **Call for investment** and **Call for support** (plus tap-to-call and WhatsApp). Enquiries land in **Sales > Enquiries** and alert the admin and the sales role.

1. Run `007_public.sql` (after 001 to 006).
2. Sign in as admin (or sales) and open **Sales > Public page**. Edit the draft sections, publish the ones you are happy with, and add farm updates with photos.
3. In **Settings**, check `public_phone`, `public_whatsapp`, `public_email` and `public_address`.
4. When ready, switch on **Page is open to the public**. Share `https://your-site.netlify.app/invest`.

What visitors can see: stage names, dates and progress, planned budget totals, the sections and updates you publish. They never see payments, salaries, bank details, supplier or buyer names, or internal notes. Spending to date and the step-by-step methods are optional switches.

The draft text is a starting point written from the plan; all sections ship **unpublished**. Check every figure before publishing. Soliciting investment from the public can be regulated; take legal advice and avoid promising returns. Enquiry spam is limited by a hidden field, a per-email limit and an hourly cap; add Cloudflare Turnstile or hCaptcha if it becomes a problem.

## Known limits (read before relying on it)

- **Not run against a live database in the build environment.** The SQL and the web code were reviewed and the JavaScript was syntax-checked and load-tested, but the SQL has not been executed on a Postgres instance. Expect to fix small errors when you run the migrations; run them on a staging project first.
- **PAYE is not calculated.** Enter it per the current tax rules. The pension rates (8% and 10%) are settings to confirm with PenCom rules.
- **Statutory due dates** (PAYE, pension, NSITF, withholding tax, VAT) in the tax calendar are placeholders to confirm with a tax adviser. Unprocessed agricultural produce is generally VAT-exempt; confirm your status.
- **Casual labour:** by default it is paid through expense requests against budget lines (attendance is the record). Turning on `payroll_includes_casual` puts attendance wages into payroll; do not do both for the same work or the cost is counted twice.
- **Phase 1 has no paid farm staff** (you act as manager and supervisor), so payroll drafts are empty until you add salaried staff.
- **AI output is advisory.** Reports use only your data; the disease check cannot confirm a diagnosis.
- The Farm Operations Manager and Farm Supervisor responsibility lists you supplied are identical; both are seeded as given, mapped to the pages each role uses.
- "20 acres to 100 acres": acreage is a setting. Change it in Admin > Schedule and regenerate; budgets scale per 10 acres.

## Project layout

```
supabase/migrations/   001 schema, 002 functions and triggers, 003 security, 004 seed, 005 views, 006 schedules
supabase/functions/    ai-report, ai-vision, weather-sync (Deno)
public/                the site (index.html, css, js/pages/*)
scripts/               write-config.js (Netlify build), seed-users.mjs
netlify.toml           build, redirects, security headers
```

-- 006: scheduled automation. pg_cron and pg_net must be enabled (Database > Extensions) on Supabase.
-- Times are UTC. Nigeria is UTC+1, so 05:00 UTC runs at 06:00 in Lagos.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function call_edge(p_fn text, p_body jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  select value #>> '{}' into v_url from app_settings where key = 'function_base_url';
  select value #>> '{}' into v_secret from app_settings where key = 'cron_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then return; end if;
  perform net.http_post(url := v_url || '/' || p_fn,
                        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
                        body := p_body);
end $$;
revoke execute on function call_edge(text, jsonb) from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname like 'asofarm_%';

select cron.schedule('asofarm_daily',        '0 5 * * *',  $$select public.job_daily()$$);
select cron.schedule('asofarm_weather',      '30 5 * * *', $$select public.call_edge('weather-sync')$$);
select cron.schedule('asofarm_weekly',       '0 6 * * 1',  $$select public.job_weekly()$$);
select cron.schedule('asofarm_ai_weekly',    '30 6 * * 1', $$select public.call_edge('ai-report', '{"type":"weekly"}'::jsonb)$$);
select cron.schedule('asofarm_ai_market',    '45 6 * * 1', $$select public.call_edge('ai-report', '{"type":"market"}'::jsonb)$$);
select cron.schedule('asofarm_month_end',    '0 1 1 * *',  $$select public.job_month_end()$$);
select cron.schedule('asofarm_ai_monthly',   '0 2 1 * *',  $$select public.call_edge('ai-report', '{"type":"monthly"}'::jsonb)$$);

-- Xclr reminders: run every 15 minutes from Supabase (pg_cron + pg_net).
-- Vercel Hobby crons only run once a day, so Supabase calls the endpoint.
--
-- 1. Run supabase/migrations/008_health_notify.sql first.
-- 2. Replace <CRON_SECRET> below with the SAME value as CRON_SECRET in Vercel.
--    Paste the edited copy into the Supabase SQL editor; never commit the real
--    secret to this file.
-- 3. Run it once. Check runs later with:
--      select * from cron.job_run_details order by start_time desc limit 10;
--      select * from net._http_response order by created desc limit 10;

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'xclr-notify',
  '*/15 * * * *',
  $$ select net.http_post(
       url := 'https://xclr.vercel.app/api/cron/notify',
       headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
       timeout_milliseconds := 30000
     ) $$
);

-- To change the secret later: unschedule, then run the schedule again.
-- select cron.unschedule('xclr-notify');

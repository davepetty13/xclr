-- Xclr reminder schedule (Supabase pg_cron + pg_net), every 15 minutes.
-- Vercel Hobby crons only run daily, so Supabase calls the endpoint instead.
-- The secret lives in Supabase Vault (never in this file or in cron.job):
--   select vault.create_secret('<same value as Vercel CRON_SECRET>', 'xclr_cron_secret');
-- If CRON_SECRET is changed in Vercel, update the vault secret to match:
--   select vault.update_secret((select id from vault.secrets where name = 'xclr_cron_secret'), '<new value>');

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule('xclr-notify', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://xclr.vercel.app/api/cron/notify',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'xclr_cron_secret')),
    timeout_milliseconds := 30000)
$$);

-- To stop it:  select cron.unschedule('xclr-notify');

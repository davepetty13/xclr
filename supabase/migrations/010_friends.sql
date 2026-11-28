-- Xclr — Migration 010: friends on Xclr, invite-only (v3.11).
--   app_members — the invite list. Only an email on this list can use Xclr.
--                 Owner = Dave. Each member has a monthly AI limit (USD).
--   profiles.privacy_accepted_at — the one-time privacy welcome.
-- Writes to app_members happen ONLY through the service-role client inside
-- owner-checked server actions (app/(app)/profile/people/actions.ts) and the
-- sign-in callback. Signed-in users may read their own row, nothing else.
-- Also (security review): ai_usage becomes server-written only, is_member()
-- RLS defence-in-depth on the write-heavy tables + photo uploads.
-- Safe to re-run.

create table if not exists app_members (
  email text primary key check (email = lower(email)),
  user_id uuid null references auth.users(id) on delete set null,
  role text not null default 'member' check (role in ('owner', 'member')),
  status text not null default 'invited' check (status in ('invited', 'active', 'paused')),
  ai_limit_usd numeric(6,2) not null default 1.50 check (ai_limit_usd between 0 and 100),
  invited_at timestamptz default now(),
  joined_at timestamptz
);

alter table app_members enable row level security;

drop policy if exists "own app_members read" on app_members;
create policy "own app_members read" on app_members for select
  to authenticated
  using (lower(auth.jwt() ->> 'email') = email or user_id = auth.uid());
-- No insert / update / delete policy for authenticated: RLS denies them.

create index if not exists app_members_user_id on app_members (user_id);

-- Seed (owner + the two grandfathered members): seed applied directly in Supabase.

-- Privacy welcome: shown once, before onboarding, while this is null.
alter table profiles add column if not exists privacy_accepted_at timestamptz;

-- Existing users' privacy_accepted_at: seed applied directly in Supabase.

-- ============================================================
-- ai_usage: written ONLY by the server (service-role client, lib/ai-call.ts).
-- A signed-in user could otherwise insert rows (e.g. a negative cost_usd) and
-- push their month's spend under the AI limit.
-- ============================================================
drop policy if exists "own ai_usage insert" on ai_usage;
revoke insert, update, delete on ai_usage from authenticated, anon;

update ai_usage set cost_usd = 0 where cost_usd < 0;
alter table ai_usage drop constraint if exists ai_usage_cost_nonneg;
alter table ai_usage add constraint ai_usage_cost_nonneg check (cost_usd >= 0);

-- created_at is always the insert time (no back- or future-dating a row out
-- of the current month's window).
create or replace function public.ai_usage_force_created_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists ai_usage_force_created_at on ai_usage;
create trigger ai_usage_force_created_at
  before insert on ai_usage
  for each row execute function public.ai_usage_force_created_at();

-- ============================================================
-- is_member(): RLS defence-in-depth behind the middleware gate. True when the
-- caller has an app_members row (by user_id) that is active, or is the owner.
-- security definer so it can read app_members regardless of the caller's RLS.
-- The service role bypasses RLS, so server-side paths (crons, health sync,
-- recordUsage, deletes) are unaffected.
-- ============================================================
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.app_members m
    where m.user_id = auth.uid()
      and (m.status = 'active' or m.role = 'owner')
  );
$$;

revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

-- Photo uploads (005_v3.sql "xclr photos own insert" + is_member()).
drop policy if exists "xclr photos own insert" on storage.objects;
create policy "xclr photos own insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'xclr-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_member()
  );

-- Write-heavy tables: the old "for all" own-rows policy is split into
-- select / update / delete on own rows (unchanged) + insert on own rows that
-- also requires is_member().

-- food_logs (001_init.sql "own food")
drop policy if exists "own food" on food_logs;
drop policy if exists "own food read" on food_logs;
drop policy if exists "own food update" on food_logs;
drop policy if exists "own food delete" on food_logs;
drop policy if exists "own food insert" on food_logs;
create policy "own food read" on food_logs for select
  using (user_id = auth.uid());
create policy "own food update" on food_logs for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own food delete" on food_logs for delete
  using (user_id = auth.uid());
create policy "own food insert" on food_logs for insert
  with check (user_id = auth.uid() and public.is_member());

-- workout_sessions (002_training.sql "own sessions")
drop policy if exists "own sessions" on workout_sessions;
drop policy if exists "own sessions read" on workout_sessions;
drop policy if exists "own sessions update" on workout_sessions;
drop policy if exists "own sessions delete" on workout_sessions;
drop policy if exists "own sessions insert" on workout_sessions;
create policy "own sessions read" on workout_sessions for select
  using (user_id = auth.uid());
create policy "own sessions update" on workout_sessions for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own sessions delete" on workout_sessions for delete
  using (user_id = auth.uid());
create policy "own sessions insert" on workout_sessions for insert
  with check (user_id = auth.uid() and public.is_member());

-- weights (001_init.sql "own weights")
drop policy if exists "own weights" on weights;
drop policy if exists "own weights read" on weights;
drop policy if exists "own weights update" on weights;
drop policy if exists "own weights delete" on weights;
drop policy if exists "own weights insert" on weights;
create policy "own weights read" on weights for select
  using (user_id = auth.uid());
create policy "own weights update" on weights for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own weights delete" on weights for delete
  using (user_id = auth.uid());
create policy "own weights insert" on weights for insert
  with check (user_id = auth.uid() and public.is_member());

-- messages (003_chat.sql "own messages")
drop policy if exists "own messages" on messages;
drop policy if exists "own messages read" on messages;
drop policy if exists "own messages update" on messages;
drop policy if exists "own messages delete" on messages;
drop policy if exists "own messages insert" on messages;
create policy "own messages read" on messages for select
  using (user_id = auth.uid());
create policy "own messages update" on messages for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own messages delete" on messages for delete
  using (user_id = auth.uid());
create policy "own messages insert" on messages for insert
  with check (user_id = auth.uid() and public.is_member());

-- Xclr — Migration 010: friends on Xclr, invite-only (v3.11).
--   app_members — the invite list. Only an email on this list can use Xclr.
--                 Owner = Dave. Each member has a monthly AI limit (USD).
--   profiles.privacy_accepted_at — the one-time privacy welcome.
-- Writes to app_members happen ONLY through the service-role client inside
-- owner-checked server actions (app/(app)/profile/people/actions.ts) and the
-- sign-in callback. Signed-in users may read their own row, nothing else.
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

-- Seed: the owner, plus the existing users (grandfathered as active members).
insert into app_members (email, user_id, role, status, joined_at)
values
  ('pettypetty1113@gmail.com', 'b560932b-3eb2-4679-923b-af8c71c87b94', 'owner', 'active', now()),
  ('michikosalonofficial@gmail.com', 'f448e135-9c3a-41c5-aea8-001ab873dd57', 'member', 'active', now()),
  ('galecio.jays@gmail.com', '46f88b11-02ba-487a-a94b-aa9ba1b99798', 'member', 'active', now())
on conflict (email) do nothing;

-- Privacy welcome: shown once, before onboarding, while this is null.
alter table profiles add column if not exists privacy_accepted_at timestamptz;

-- The three existing users already use Xclr — no welcome for them.
update profiles
set privacy_accepted_at = now()
where privacy_accepted_at is null
  and id in (
    'b560932b-3eb2-4679-923b-af8c71c87b94',
    'f448e135-9c3a-41c5-aea8-001ab873dd57',
    '46f88b11-02ba-487a-a94b-aa9ba1b99798'
  );

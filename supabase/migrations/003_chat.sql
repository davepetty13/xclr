-- Xclr — Migration 003 (003_chat.sql)
-- Chat message history + a training-style preference note on profiles.
--
-- RENUMBER NOTE: this migration takes the 003 slot. The Master Spec §9 Apple
-- Watch metrics migration (daily_metrics) that the spec penciled in as 003 is
-- therefore renumbered to 004 — build it as 004_metrics.sql when Phase 3 lands.
--
-- RLS enabled + policy + index in this same file.

-- ============================================================
-- messages (persistent chat history: user + coach turns)
-- ============================================================
create table messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,                 -- user|coach
  content text not null,
  created_at timestamptz default now()
);
alter table messages enable row level security;
create policy "own messages" on messages for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create index messages_user_time on messages (user_id, created_at desc);

-- ============================================================
-- profiles.training_notes — free-text training-style preference,
-- fed into program generation (nullable, no default).
-- ============================================================
alter table profiles add column training_notes text;

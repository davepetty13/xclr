-- Xclr — Migration 009: Watch & activity reminders (low steps, short sleep,
-- Watch hasn't synced). New columns on notification_prefs only; covered by
-- the existing "own notification_prefs" policy. Safe to re-run.
alter table notification_prefs add column if not exists steps_on boolean not null default true;
alter table notification_prefs add column if not exists steps_time time not null default '18:30';
alter table notification_prefs add column if not exists sleep_on boolean not null default true;
alter table notification_prefs add column if not exists sync_check_on boolean not null default true;
alter table notification_prefs add column if not exists sync_check_time time not null default '22:00';

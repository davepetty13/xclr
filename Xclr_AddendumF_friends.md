# Xclr Addendum F — Friends on Xclr (v3.11)

Xclr opens to a small group of friends. It stays invite-only and personal; Dave is the owner.

## 1. Invite-only
- New table `app_members` (migration `010_friends.sql`): `email` (lower-case, primary key), `user_id`, `role` owner|member, `status` invited|active|paused, `ai_limit_usd` (default 1.50), `invited_at`, `joined_at`.
- RLS on. A signed-in user can read only their own row. There are no app writes: every write goes through the service-role client, inside owner-checked server actions or the sign-in callback.
- Seeded: Dave as owner, plus the two existing users as active members (grandfathered).
- **Sign-in callback** (`app/auth/callback/route.ts`): if the email has no row, or the row is paused, the user is signed out and sent to `/not-invited`. A stranger with no profile row has their auth user deleted on the spot, so nothing about them is saved. An `invited` row turns `active` on first sign-in, and the callback links its `user_id` and sets `joined_at`.
- **Every request** (`middleware.ts`): one small RLS read of the user's own `app_members` row. Anyone who isn't the owner or an active member is redirected to `/not-invited`, or gets a 403 on non-GET requests such as server actions. Pausing or removing someone takes effect on their next request. On a database error the check fails open, so Dave isn't locked out by a blip. The AI guard below still fails closed.
- The Watch sync endpoint also refuses paused people.
- `/not-invited`: shows the email, with a "Try a different Google account" button. The button signs out and reopens Google with `prompt=select_account`.

## 2. People page (owner only)
- `/profile/people`, linked from Profile for the owner only. Everyone else gets a 404.
- Top band: number of people (out of 50), AI spend this month, and the limit for new invites ($1.50).
- Invite by email. The email is checked and lower-cased, and the list holds at most 50 people. Nothing is emailed; Dave sends people the link himself.
- Each row shows name (or the part of the email before the @), email, status mark, and AI spend this month.
- The ⋯ sheet has:
  - a limit dropdown ($0.50, $1, $1.50, $2, $3, $5)
  - Pause / Resume
  - Remove, with a typed "REMOVE" confirm. Remove deletes their photos folder, then their auth user (all their data cascades), then their row.
- The owner can't be limited, paused or removed.
- The default limit for new invites is fixed at $1.50 in code (`DEFAULT_AI_LIMIT_USD`). It can't be edited on the page.

## 3. Monthly AI limit — $1.50 per member
- Spend = sum of `ai_usage.cost_usd` since the 1st of the month in the user's own time zone (`lib/ai-limit.ts`).
- One guard sits in `lib/ai-call.ts` `createMessage`. Every call that passes `track` is checked: chat parse and coach, photo reads, program builds and weekly reviews.
- Over the limit, the API is **not called**. The call returns a typed failure (`kind: "limit"`; `generateJson` sets `limited: true`) instead of throwing, so no caller can crash on it. Every caller already shows `error`.
- The owner has no limit. A person with no member row gets no AI at all (the guard fails closed).
- Logging that doesn't use AI keeps working: saved meals, quick-log chips and Watch sync.
- Message: "This month's coach limit is used up. You can still log food, workouts and Watch data — saved meals and quick logs don't use the coach. Questions and photo reads come back on <1st of next month>, or ask Dave to raise your limit."
- Coach page: from 80% of the limit a small note appears. When the limit is used up, the amber card and a "Coach use this month" bar show.
- The mock note said $2. The build uses **$1.50** as decided.

## 4. Privacy welcome
- `/welcome` is shown once after sign-in, before onboarding, while `profiles.privacy_accepted_at` is null. The `(app)` layout, onboarding and program pages all check it.
- Where acceptance is stored: the sign-in callback already creates a bare `profiles` row on first sign-in. So acceptance is saved on `profiles.privacy_accepted_at`, with an upsert on the user's own row. There is no extra column on `app_members`.
- The page says, in plain words, what is kept, that Dave can see the database, that the AI coach is Claude and isn't trained on your data, that photos are deleted after 48 h, how to leave, and that Xclr is not a medical service.
- "Not now — sign out" signs out.
- The migration sets acceptance for the three existing users.

## 5. Delete my data
- Profile → Your data → "Delete my data" (hidden for the owner), with an in-app typed "DELETE" confirm.
- It deletes the `xclr-photos/<user id>/` storage folder, then the auth user (every table cascades), then their `app_members` row, then signs out.
- "Download my data" (the export) is unchanged.

## 6. Watch sync for friends
- The ready-made shortcut link is the default: `https://www.icloud.com/shortcuts/b308b8caeac64ec7bca080522d224f6d`. `NEXT_PUBLIC_XCLR_SHORTCUT_URL` overrides it.
- A four-step quick setup sits at the top, with two buttons:
  - **Copy my key**: makes a new key first when there's no fresh one on screen. Replacing an existing key asks first, in the app.
  - **Add the shortcut**
- **Garmin** goes through Apple Health. Once: Garmin Connect → More → Settings → Connected Apps → Apple Health, and turn everything on. The Xclr shortcut then picks it up. Menu names can differ slightly by app version.
- There is a box for the 3 automations: App opened, Wake Up, 9:30 PM. "Using Android?" and the by-hand steps stay collapsed.

## Not in scope
- No automatic invite emails.
- No editable default limit on the People page.
- No per-member model choice.

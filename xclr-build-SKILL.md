---
name: xclr-build
description: Build protocol and project context for Xclr — Dave Petty's personal AI-coached health & wellness app (food/weight/sleep logging via chat, AI-authored training programs with weekly human approval, progression dashboards). Use for any Xclr task: build sessions, migrations, UI, coach/prompt work, design decisions. Encodes the stack, workflow gates, schema sources of truth, and guardrails so nothing needs re-explaining each session.
---

# Xclr Build Skill

You are building Xclr — Dave Petty's personal health & wellness app (himself + ~5 friends via TestFlight later; not commercial yet). Dave is non-technical; he states outcomes in plain language and relies on you for safe, correct implementation. The AI coach is the product's core: chat-in → structured rows → dashboards-out, with an AI-authored training program the user approves weekly.

## 🚨 THE TWO RULES THAT MATTER MOST (read first, every time)

**1. INVESTIGATE BEFORE ASKING OR BUILDING.** Dave states a goal → you investigate the real code/specs → you return ONE short, plain-language readout with a recommendation. No technical hypotheticals for Dave to referee, no walls of caveats. Only bring Dave a decision when a genuine product choice exists; if one path is clearly right, say so and do it.

**2. AI PROPOSES, DAVE APPROVES — in the product AND the process.** Nothing consequential happens silently:
- Program/plan changes in-app only via approved weekly proposals (never auto-apply).
- Migrations are pasted by Dave into the Supabase SQL Editor — print SQL IN FULL AND VERBATIM or not at all.
- Build gates: Document → Mockup → Approve → Build. Plan Mode before non-trivial work. <95% confident = ask first. Mid-build discrepancy = STOP and flag.
- Commit locally after Dave's real browser verification; NEVER push until Dave says "push".
- "Done" = Dave's real browser test. tsc=0 / builds-clean NEVER counts as done.

## Source-of-truth documents (repo root — read before building anything)

- `Xclr_Master_Spec.md` — product, schema (§7–9), parse contract (§10), AI behavior (§11), tabs (§12), tokens (§13), phases (§14)
- `Xclr_Doc02_Coach_and_Program.md` — coach persona/system prompt, program generation (incl. availability inputs), weekly-review logic
- `Xclr_AddendumA_Subagents.md` — reviewer agents: spec-auditor, security-auditor, ui-auditor; ALL THREE must PASS before any session commit (blocking)
- `xclr-mock-v2.html` — approved structure reference (aesthetic may be replaced by pending redesign)
- Docs are augmented, not rewritten. Trackers append-only, newest at bottom.

## Stack & environment (do not deviate)

- Next.js 14 App Router + TS + Tailwind (v3) mapped to CSS-variable tokens; Supabase; Vercel later; Google OAuth ONLY.
- Working dir `~/projects/xclr` — SEPARATE from MERS (`~/projects/mers`). Never mix the two repos, Supabase projects, or sessions.
- Dev server **localhost:3002 — ALWAYS** (3000 is MERS's, 3001 is banned).
- Supabase: the Xclr project only (URL in `.env.local`). Keys: sb_publishable_* (browser), sb_secret_* (server-only, NEVER client-side). Anthropic key: the `xclr` key, not MERS's.
- Migrations: sequential numbered files in `supabase/migrations/`; RLS + policies + indexes in the SAME file; applied by Dave pasting into the SQL Editor.

## Data & product guardrails (non-negotiable)

- RLS on EVERY table from creation; policy shape `user_id = auth.uid()` (profiles: `id = auth.uid()`).
- Store metric ONLY (kg / kcal); lbs is display-time conversion via profiles.weight_unit. Never store lbs.
- Load values are value + type (total_kg | per_side_kg | assist_kg | bodyweight | time_min) — never flattened. Assist decreasing = progress (charts render it as a win).
- Anti-fabrication: vague input → needs_clarification, write NOTHING. Never invent numbers, history, or nutrition data.
- Medical data consent-gated on profiles.health_data_consent_at; never sent to the AI without consent; coach accounts for conditions but NEVER diagnoses/prescribes — refer to professionals.
- BMI computed, never stored; shown once at signup as context with the muscle caveat — never a verdict, never sole planning input.
- Nutrition coaching recommends, never enforces or scolds. No shame states in UI or copy.
- Strava is RULED OUT (API terms prohibit AI use). Activity source is Apple Watch/HealthKit via Capacitor (Phase 3).
- Personal food_library is the accuracy engine: check it before estimating; confirmed edits upsert to it.

## Design system

- Tokens are CSS custom properties in `app/globals.css` — the ONLY place hex may appear. Tailwind theme references `var(--…)`. Components never touch raw hex (ui-auditor blocks it).
- Current palette: paper #F6F3EC · ink #16211B · green #1E7A4D (intake/progress) · ember #E0603A (burn/activity) · amber (carbs) · violet (fat/sleep). Fonts: Fraunces (display numbers) + Hanken Grotesk (UI). Tabular numerals for metrics.
- A redesign is being commissioned (see `Xclr_UI_Design_Brief.md`). When Dave approves a new direction, tokens change in globals.css ONLY; structure per the mock stays unless the brief's fixed sections say otherwise.

## Build state & session plan (update this section as sessions complete)

End-to-end scope = Sessions A–E per `Xclr_Kickoff_EndToEnd.md`:
- **A — Foundation** (scaffold, migration 001 + availability columns, OAuth, tokens): BUILT; checkpoint = Dave logs in on :3002. Port fixed to 3002.
- **B — Onboarding** (profile flow incl. availability, consent-gated medical, BMI-once): next after A commits. Install the three reviewer agents (`.claude/agents/`) + restart BEFORE B starts.
- **C — Program generation** (Doc 02 §3 contract, migration 002, preview→approve): pending.
- **D — Food/chat spine** (parse contract, food_library, Today dashboard, Food tab): pending.
- **E — Workout logging + weekly review loop**: pending.
- Phase 3 (HealthKit/TestFlight) and Phase 4 (Trends, Resend, unit-toggle UI) come after E.

## Communication (Dave's rules)

- Direct, concise, casual. Decide first, then answer. No thinking out loud.
- **Caveats/corrections BEFORE instructions, always** — Dave acts top-down as he reads.
- **Name WHERE every command runs:** "in Terminal," "in Claude Code," "in the Supabase SQL Editor," "in your browser."
- Code blocks = for Claude Code. Plain prose = for Dave. Keep distinct.
- Separate "what the spec says" from "what I'm proposing."
- Risky/uncertain = say so plainly, in one line.
- Docs Dave re-reads = .md, never .docx.

# Xclr — UI Design Brief

*Purpose: complete brief for designing the Xclr mobile app UI. Everything under "Product & Screens" is fixed (functionality, content, structure). Everything under "Creative Direction" is open — that's what we're asking you to design. Target: iPhone-first (~390pt width), built as a web app later wrapped in an iOS shell.*

---

## 1. What Xclr is

Xclr is a personal health & wellness app with an **AI coach at its core**. One app that replaces three tools: a chat bot for logging food/weight in natural language, a spreadsheet for workouts, and nothing for dashboards. The user talks to the coach ("today, weight 71.75, brunch: mcdo chicken 1 leg, 1/2 rice, protein bar"), the AI parses and stores it, and dashboards visualize everything.

**The relationship is the product.** The coach (persona: warm, lightly sassy, motivational — "Dave… 😏 remember panicking at 73.33 kg?") builds the user's training program, nudges on nutrition without policing, and proposes weekly training changes the user must approve. The UI should feel like a *coach who knows you*, not a medical chart.

**Audience:** the owner + ~5 friends. Adults, train seriously (gym machines, Push/Pull/Legs splits, multi-sport: lifting + running/cycling/swimming). Filipino food culture is first-class (adobo, sinigang — not just salads and oatmeal).

**Product principles that must survive the redesign:**
- Trends over single readings (weight is a line, not a number to panic about)
- AI proposes, human approves (nothing changes without a tap)
- Recommend, never scold (no red shame states for going over calories)
- Protein-forward (protein is the co-star metric next to calories)

## 2. App structure — 5 tabs (bottom nav)

### Tab 1 — Today (home)
The daily answer at a glance. Elements, in priority order:
1. Greeting + context line ("Week 3 · Day 4" of program)
2. **Hero: Calories LEFT today** (big number; the framing is "left," never "consumed"). Sub-line: eaten · burned. Goal chip. Progress gauge.
3. **Protein bar** — current/target grams, prominent (co-star, not buried with other macros)
4. This-week strip: workouts done vs planned (e.g. 3/4), avg sleep, kcal burned
5. Weight trend: current weight + sparkline of recent readings + delta from peak + a calming caption ("the line matters, not single readings")
6. Today's meals list (grouped by meal, each item: name, macros, kcal)

### Tab 2 — Food
1. Search bar (foods / barcode later)
2. Meal selector: Breakfast · Lunch · Dinner · Snack (+Brunch appears when used)
3. **Quick-add grid from the user's personal food library** (their real dishes with THEIR confirmed numbers — e.g. "Chicken adobo 1 cup · 295 kcal · P26")
4. Logged-today list, grouped by meal; every item tap-to-edit (estimates are correctable — show an "estimate" affordance until user confirms)

### Tab 3 — Workout (4 sub-views, segmented)
- **Today:** the prescribed day (e.g. "Day 4 · Push · Week 3"): exercise list with sets × rep-range @ load, target RPE, and the coach's note per exercise ("Stay at 30kg. Protect wrist."). Load formats matter and must display distinctly: total kg, **kg/side**, **kg assist**, bodyweight, time (20–30 min). Logging actuals per set: load, reps, RPE, plus a personal note field ("I am sick today").
- **Progress:** per-exercise progression chart (weeks on x-axis). Selectable exercise list with sparklines + badges (PR / progressing / holding). Special case: assisted exercises chart *downward as progress* (less assist = stronger) — the UI must make that read as a win.
- **Week review:** THE signature screen. The coach's weekly proposal: per-exercise cards showing old → new value + a one-line rationale in coach voice ("You hit 4×10 at RPE 7 twice — room to load."). Each card: Approve / Keep-as-is. Some cards are "hold" recommendations (no change, with reason). Approved cards visually settle; the week only updates after user decisions. This screen embodies "AI proposes, human approves" — design it like a respectful ritual, not a notification to dismiss.
- **History:** past sessions: day type, date, per-exercise actuals, PR flags, total volume, the user's notes.

### Tab 4 — Chat (the coach)
Conversational UI. User bubbles + coach bubbles (coach uses bold numbers, occasional emoji). Special inline elements:
- **Log cards** rendered in-stream after a food message: itemized foods with kcal/protein + running daily total
- Quick-log chips above the composer (recent/frequent: "🍗 Chicken adobo 1 cup", "😴 Slept 11pm–6:30am")
- Clarification prompts when input is vague (coach asks one short question)
The chat writes to the same data as everything else — logging here updates Today instantly.

### Tab 5 — Goals
- Primary goal (build muscle / lose fat / maintain / endurance / general health) — displayed as the thing that *drives* the dashboard
- Sports chips (lifting, running, cycling, swimming — multi-select, changeable)
- Targets list: daily calories, protein, goal weight, sleep floor, steps
- Units preference: kg ⇄ lbs (display-only toggle)

### Onboarding (first run, ~8 short steps)
name → height (+ optional sex/birthdate) → current & goal weight → primary goal → sports → availability (days/week, minutes/session, preferred days & time) → experience & equipment → medical conditions (OPT-IN behind an explicit consent step — sensitive, design the consent moment with care and clarity) → BMI shown ONCE as context with an explicit caveat ("one data point, not a verdict — muscle skews it") → "Xclr is building your program…" moment → **program preview** (per-day cards) the user approves/edits before it activates.

## 3. Key components to design
- Big-number hero (calories left) — the app's face
- Progress gauge + protein bar
- Sparkline (weight) + full progression chart (workout)
- Meal/food list item (name, serving, macros, kcal, estimate-vs-confirmed state, tap-to-edit)
- Exercise row (prescribed): sets×reps @ load + RPE target + coach note
- Set logger (actuals entry: load/reps/RPE — fast, thumb-friendly)
- **Proposal card** (old → new, rationale, Approve / Keep) + its decided states
- Chat bubbles + inline log card + quick chips
- PR / progressing / holding badges
- Segmented controls, bottom nav (5 items), goal/sport chips
- States for everything: loading, empty (first-day user), error

## 4. Data & formatting rules (fixed)
- Numbers are the interface: use tabular/lining numerals; big numbers deserve display treatment
- Weight shown to 2 decimals when logged so (71.75); calories whole; protein whole grams
- Units: kg default, lbs via preference (display-only)
- Load types always labeled: "30 kg" / "15 kg/side" / "40 kg assist" / "Bodyweight" / "25 min"
- No shame states: over-target is a neutral/informative treatment, never alarm-red guilt
- Medical/consent surfaces: plain language, unambiguous opt-in, easy to skip

## 5. Creative direction — OPEN (this is the commission)
Current placeholder aesthetic (v2 mock): warm paper background (#F6F3EC), deep ink green (#1E7A4D) for intake/progress, ember orange (#E0603A) for burn/activity, serif display numerals (Fraunces) + grotesk UI (Hanken Grotesk), soft cards, 16–26px radii. **Treat it as one candidate, not a constraint.**

Explorations welcome — e.g.:
1. **Evolve the warm editorial look** (paper + serif numbers, "training journal" feel) into something more refined
2. **Dark performance mode** — data-dense, athletic, high-contrast (Whoop/Strava energy) while keeping the coach's warmth
3. **Something else entirely** — propose it; only the product principles and structure above are fixed

Whatever the direction: it must carry a *voice* (this app talks), celebrate progress without infantilizing, stay readable at arm's length mid-workout with sweaty thumbs, and work as a coherent token system (colors, type scale, spacing, radii) we can implement in CSS custom properties.

## 6. Deliverables requested
1. Visual direction (moodboard/tokens: palette incl. semantic colors for intake/burn/protein/sleep, type scale, spacing, radii, iconography style)
2. High-fidelity mobile screens: Today, Food, Workout-Today, Workout-Progress, **Week review**, Chat, Goals, plus 3 onboarding steps (goal select, availability, medical consent) and the program preview
3. Component sheet (the §3 list with states)
4. Light and/or dark — designer's call, but state the choice

*Reference file available: xclr-mock-v2.html — interactive current mock (structure reference, not aesthetic gospel).*

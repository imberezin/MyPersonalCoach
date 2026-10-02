# Personal Eating Coach (app)

Phase 1: a private, mobile-first, Hebrew-first PWA for one user (built to grow to 5 to 50 without a rewrite).
Product documents live one level up. Start with `Technology Stack.md`, `INTERVENTIONS.md` and `TODO.md`.

## Stack

Next.js 16 (App Router) · TypeScript · CSS Modules + design tokens · Supabase (Postgres, Auth, Storage, RLS) ·
`use-intl` for Hebrew and English · Web Push (VAPID) · Vitest · PGlite for database tests.

## Commands

```bash
npm run dev         # http://localhost:3000, against the local Supabase (Docker)
npm run dev:hosted  # http://localhost:3001, against the hosted project (uses the *_1 values in .env.local)
npm run dev:both    # both of the above in one terminal; the tab title says [local] or [hosted]
npm run local:start # local Supabase in Docker (Docker Desktop must be running)
npm run local:setup # writes .env.local from the local stack and creates a local dev user
npm run local:stop  # stop it (data is kept); local:reset wipes the data and reapplies the migrations
npm run check       # lint + typecheck (runs `next typegen` first) + tests
npm test            # unit tests and the RLS tests (a real Postgres via PGlite, no Docker)
npm run build
npm run icons       # regenerate the placeholder PWA icons
```

First-time setup (Supabase, GitHub, Vercel): see `../SETUP-CHECKLIST.md`.
Environment variables: `.env.example`.

## Layout

```text
src/
├── app/            routes (thin): login, onboarding, (app) = home / progress (weight trend, landmarks) / coach / me (+ me/meals, me/weights), (flow) = report/food/*, report/weight (+ [id]/saved, [id]/edit), first-week (B6 summary, + experiment = B5), manifest, /api/engine/tick, /api/engine/shabbat-topup, /api/food/analyze
├── proxy.ts        refreshes the Supabase session and guards routes (Next 16 name for middleware)
├── domain/         pure logic, no I/O: offline periods, First Week, milestones, patterns, intervention library, Home state (home/), food reporting and the meal list (food/), First Week progress, acknowledgement and summary (firstWeekFlow/), the late-evening detector, pattern level and Early Signal rules (patterns/), first-experiment selection and the AI wording gate and validator (experiments/), weight reporting (weight/: the entry rules, the weekly trend, landmarks and the Home moment, the chart geometry)
├── components/     screen components by area: food/, meals/, firstWeek/, weight/ (entry form, My weights, the delete confirm), progress/ (the weekly line, landmarks, what was noticed), shell/, ui/
├── lib/
│   ├── supabase/   browser, server and admin clients, session refresh
│   ├── ai/         AIGateway (fallback, timeout, schema validation) + provider adapters (Gemini, Groq), quota ledger
│   ├── food/       food reporting IO: repository (RLS, RPCs; meal list and delete), analyze orchestrator, D8 follow-up seam
│   ├── firstWeek/  First Week reads (progress, snoozes, the summary) and the one transition writer
│   ├── patterns/   late-evening signal loader, the ONE evidence writer (sync_pattern_evidence), the answer, the end-of-save refresh
│   ├── experiments/  experiment rows (OFFERED, ACTIVE, SKIPPED) and the wording orchestrator (the only caller of the AI wording)
│   ├── weight/     the ONLY writer of weight_entries (repo), and the Progress and Home-milestone reads (load)
│   ├── progress/   what Progress says about the First Week (the adapter over the pattern and experiment loaders)
│   ├── clock/      the one "now" (currentInstant): the real time, or a development clock file when the stack is local
│   ├── http/       same-origin check for Route Handlers
│   ├── analytics/  track() and the allowed event names (no content)
│   ├── notifications/  Web Push provider
│   ├── shabbat/    @hebcal/core, SERVER ONLY (GPL-2.0)
│   ├── jobs/       cron jobs: the weekly Shabbat top-up (runner and Supabase store); plain TypeScript, no Hebcal import
│   └── cron/       shared-secret check for the cron endpoint
├── i18n/           he.json, en.json, server and client helpers
└── styles/         design tokens
bake-off/              data for the Hebrew AI bake-off (photos and results are gitignored)
supabase/migrations/   the schema, with RLS on every table
tests/db/              RLS tests on real Postgres
```

## Weekly Shabbat top-up

`POST /api/engine/shabbat-topup` (same Bearer as the tick), scheduled in SETUP-CHECKLIST.md 6ב. It keeps the next eight Shabbat periods stored for every user who observes Shabbat: insert-only, future rows only, idempotent, counts-only responses and logs; the answer is non-2xx when a run did not fully succeed. `?dryRun=1` plans without writing. Check coverage monthly with the query in 6ב.

Running it locally with the throwaway user (the local Docker stack only, never the hosted project):

1. The local database needs the top-up migration first (`npm run local:migrate`, run by you). Without it a real run answers 503 `rpc_missing`; a dry run never calls the function, so it cannot reveal a missing migration.
2. Seed the user as in "Local demo data" below (`demo@eating-coach.test` observes Shabbat and has a place). Use `--mode relative` or `--clock-off` so no `.dev-clock` file is left behind.
3. With `CRON_SECRET` from `.env.local`: `curl.exe -X POST "http://localhost:3000/api/engine/shabbat-topup?dryRun=1" -H "Authorization: Bearer <CRON_SECRET>"`, then the same without `dryRun`. A second real run must report `rowsInserted` 0.
4. Dev clock trap: `.dev-clock` sets the planner's "now", but the database function filters on the real `now()`. With a clock earlier than today, the rows between the two are planned and silently dropped (the run reports fewer rows added, or `current`). Delete `.dev-clock` or use a clock at or after today.

## Rules that matter

- **The engine selects, the AI only words.** Interventions come from `domain/interventions/library.ts`; the AI may personalize wording but never the action.
- **Confirmed data only.** Statistics read `meal_entries`; raw input and AI understanding are never counted.
- **Offline wins.** Ask `isOffline()` in `domain/offline.ts`; never re-implement the rule.
- **`@hebcal/core` is GPL-2.0.** Import it only from `src/lib/shabbat` (enforced by `server-only` and ESLint).
- **Secrets stay on the server.** Only `NEXT_PUBLIC_*` values reach the browser.
- **Every table has RLS**, and `tests/db/rls.test.ts` fails if one does not.
- **Free first.** Prefer services with a real free tier, and re-check limits before relying on them.
- **Design follows one document.** `../Personal Eating Coach — Brand & Color System.md` is the only authority for colors, type, radii and visual tone. Use the `--color-*` tokens in `src/styles/tokens.css`, never hex values, and never let a color judge food or the user. `tests/design/tokens.test.ts` enforces it. Dark Mode is not a Phase 1 goal.

This is Next.js 16: conventions changed (for example `proxy` replaced `middleware`). Check `node_modules/next/dist/docs/` before writing framework code.

## Local demo data

`npm run seed:demo` fills ONE throwaway user in the local Docker Supabase with a deterministic, realistic history (a few days of Hebrew meals, Shabbat periods, late-evening meals), so every Home state, the First Week summary, the pattern detector, the Early Signal card and the first experiment can be exercised "as of day N" in minutes, without waiting for real usage. It only runs against the Docker stack (the URL comes from `supabase status`, never from an environment file) and only for an `@eating-coach.test` user; anything else is refused before a single request. It never touches the hosted project, never reads a `.env*` file, and never prints the password, a key or a user id.

The user's password is your own choice and lives in your shell only (never a flag). In PowerShell, one command per line:

```powershell
$env:SEED_USER_PASSWORD = "any string you choose, at least 8 characters"
npm run seed:demo -- --scenario day4-candidate
npm run seed:demo -- --explain
npm run seed:demo -- --scenario day3 --fresh
npm run seed:demo -- --clock-only --clock-shift "+25h"
npm run seed:demo -- --clock-off
npm run seed:demo -- --reset
```

The first run creates `demo@eating-coach.test` in the local stack and signs in as that user, so every write is subject to the same row level security as the app. `--explain` prints what the app will decide at the current clock (level, Early Signal, Home state, experiment selection, wording gate) from the app's own loaders; the wording-gate line is evaluated ASSUMING the AI is configured with a daily cap of 40 (`--daily-cap N` changes only that number), because the runner reads no AI configuration. `--fresh` recreates the user first (its rows go with it), `--reset` removes it, `--drop-meals N|all` deletes the newest meals the way a plain SQL delete would (pattern rows are deliberately left alone). Every flag is validated before any call; `npm test` covers the pure parts under `tests/seed/` and never runs the live runner.

The clock: in the default `fixed` mode the script writes `app/.dev-clock` (gitignored, one ISO instant with an offset), and in development against the local stack the app reads it as "now" on every request, so a reload is enough. "As of day N" means N whole days have ended: the clock is 09:00 on day N+1 (`--as-of "day 3 21:30"` sets a time of day). The production build ignores the file. **Database timestamps stay real** (`confirmed_at`, `created_at`), so a meal cannot be saved through the UI while a fixed clock file exists: use `--mode relative` (today becomes day N+1 and no clock file is written) or `--clock-off`. The script prints one warning line whenever it leaves a clock file behind. Day 1 is Sunday 2026-09-13 in Asia/Jerusalem (`--start` changes it) and the First Week began at 12:00 that day.

| Preset | As of | Available days | Meals | Late evenings | Level | Home at 09:00 |
|---|---|---|---|---|---|---|
| `day1-empty` | day 1 | 1 | 0 | 0 | none | "Our first week" |
| `day3` | day 3 | 3 | 10 | 2 | Early Signal | the Early Signal card |
| `day4-candidate` | day 4 | 4 | 15 | 3 (two late meals on day 4 count once) | Candidate | the Early Signal card |
| `day5-early-finish` | day 5 | 5 | 18 | 4 | Candidate | the summary card |
| `absence` | day 5 | 5 | 5 | 0 | none | "You're back" |
| `shabbat-week` | day 8 | 7 (Saturday is offline) | 18 + 1 after-Shabbat report | 2 (the report is not evidence) | Early Signal | the summary card |
| `max-days` | day 17 | 15 | 2 | 0 | none | the summary card, neutral wording |

Explicit flags override a preset: `--days`, `--meals-per-day`, `--late-days 2,3|none`, `--double-late-days`, `--gap-days`, `--shabbat true|false`, `--aggregated-saturday-night`, `--total-meals N`, `--seed N`, `--goals a,b|none` and `--motivation "text"|none` (the profile's "Why we started"; the profile always has a numeric goal weight so that the screens can be checked never to show it). `tests/seed/plan.test.ts` derives every row above with the domain functions the app itself uses.

### Weigh-ins and the weight presets

The same script can also write weigh-ins, the start and goal weights and the end of the First Week, so Progress, "My weights" and the Home milestone card can be seen without waiting for real weeks. Weigh-ins are written as the demo user (row level security applies), with deterministic ids, so a re-run adds only what is new; to change the numbers of a preset, add `--fresh`. Like meals, a weigh-in that would fall inside a Shabbat period, or after the clock, is not written.

| Flag | Default | Meaning |
|---|---|---|
| `--lifecycle first_week\|weekly_cycle` | `first_week` | `weekly_cycle` ends the First Week (day 15 at 12:00, or an hour before the clock if that is earlier) |
| `--start-weight N`, `--goal-weight N\|none` | 80, 72 | the profile's weights (one decimal, 20 to 500); `none` stores no goal, so there are no landmarks |
| `--weights none\|weekly\|daily` | `none` | which entries to write |
| `--weight-series "a,b,c"` | none | weekly mode: one value per weigh-in, starting at the first `--weigh-day` on or after day 2 |
| `--weigh-day 0-6`, `--weigh-time HH:mm` | 5 (Friday), `08:00` | the weekly weigh-in (0 = Sunday) |
| `--weight-drift K`, `--weight-noise K` | -0.1, 0.6 | daily values, and weekly ones without a series: kg per day, and a deterministic noise from `--seed` |
| `--junk-weights on\|off`, `--junk-day N` | off, 30 | adds ONE absurd entry of 181 kg, to try deleting it |
| `--drop-weights N\|all` | none | deletes the newest N weigh-ins through RLS (the change log keeps no weight, only that one was removed) |

Every preset below has no meals, ends the First Week and sets a clock that is a Wednesday at 09:00 (outside the window of the Weekly Learning card, so the milestone card is not hidden by it). Landmarks are 80, 75 and 72 unless stated.

| Preset | As of | Weekly averages | Direction / since the start | Landmarks | Home at 09:00 |
|---|---|---|---|---|---|
| `w-none` | 2026-10-07 | none | - | 80 reached, 75 next | the usual card |
| `w-one` | 2026-09-23 | 1 | not enough yet | same | the usual card |
| `w-down` | 2026-10-28 | 6, 79.6 to 76.2 | down, 3.8 kg lower | 75 next | the usual card |
| `w-milestone` | 2026-10-28 | 6, 80.4 to 74.6 | down, 5.4 kg lower | 75 reached (weeks of 10-11 and 10-18), 72 next | "You reached a landmark" (until 2026-11-08) |
| `w-goal` | 2026-11-04 | 7, 79.0 to 71.6 | down, 8.4 kg lower | all reached | "You reached the weight you aimed for" (until 2026-11-15) |
| `w-steady` | 2026-10-21 | 5, about 78.2 | steady, 1.9 kg lower | 75 next | the usual card |
| `w-rising` | 2026-10-14 | 4, 76.4 to 78.2 (start 76) | up, 2.2 kg higher | 76 reached, 72 next | the usual card |
| `w-daily` | 2026-10-14 | 4 complete and the unfinished week; 26 daily entries | down | 75 next | the usual card |
| `w-junk` | 2026-10-28 | as `w-down` plus one 181 kg entry | up, because of the spike | 75 next | the usual card |
| `w-nogoal` | 2026-10-28 | as `w-down`, no goal weight | down | no landmarks | the usual card |

`--explain` adds the weight lines: the entries and how many are dated after the clock, the weekly points (complete or partial), the trend, the landmarks with their first and confirming weeks, the Home milestone decision with its window and why it is hidden, whether `/report/weight` is quiet at that instant, and the weight the "is that right?" check would compare with. `tests/seed/weights.test.ts` feeds every preset through the domain functions the app itself uses and checks this table.

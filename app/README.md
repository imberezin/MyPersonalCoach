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
├── app/            routes (thin): login, onboarding, (app) = home / progress / coach / me (+ me/meals), (flow) = report/food/*, first-week (B6 summary, + experiment = B5), manifest, /api/engine/tick, /api/food/analyze
├── proxy.ts        refreshes the Supabase session and guards routes (Next 16 name for middleware)
├── domain/         pure logic, no I/O: offline periods, First Week, milestones, patterns, intervention library, Home state (home/), food reporting and the meal list (food/), First Week progress, acknowledgement and summary (firstWeekFlow/), the late-evening detector, pattern level and Early Signal rules (patterns/), first-experiment selection and the AI wording gate and validator (experiments/)
├── lib/
│   ├── supabase/   browser, server and admin clients, session refresh
│   ├── ai/         AIGateway (fallback, timeout, schema validation) + provider adapters (Gemini, Groq), quota ledger
│   ├── food/       food reporting IO: repository (RLS, RPCs; meal list and delete), analyze orchestrator, D8 follow-up seam
│   ├── firstWeek/  First Week reads (progress, snoozes, the summary) and the one transition writer
│   ├── patterns/   late-evening signal loader, the ONE evidence writer (sync_pattern_evidence), the answer, the end-of-save refresh
│   ├── experiments/  experiment rows (OFFERED, ACTIVE, SKIPPED) and the wording orchestrator (the only caller of the AI wording)
│   ├── clock/      the one "now" (currentInstant): the real time, or a development clock file when the stack is local
│   ├── http/       same-origin check for Route Handlers
│   ├── analytics/  track() and the allowed event names (no content)
│   ├── notifications/  Web Push provider
│   ├── shabbat/    @hebcal/core, SERVER ONLY (GPL-2.0)
│   └── cron/       shared-secret check for the cron endpoint
├── i18n/           he.json, en.json, server and client helpers
└── styles/         design tokens
bake-off/              data for the Hebrew AI bake-off (photos and results are gitignored)
supabase/migrations/   the schema, with RLS on every table
tests/db/              RLS tests on real Postgres
```

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

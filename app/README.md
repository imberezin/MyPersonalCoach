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
├── app/            routes (thin): login, onboarding, (app) = home / progress / coach / me, manifest, /api/engine/tick
├── proxy.ts        refreshes the Supabase session and guards routes (Next 16 name for middleware)
├── domain/         pure logic, no I/O: offline periods, First Week, milestones, patterns, intervention library, Home state (home/)
├── lib/
│   ├── supabase/   browser, server and admin clients, session refresh
│   ├── ai/         AIGateway (fallback, timeout, schema validation) + provider adapters
│   ├── analytics/  track() and the allowed event names (no content)
│   ├── notifications/  Web Push provider
│   ├── shabbat/    @hebcal/core, SERVER ONLY (GPL-2.0)
│   └── cron/       shared-secret check for the cron endpoint
├── i18n/           he.json, en.json, server and client helpers
└── styles/         design tokens
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

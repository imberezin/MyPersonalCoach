# Technology Stack & Technical Architecture

**Product:** Personal Eating Coach · **Phase:** 1 (personal experiment, ~3 months, User #1)
**Version:** 1.1 · **Date:** 2026-10-01 · **Status:** approved by the owner on 2026-10-01 · **Sources:** see Appendix A (all external facts checked 2026-10-01)

<div dir="rtl">

### סיכום לבעל המוצר (עברית)

- **הסטאק המומלץ:** Next.js 16 + TypeScript + CSS Modules עם Design System עצמי. Supabase (Postgres, Auth, Storage, RLS). אחסון ב-Vercel Hobby. שכבת AI מופשטת (AI Gateway). Web Push. Modular Monolith אחד.
- **עלות Phase 1: 0$ לחודש**, לפי העיקרון "הכול חינם כשאפשר". כל השירותים נבדקו בעמודי המחירים הרשמיים.
- **שלוש מלכודות שנמצאו במחקר:**
  1. ה-cron של Vercel Hobby רץ פעם ביום בלבד (דיוק ±59 דקות), ולכן אי אפשר להפעיל עליו את ה-Behavior Engine. התזמון יושב ב-Supabase `pg_cron`.
  2. באייפון אין `SpeechRecognition` באפליקציה שהותקנה למסך הבית. קלט קולי = הקלטה ותמלול בשרת.
  3. הספרייה הטובה לזמני שבת (`@hebcal/core`) היא GPL-2.0, ולכן רק בצד שרת ובלי להפיץ את קוד השרת.
- **ספק ה-AI:** שני adapters מההתחלה (Gemini ו-Groq), ובדיקת "bake-off" על 20 תמונות ו-20 תיאורים בעברית תקבע את הראשי. **אושר:** מותר להעביר את הנתונים שלך ב-Gemini החינמי, אף שגוגל עשויה להשתמש בתוכן לשיפור מוצריה ולהעביר אותו לבדיקה אנושית. האישור חל על הנתונים שלך בלבד, ונתונים של משתמשים נוספים לא יעברו בשכבה החינמית.
- **נתונים בפועל על ספקים בפרק 11 ובנספח A.** פרטים שלא אומתו מסומנים "unverified". שלושה חשובים: איכות העברית, מגבלות הקצב של Gemini החינמי, וזמינות `pg_cron` בתוכנית החינמית.
- **סטטוס:** כל ההמלצות אושרו ב-2026-10-01. הוכרעו גם הגדרת "יום זמין" (פחות מ-50% ממנו Offline) ומועד "השבוע שלך" (אחרי אישור דיווח מוצאי שבת, אחרת בבוקר ראשון). נשארו רק שאלות ההמשך בפרק 21.

</div>

---

## How to read this document

Every substantive statement carries one of these labels, so requirements are never mixed with technology choices.

| Label | Meaning |
|---|---|
| **REQUIREMENT** | What the product must do. Technology-neutral. |
| **TECH-REQ** | What the system must support to enable the product. |
| **CONSTRAINT** | A boundary Phase 1 must respect. |
| **ALTERNATIVE** | A reasonable option that was considered. |
| **RECOMMENDATION** | A proposed solution, with reasons. |
| **DECISION** | A choice made for Phase 1. Status is **DECIDED** (the owner chose it) or **RECOMMENDED** (awaiting the owner's confirmation). |
| **FUTURE** | Intentionally deferred. |

Guiding principle: *Requirements define what the system must do. Recommendations define how we choose to build it.*

---

## 1. Executive Summary

Personal Eating Coach helps one person report food naturally, discover personal patterns, receive small timely interventions and track progress, while treating Shabbat as a real offline state and never behaving like a diet tracker.

**DECISION (recommended stack):**

```text
Next.js 16 (App Router) + TypeScript + React + CSS Modules + own Design System
Supabase: PostgreSQL + Auth + Storage + Row Level Security
Hosting: Vercel Hobby
AI Gateway (provider-neutral) -> Gemini / Groq adapters, chosen by a Hebrew bake-off
Scheduling: Supabase pg_cron + pg_net -> Next.js route
Notifications: Web Push (VAPID) from the server, PWA-ready
Shabbat times: @hebcal/core, server-side only
Analytics: own events table in Postgres behind a track() wrapper
Architecture: Modular Monolith, deterministic domain core, AI at the edges
```

**Cost:** $0/month in Phase 1 on free tiers (owner rule: *free wherever possible*). The only plausible paid item is the Gemini paid tier (about $0.6/month estimated, requires at least $5 prepaid credit), needed only if the owner later wants a no-training path for Gemini or adds users.

**Main risks:** Hebrew quality of cheap vision/STT models is unverified; free-tier limits and model lifecycles change; Supabase Free has no automatic backups and pauses inactive projects; Vercel Hobby is non-commercial only.

---

## 2. Product Requirements

Technology-neutral. Sources are the Product, UX and Screen specifications (`# Personal Eating Coach.md` sections in brackets).

### 2.1 Functional Requirements

- **REQUIREMENT R-F1.** The user can report food by photo, free text, or voice. Order of delivery: text and photo first, voice after the core loop and before Shabbat reporting. [D1–D4]
- **REQUIREMENT R-F2.** The system turns natural input into structured meal information, and the user reviews and corrects it on one screen before it becomes confirmed data. [D6–D7]
- **REQUIREMENT R-F3.** Activity (type + duration), weight (weekly default), sleep (hours + quality) and stress (1–5 + optional context) are reported manually. [E1–E4]
- **REQUIREMENT R-F4.** A dedicated First Week mode: at least 5 and at most 15 available days, offline periods excluded, no score, early signals only. Early end requires at least 5 available days and at least 10 confirmed meals. [B, §6]
- **REQUIREMENT R-F5.** A weekly cycle: aggregation, "השבוע שלך", one weekly experiment, its outcome, progress. [H, I]
- **REQUIREMENT R-F6.** Difficult-moment and recovery flows using a controlled intervention library, one intervention at a time, with outcome capture. [F, G]
- **REQUIREMENT R-F7.** A Coach that talks with the user using known context and never invents facts. [C4]
- **REQUIREMENT R-F8.** Progress shows weekly weight trend, computed milestones, behavior changes, validated patterns, experiments, activity, plateau context. [I]
- **REQUIREMENT R-F9.** A personal activity feed, contextual achievements and streaks with grace, all embedded in existing screens. [L]
- **REQUIREMENT R-F10.** Profile and settings: personal details, goal, food and kashrut preferences, activity, Shabbat, language, notifications, privacy. [K]

### 2.2 Data Requirements

- **REQUIREMENT R-D1.** Data states are kept distinct: **Raw → Understood → Confirmed → Learned**. [§31]
- **REQUIREMENT R-D2.** Confirmed data is always distinguishable from AI interpretation, and AI never promotes estimated data to fact without required user confirmation.
- **REQUIREMENT R-D3.** History is stored for weight, activity, sleep and stress to support trends and pattern analysis.
- **REQUIREMENT R-D4.** Pattern lifecycle: Observation → Candidate → Validated, with evidence. User confirmation alone is never sufficient. Thresholds are decided in §12.4.
- **REQUIREMENT R-D5.** Milestones are computed from start and goal weight, every 5 kg, last one equals the goal. A step that would land less than 2.5 kg from the goal is skipped, so 120 to 99 gives 120, 115, 110, 105, 99. Without a numeric goal there are no weight milestones.
- **REQUIREMENT R-D6.** The user can see what is stored, export it, and delete it.

### 2.3 AI Requirements

- **REQUIREMENT R-A1.** Understand Hebrew and English food text and food photos; return structured output with explicit uncertainty; never invent food.
- **REQUIREMENT R-A2.** Transcribe short Hebrew voice notes.
- **REQUIREMENT R-A3.** Summarize, coach and propose candidate patterns. Personalize the wording of interventions that the Behavior Engine selected **from the controlled library**, without changing the behavioral action.
- **REQUIREMENT R-A4.** AI is never the source of truth for weight, dates, activity totals, adherence or any calculation.
- **REQUIREMENT R-A5.** If AI fails, the user can always continue another way (for example write instead). [§26]

### 2.4 Offline Requirements

- **REQUIREMENT R-O1.** A generic `OfflinePeriod { type, start, end }`. Types: SHABBAT now; HOLIDAY and USER_DEFINED later; VACATION is a future type that appears only in the stack prompts.
- **REQUIREMENT R-O2.** During an offline period: notifications, reminders, meal reporting and interventions are off; streak penalties off; daily goals paused; adherence excluded.
- **REQUIREMENT R-O3.** After Shabbat the user gives one aggregated free-form report (text or voice, optional photos). The system organizes it into an expected timeline, shows missing events as missing, and only confirmed data becomes meal entries.
- **REQUIREMENT R-O4.** Shabbat start and end are derived from the user's location, not typed in by hand.

### 2.5 Notification Requirements

- **REQUIREMENT R-N1.** Notifications are contextual and driven by the Behavior Engine, never by a timer alone.
- **REQUIREMENT R-N2.** They respect user preferences (five types), quiet hours, offline periods and the intervention budget (at most one proactive intervention per day).
- **REQUIREMENT R-N3.** The system can decide to send nothing. An enabled notification type never obliges a send.

### 2.6 Analytics Requirements

- **REQUIREMENT R-X1.** Measure the product metrics in Appendix B (reporting coverage, reporting friction, AI correction rate, intervention usefulness, pattern discovery, recovery, consistency).
- **REQUIREMENT R-X2.** Never collect food content, weights or free text in analytics.

### 2.7 Security & Privacy Requirements

- **REQUIREMENT R-S1.** Authentication, and strict isolation of every user's data.
- **REQUIREMENT R-S2.** Secrets and AI credentials exist only on the server.
- **REQUIREMENT R-S3.** Raw food photos are not retained unnecessarily.
- **REQUIREMENT R-S4.** Controlled file access, encrypted transport, deletion of user data on request.

---

## 3. Technical Requirements

- **TECH-REQ T1.** A mobile-first web app that can be installed as a PWA.
- **TECH-REQ T2.** Server-side code for secrets: AI keys, push sending, privileged database access.
- **TECH-REQ T3.** A relational store with per-user row isolation.
- **TECH-REQ T4.** If photos are stored at all, temporary object storage whose deletion actually removes the object.
- **TECH-REQ T5.** A scheduler with minute-level precision for engine checks (for example "Shabbat approaching, 52 minutes") plus daily and weekly jobs, and idempotent jobs because schedulers can double-fire.
- **TECH-REQ T6.** Server-initiated Web Push where every push shows a visible notification (iOS does not allow silent push).
- **TECH-REQ T7.** AI access through a provider-neutral interface with schema-validated outputs, timeouts, usage caps and fallback.
- **TECH-REQ T8.** Hebrew and English UI with RTL and LTR, locale-aware dates and numbers, translation strings outside code.
- **TECH-REQ T9.** Deterministic domain logic isolated from I/O and unit-testable.
- **TECH-REQ T10.** All instants stored in UTC; rules evaluated in the user's time zone.
- **TECH-REQ T11.** An audit trail for edits and deletions of confirmed data.
- **TECH-REQ T12.** Minimal observability: application logs, error tracking, AI request telemetry.
- **TECH-REQ T13.** Data export in an open format.
- **TECH-REQ T14.** AI latency compatible with the metric "median Start Report → Meal Saved ≤ 20 s".

---

## 4. Phase 1 Constraints

- **CONSTRAINT C1.** Free wherever possible (owner rule, 2026-10-01).
- **CONSTRAINT C2.** One user at first; must extend to roughly 5–50 users without a rewrite.
- **CONSTRAINT C3.** Web-first. No native apps. No Apple Health or Health Connect.
- **CONSTRAINT C4.** No microservices, queues, event streaming, Kubernetes or complex ML.
- **CONSTRAINT C5.** Activity and sleep are manual.
- **CONSTRAINT C6.** No nutrition database; calories are not shown by default.
- **CONSTRAINT C7.** Free-tier limits apply (Section 17), and Vercel Hobby is restricted to non-commercial personal use.
- **CONSTRAINT C8.** The experiment lasts about 3 months, so simplicity beats scalability.

---

## 5. Architecture Principles

```text
Simple -> Modular -> Explicit boundaries -> Provider abstraction -> Easy migration
```

1. **Deterministic core, AI at the edges.** Dates, weights, totals, offline logic and engine rules are plain code. AI only interprets language and images and words things.
2. **Raw → Understood → Confirmed → Learned** is a first-class data model, not a convention.
3. **Silence is a valid output** of the Behavior Engine.
4. **Offline wins.** One function answers "is this user offline now?" and everything else asks it.
5. **UTC in the database, local time in the rules.**
6. **Modules are logical boundaries**, not deployable services.
7. **Avoid premature scale, abstraction and infrastructure.** Abstract only what we already know we may swap: AI provider, storage, notification sender, activity data source, analytics sink.

---

## 6. Architecture Options

### 6.1 Frontend

| Option | For | Against | Verdict |
|---|---|---|---|
| **ALTERNATIVE** React + Vite (SPA) | Lightest toolchain | No server layer, so AI keys, push sending and cron targets need a second service | Rejected: adds a service |
| **ALTERNATIVE** Another React framework | Similar capability | Smaller ecosystem for the stack above | Not needed |
| **RECOMMENDATION** Next.js (App Router) | Server code in the same deployment (route handlers, server actions) for secrets, AI calls, push; Server and Client Components; PWA path | Framework upgrade cadence (a security release shipped 2026-09-30) | **Chosen** |

### 6.2 Backend and Database

| Option | For | Against | Verdict |
|---|---|---|---|
| **ALTERNATIVE** AWS (Lambda, API Gateway, DynamoDB or RDS, Cognito) | Familiar to the owner, full control | Most infrastructure, not free-first, easy to over-build | Rejected for Phase 1 |
| **ALTERNATIVE** Separate backend service + managed DB | Clean separation | Second deployable, more operations | Rejected |
| **ALTERNATIVE** Next.js backend + any managed Postgres | Simple | Auth, storage and RLS must be assembled | Viable fallback |
| **RECOMMENDATION** Supabase-centric (Postgres, Auth, Storage, RLS) + Next.js as the application server | Free tier covers Phase 1 limits, relational data, per-row isolation, one dashboard | Free plan has no automatic backups and pauses inactive projects | **Chosen** |

Application and domain logic live in the Next.js codebase (TypeScript). The database enforces ownership (RLS) and integrity; it does not hold product logic.

### 6.3 AI

| Option | Hebrew vision + JSON | Free tier | Notes |
|---|---|---|---|
| **ALTERNATIVE** Gemini API | JSON schema with images verified in docs; Hebrew quality unverified | Yes | Free-tier content may improve Google products and be human-reviewed |
| **ALTERNATIVE** Groq | Schema + image combination unverified; Hebrew unverified | Yes | No retention by default; Israel availability unverified |
| **ALTERNATIVE** OpenAI | Strict schema documented; Hebrew unverified | No | Cheapest paid tokens |
| **ALTERNATIVE** Anthropic | Structured outputs GA | No | Highest cost, no speech-to-text |

Details and sources in Section 11 and Appendix A.

### 6.4 Scheduling

| Option | Limit | Verdict |
|---|---|---|
| **ALTERNATIVE** Vercel Hobby cron | Once per day, precision ±59 minutes; faster expressions fail deployment | Rejected: too coarse |
| **RECOMMENDATION** Supabase `pg_cron` + `pg_net` calling a Next.js route | Second-level scheduling; availability on Free "unverified" (no explicit statement found) | **Chosen**, with fallback below |
| **ALTERNATIVE** Cloudflare Workers cron | Free: 5 triggers, UTC | Fallback |
| **ALTERNATIVE** GitHub Actions schedule | 5-minute minimum, may be delayed, public-repo schedules auto-disable after 60 days idle | Fallback for weekly backup, not for the engine |

### 6.5 Hosting

| Option | Verdict |
|---|---|
| **RECOMMENDATION** Vercel Hobby | Free, 300 s function limit, native Next.js. Restricted to non-commercial personal use; the repo must be under a personal GitHub account (organization repositories cannot connect on Hobby). |
| **ALTERNATIVE** Self-host Next.js (Node, Docker, static export) elsewhere | Possible; needs shared cache handler and one encryption key for multiple instances. Revisit at first commercial use. |

---

## 7. Recommended Architecture

```text
 Phone (PWA, Hebrew/English, RTL/LTR)
    │ HTTPS
    ▼
 Next.js on Vercel Hobby (route handlers + server actions)
    ├── AI Gateway ───────► Provider A / Provider B (config-selected)
    ├── Push sender (VAPID) ► Apple / Google push services ► phone
    ├── Shabbat service (@hebcal/core, server-only)
    └── /api/engine/tick  ◄── Supabase pg_cron + pg_net (secret header)
    │
    ▼
 Supabase
    ├── Postgres (RLS on every user table) + events table (analytics)
    ├── Auth (single user, sign-ups disabled)
    └── Storage (temporary bucket only if needed)
```

### 7.1 Logical modules inside the monolith

```text
users · meals · food · nutrition (interface only) · weight · activity · sleep · stress
habits · patterns · interventions · experiments · motivation · ai · shabbat
notifications · analytics
```

### 7.2 Layers and boundaries

```text
UI (screens, components)
  -> Application logic (use cases, server actions)
    -> Domain logic (pure TypeScript, no I/O)
      -> Data access (repositories)
        -> External services (behind interfaces)
```

External services are hidden behind interfaces: `AIProvider`, `StorageProvider`, `NotificationProvider`, `ActivityDataSource`, `AnalyticsSink`, `ShabbatTimesProvider`.

---

## 8. Technology Stack Recommendations

### 8.1 Frontend

- **DECISION (DECIDED):** Next.js + React + TypeScript, mobile-first, PWA-ready.
- **RECOMMENDATION:** Next.js 16 is the current stable major (16.x Active LTS). Pin at least 16.3.8 because a security fix was released 2026-09-30.
- **RECOMMENDATION:** Use **Server Components** for read-heavy screens (Progress, "השבוע שלך", Home card) and **Client Components** only where interaction needs it (Report bottom sheet, camera, microphone, charts, push permission).
- SSR/SSG and SEO matter little: the app is private. A public landing page can come later.
- **RECOMMENDATION (not researched):** `app/manifest.ts` for the PWA manifest and a hand-written service worker for push (no offline-first requirement in Phase 1).

### 8.2 Design System

- **DECISION (DECIDED):** CSS Modules + CSS variables + own lightweight Design System. No large UI library.

```text
Design Tokens -> UI Components -> Product Components -> Screens
```

- Tokens planned up front: spacing, typography, radius, shadow, sizing, breakpoints, semantic colors, light/dark.
- **RECOMMENDATION:** use CSS logical properties (`margin-inline-start`, `inset-inline-end`, ...) everywhere so one stylesheet serves RTL and LTR.
- **Tailwind: not in Phase 1.** It would add a second styling system next to the tokens. Revisit if the team grows.
- **DECISION (DECIDED, changed during the build on 2026-10-01):** `use-intl` for i18n, with `src/i18n/messages/he.json` and `en.json`; `dir` and `lang` set on `<html>` from the user's language; the language comes from the profile (mirrored in a cookie), not from the URL; dates and numbers via `Intl`. The first recommendation was `next-intl`, but its Next.js plugin loads `@swc/core` at config time, and that native addon refuses to load on this Windows profile (a strict permissions check on `%LOCALAPPDATA%\swc`), which would break `next dev`. `use-intl` is the same ICU message engine without the plugin.

### 8.3 Backend

- **DECISION (DECIDED):** Modular Monolith inside the Next.js project; no separate backend service.

### 8.4 Database

- **DECISION (DECIDED):** Supabase PostgreSQL. RLS on every user-owned table.
- Free plan facts: 500 MB database, 2 active projects, **no automatic backups**, inactive projects are paused (inactivity = insufficient database activity over a week; a few requests a day suffice). See Appendix A.
- **RECOMMENDATION:** a weekly `supabase db dump` job (GitHub Actions or a local scheduled task) stored privately, because three months of personal data is not replaceable.

### 8.5 Authentication

- **DECISION (DECIDED):** single user, simple login, Supabase Auth.
- **DECISION (DECIDED):** email + password, public sign-ups **disabled**, the single account created from the dashboard. Reason: Supabase's built-in email sender is limited to 2 messages per hour and only to project-team addresses, which makes magic links fragile. Magic links need a custom SMTP provider once there are 5–50 users.

### 8.6 Storage

- **DECISION (DECIDED):** food photos are deleted at confirmation or discard.
- **DECISION (DECIDED), zero-retention path:** a single food photo is compressed on the device, sent to a server route, held in memory, forwarded to the AI provider and never persisted. This satisfies the decision more strictly and avoids storage traps.
- **RECOMMENDATION, storage path only when needed** (for example a Shabbat report with many photos): upload to a private temporary bucket, delete through the **Storage API** (deleting rows in SQL orphans the object), and run a cleanup job that removes anything older than 24 hours.
- Limits to remember: Supabase Free storage 1 GB, 50 MB per file. Platform request-body limits of the hosting layer were **not researched**; verify before relying on the zero-retention path for large uploads.

### 8.7 AI

See Section 11. Provider-neutral gateway; provider choice pending a bake-off.

### 8.8 Analytics

- **DECISION (DECIDED, owner's free-first rule applied):** an `events` table in Postgres behind an `AnalyticsSink.track()` wrapper. No third party sees food or weight data.
- **FUTURE:** PostHog Cloud (free: 1M events per month; choose the EU region at sign-up because moving later needs a support ticket; set `autocapture: false` and `disable_session_recording: true`).

### 8.9 Notifications

- **DECISION (DECIDED):** Web Push.
- Facts: Android Chrome supports it. iOS/iPadOS 16.4+ supports it **only for web apps added to the Home Screen**, the permission request must follow a direct tap, and **silent push is not allowed** (a push without a visible notification can get the permission revoked). Payload up to 4 KB. There is no local scheduling, so the server decides and sends every notification. Declarative Web Push exists from iOS/iPadOS 18.4.
- **RECOMMENDATION (not researched):** the `web-push` library with VAPID keys, subscriptions stored in Postgres. No FCM needed.
- Consequence for onboarding: an iPhone-specific "Add to Home Screen" step before asking for notification permission, and the permission request on a tap.
- Consequence for the engine: every push must be a visible, meaningful notification, which matches the product rule of "silence unless useful".

### 8.10 Hosting and Monitoring

- **DECISION (DECIDED):** Vercel Hobby for the app, Supabase Free for data.
- **RECOMMENDATION:** logs via platform logs (note: Hobby runtime logs are retained about 1 hour) plus a small `app_errors` table and an `ai_requests` table (provider, latency, tokens, outcome). Add Sentry's free tier only if the table approach proves too thin (not researched).

---

## 9. Phase 1 Technical Decisions

| Area | Choice | Status | Basis |
|---|---|---|---|
| Users | Single user, simple login | **DECIDED** | Owner, 2026-10-01 |
| Cost rule | Free wherever possible | **DECIDED** | Owner, 2026-10-01 |
| Frontend | Next.js, React, TypeScript, CSS Modules, own Design System | **DECIDED** | Stack prompts |
| Backend | Modular Monolith | **DECIDED** | Stack prompts |
| Database / Auth / Storage | Supabase | **DECIDED** (direction) | Stack prompts |
| Nutrition data | No database; foods + portions only; `nutrition` is an interface | **DECIDED** | Owner |
| Photos | Deleted at confirmation or discard | **DECIDED** | Owner |
| Shabbat times | Existing library, computed from location | **DECIDED** (library below) | Owner |
| Voice input | After core loop, before Shabbat | **DECIDED** | Owner |
| Analytics | Own `events` table + `track()` wrapper | **DECIDED** | Owner rule applied |
| Pattern thresholds, First Week end, milestones, outcome scale | See §12 | **DECIDED** | Owner |
| Login method | Email + password, sign-ups disabled | **DECIDED** | Supabase SMTP limit |
| Photo path | Zero-retention in memory; temp bucket only for large batches | **DECIDED** | Strengthens photo decision |
| Scheduler | Supabase `pg_cron` + `pg_net` -> `/api/engine/tick` | **DECIDED** | Vercel Hobby cron too coarse |
| Hosting | Vercel Hobby (personal, non-commercial) | **DECIDED** | Free; revisit at commercial use |
| AI provider | Gateway with Gemini + Groq adapters; primary chosen by bake-off | **DECIDED** | §11 |
| Voice transcription | Record on device, transcribe on the server; shortlist Groq Whisper, Gemini, Azure Speech F0, Cloudflare Workers AI | **DECIDED** | iOS limits |
| Shabbat library | `@hebcal/core`, server-side only | **DECIDED** | §13.2 |
| Backups | Weekly `supabase db dump` | **DECIDED** | No backups on Free |
| Push stack | `web-push` + VAPID, iOS Home Screen step | **DECIDED** | §8.9 |
| AI data policy | The owner's own data may use Gemini's free tier (risk accepted); other users' data may not | **DECIDED** | Owner, 2026-10-01 |
| "Available day" | A day is available if less than 50% of it is covered by an `OfflinePeriod` | **DECIDED** | Owner, 2026-10-01 |
| "השבוע שלך" timing | After the Motzei Shabbat report is confirmed; otherwise Sunday morning | **DECIDED** | Owner, 2026-10-01 |
| Intervention library | 11 interventions; the engine selects key and variant, the AI only personalizes wording | **DECIDED** | Owner, 2026-10-01 · `INTERVENTIONS.md` |
| Intervention cooldown | Per intervention + context, 14 days after two consecutive "not really" | **DECIDED** | Owner, 2026-10-01 |
| Outcome model | Two fields: `helpfulness` and `continued_eating` | **DECIDED** | Owner, 2026-10-01 |

All rows above were approved by the owner on 2026-10-01. Anything can still be changed later; nothing here locks Phase 1.

---

## 10. Data Architecture

**RECOMMENDATION:** relational, normalized only where it pays; items inside a meal are stored as schema-validated JSON for now.

### 10.1 Entities and ownership

Every table has `user_id` (owner), `created_at`, and `updated_at` where rows change. RLS policy on every table: `user_id = auth.uid()`.

```text
auth.users 1─1 profiles
profiles 1─N user_preferences (or one row, jsonb)
meal_raw_inputs 1─N meal_understandings 1─0..1 meal_entries
weight_entries · activity_entries · sleep_entries · stress_entries
events (behavior + analytics)
patterns 1─N pattern_evidence
interventions (library, in code or table) 1─N intervention_instances
experiments (0..1 active) -> experiment_outcomes
weekly_summaries
offline_periods
push_subscriptions · notification_log
audit_log
```

| Entity | Key fields (indicative, not final SQL) |
|---|---|
| `profiles` | display name, age, height, goal type (numeric / behavioral / none), start and goal weight, motivation text, language, time zone, location (lat, lon), candle-lighting minutes, kashrut and food preferences, lifecycle state (`NEW`, `ONBOARDING`, `FIRST_WEEK`, `WEEKLY_CYCLE`) |
| `meal_raw_inputs` | kind (photo / text / voice / shabbat_freeform), text or transcript, photo reference if stored, `occurred_at`, `recorded_at` |
| `meal_understandings` | raw input id, provider and model id, prompt version, items (food, portion, confidence, uncertain flag), overall confidence, status (pending / accepted / edited / rejected) |
| `meal_entries` | **confirmed only**: understanding id, `occurred_at`, meal type, items, `confirmed_at`, source (`ai_unedited` / `ai_edited` / `user_manual`), offline period id if from an aggregated report |
| `weight_entries` | weight, `measured_at`, source (manual) |
| `activity_entries` | type, duration, `occurred_at`, source (manual; future Apple / Google) |
| `sleep_entries` | hours, quality, night date, source |
| `stress_entries` | level 1–5, optional note, `occurred_at` |
| `patterns` | kind, status (`OBSERVATION`, `CANDIDATE`, `VALIDATED`, `REJECTED`), first seen, validated at, user feedback (confirm / unsure / reject) |
| `pattern_evidence` | pattern id, event reference, observed at |
| `intervention_instances` | library key, level 0–3, detected context, shown at, proactive flag, variant, eating phase, `helpfulness`, `continued_eating` (see §12.3) |
| `experiments` | optional source pattern, intervention key, status (`ACTIVE` / `DONE` / `SKIPPED`), start, end, outcome |
| `weekly_summaries` | week start, opening mode (`CELEBRATE` / `LEARN` / `RECOVER` / `RESET`), generated content, generated at, viewed at |
| `offline_periods` | type, `start_at`, `end_at`, source (auto / manual), location and candle minutes used |
| `push_subscriptions`, `notification_log` | endpoint and keys; sent or suppressed with reason |
| `events` | event name, payload without content, `occurred_at` (analytics and Behavior Engine input) |
| `audit_log` | table, row id, action, before/after summary, at |

### 10.2 Rules

- **Raw vs confirmed.** `meal_entries` is the only source for any statistic. Understanding rows are never counted.
- **Two clocks.** `occurred_at` (when it happened) is separate from `recorded_at` (when reported). Shabbat meals are recorded after the fact.
- **Confidence** lives on the understanding, never on the confirmed entry; the entry records *who* made it true (`source`).
- **Audit** is written for edits and deletions of confirmed rows.
- **Not over-normalized:** meal items stay JSON until a query needs them as rows.
- **Deterministic reads:** weight trend, milestones, activity totals, adherence and week boundaries are computed in the domain layer, never by AI.

---

## 11. AI Architecture

### 11.1 Gateway

```text
Frontend -> Server route -> AI Gateway -> Provider adapter -> Provider
```

```ts
interface AIProvider {
  analyzeMeal(input: { image?: Bytes; text?: string; locale: 'he' | 'en' }): Promise<MealUnderstanding>;
  analyzeText(input: { text: string; locale: 'he' | 'en' }): Promise<MealUnderstanding>;
  transcribeVoice(input: { audio: Bytes; mime: string; locale: 'he' | 'en' }): Promise<Transcript>;
  generateInsight(ctx: InsightContext): Promise<Insight>;          // wording only
  detectPatternCandidate(events: EventSummary[]): Promise<PatternCandidate[]>;
  coach(messages: Message[], ctx: CoachContext): Promise<CoachReply>;
}
```

Gateway responsibilities: provider selection by config, timeouts, **schema validation of every output** (for example with Zod) with one repair attempt, ordered fallback (provider A, provider B, manual path), per-user daily call caps (protects free-tier quotas), telemetry (provider, model, latency, tokens, outcome, whether the user corrected the result).

Rules:

- Model identifiers live in configuration, not in code. Model lifecycles are short (see 11.3).
- Uncertainty is first-class: an item can be `uncertain` or `unknown`; the output schema allows "I could not understand this" and the UI shows it as missing. The gateway never fills gaps.
- `generateInsight` and `coach` receive only the context they need (Screen §30). They may personalize the wording of the variant the engine selected. They may not change the action, scope or safety constraints, and may not add advice (see `INTERVENTIONS.md`).

### 11.2 AI vs deterministic logic

| Deterministic (plain code) | AI |
|---|---|
| Weight trend, milestones, dates, weekly periods | Language understanding |
| Offline periods and Shabbat times | Image interpretation |
| Activity totals, adherence, metrics | Summaries and coaching wording |
| Pattern lifecycle and thresholds | Candidate pattern suggestions |
| Intervention eligibility, budget, cooldown | Wording within a chosen library item |

### 11.3 Provider findings (checked 2026-10-01; sources in Appendix A)

| | Gemini | Groq | OpenAI | Anthropic |
|---|---|---|---|---|
| Cheapest suitable vision + JSON model | `gemini-3.1-flash-lite` (shutdown 2027-05-07) | `qwen/qwen3.8-27b` | `gpt-6-luna` | Claude Haiku 4.5 |
| Free tier | Yes (rate numbers unpublished outside AI Studio) | Yes: 30 RPM, 1K requests/day, 200K tokens/day | No | No (small trial credits) |
| Paid price per 1M tokens in/out | $0.25 / $1.50 | $0.80 / $4.00 | $0.10 / $0.50 | $1 / $5 |
| Free-tier data terms | Used to improve Google products; humans may read; terms say no sensitive or personal data | No retention by default | No training by default; abuse logs up to 30 days | No training by default; retention up to 30 days, flagged up to 2 years |
| Hebrew speech-to-text | `gemini-3.5-transcribe`, he-IL listed | Whisper turbo, Hebrew unlisted on Groq pages | `gpt-transcribe`, Hebrew unverified | None |
| Estimated monthly cost at 15 reports/day | about $0.6 paid | $0 within free limits (about 58 photo reports/day ceiling) | about $0.2 | about $2.3 |

**Unverified for all four:** Hebrew quality of the cheap vision models. **Unverified:** Groq schema-plus-image combination and Israel availability; Gemini free-tier request limits.

**DECISION (DECIDED):**

1. Build the gateway with **two adapters from day one: Gemini and Groq**.
2. Run a **bake-off** before building the confirmation screen: 20 Hebrew meal photos and 20 Hebrew text descriptions, measuring structured accuracy and correction rate against the target "at least 85% structured without significant correction".
3. **Data policy (DECIDED 2026-10-01):** the owner accepts that his **own** real data (food photos, weight) may go through Gemini's free tier, knowing that Google's terms say free-tier content may be used to improve its products and reviewed by humans, and advise against submitting sensitive personal data. Guardrails: photos should avoid faces and other people; the acceptance covers the owner's data only, so data of any additional user must go through a no-training path (Groq, or Gemini paid at about $0.6/month with at least $5 prepaid credit that expires after 12 months).
4. Anthropic is ranked last under the free-first rule (no free tier, highest cost, no speech-to-text). It remains a drop-in adapter if quality demands it.

### 11.4 Food photo and text flow

```text
Photo (device) -> compress (max ~1024 px long edge, JPEG ~0.8)
  -> server route (memory)  -> analyzeMeal()  -> MealUnderstanding (validated)
  -> one-screen confirmation -> save meal_entry -> (photo never stored or deleted)
```

Compression keeps token cost and latency down. The 20-second median target implies an AI latency budget of roughly 6–8 seconds at p50 (RECOMMENDATION derived from the metric).

### 11.5 Voice flow

```text
Record on device (MediaRecorder) -> upload -> transcribeVoice() -> text -> same path as text
```

Facts: on iOS, `getUserMedia` and `MediaRecorder` work in Home Screen apps, but **`SpeechRecognition` is not available in Home Screen web apps**, so browser dictation is not an option on iPhone. Users report microphone permission re-prompts on cold start (WebKit asked for a new bug report on 2026-02-03). Free transcription candidates: Groq Whisper (20 requests/min, 2K/day, 28.8K audio-seconds/day on the free plan), Gemini (he-IL listed; free-tier data caveat), Azure Speech F0 (5 audio-hours/month, he-IL listed), Cloudflare Workers AI (about 214 minutes/day, Whisper turbo). Hebrew accuracy of each is **unverified**; decide with a short bake-off when voice is built.

### 11.6 Nutrition boundary

`nutrition` is an interface with no implementation in Phase 1. AI identifies foods; any future calculation belongs to a nutrition engine over a nutrition database, never to the model.

---

## 12. Behavior Engine Architecture

### 12.1 Pipeline

```text
User data + events
  -> Context detection (rules; AI may suggest, never decide)
  -> Eligibility (context, timing, eating phase, mode, constraints)
  -> Cooldown (per intervention + context)
  -> Gates: offline? intervention budget? quiet hours? preferences?
  -> Personal history (validated patterns, past outcomes)
  -> Candidate interventions (controlled library, approved variants)
  -> ONE intervention, or ASK, or DO_NOTHING (always allowed)
  -> Controlled wording (AI personalizes within constraints)
  -> Deliver (Home card or Web Push)
  -> Outcome (helpfulness + continued eating) -> Learning
```

- Contexts: true hunger, stress, fatigue, craving, social, environment, habit, unclear.
- **DECISION (DECIDED 2026-10-01):** the decision function is pure: `decide(input, now) -> Decision`. The outcome is `DO_NOTHING`, `ASK` or `INTERVENTION` (key, variant, level); the delivery channel is `HOME_CARD` or `NOTIFY`; a reason string goes to the log. Side effects (database writes, push) happen after it. Nothing forces an intervention: the engine never has to "do something".
- **Levels (DECIDED):** 0 `DO_NOTHING`; 1 `ASK`, a short question or invitation with no action; 2 a small action the user may choose to do; 3 a short guided action with several steps, a timer or a return prompt.
- **Budget (DECIDED):** at most one **proactive** intervention per day; interventions the user starts themselves are not counted.
- **Cooldown (DECIDED 2026-10-01):** an intervention that gets "not really" twice in a row **in the same context** is not offered again in that context for 14 days (a tunable constant). The pair is intervention + context, and `Unclear` is its own context.
- **True hunger (DECIDED):** before eating, or when the eating phase is unknown, true hunger gets no intervention. `slow_down` is allowed during eating only.
- **Selection vs wording (DECIDED):** the engine selects the intervention key and the approved variant. The AI may only personalize the wording; it may not change the behavioral action, scope or safety constraints.
- The library (11 interventions, with timing, variants and constraints) is a separate document: `INTERVENTIONS.md`.

### 12.2 Execution

`pg_cron` calls `/api/engine/tick` every few minutes with a secret header. The route verifies the secret and runs jobs that are all **idempotent** (unique keys, "already done" checks). **Status 2026-10-07:** the tick runs and succeeds, but its job list is still empty. What belongs in it, and what was deliberately moved out:

1. evaluate the engine for each user (not built);
2. ~~generate the next Shabbat offline periods (weekly)~~ moved out of the tick: it has its own route and schedule, `/api/engine/shabbat-topup` (live since 2026-10-02; decision in TODO.md section 0);
3. ~~close the week and generate the weekly summary~~ dropped as a job: the weekly summary is derived from live data on every read and written only when the owner presses a button (TODO.md section 0, Weekly Learning decisions), so no job precomputes it;
4. remove stale temporary photos (not built).

The Web Push sender is not part of the tick either. It is its own route, `POST /api/engine/notify` (built 2026-10-07, not scheduled yet), so that it can be switched off independently with `cron.unschedule('notify')`. It fails closed: a dry run unless `NOTIFY_SENDER_LIVE=1` and no `dryRun` parameter is present. Design, decisions and rollout: TODO.md section 4 and SETUP-CHECKLIST.md 6d.

Whether `pg_cron`-only activity counts as "database activity" against Supabase's inactivity pause is unverified, so the plan does not rely on it: daily use of the app is the keep-alive.

Home state is computed on read with the same pure functions: Morning, After Meal Report, Before Known Risk Context, Good Day, Difficult Day, Evening, Before Shabbat, Motzei Shabbat, Nothing Important / Silence.

### 12.3 Outcomes

**DECIDED 2026-10-01.** Outcomes are stored as two separate fields, so the engine never learns "he ate, therefore the intervention failed":

- `helpfulness`: `HELPFUL`, `SOMEWHAT`, `NOT_REALLY` or `UNKNOWN` ("really helped / helped a little / not really / don't know"). Learning reads this field.
- `continued_eating`: `YES`, `NO` or `UNKNOWN`. Asked only when the intervention was around eating; the default is `UNKNOWN`. It is context for learning, not a verdict.

Experiments use `helpfulness` plus `tried` (`YES` or `NO`; "didn't get to try" is `tried = NO`). Outcomes are learning data, never scores.

### 12.4 Pattern lifecycle (DECIDED thresholds, tunable constants)

```text
Early Signal    2 occurrences
Candidate       3 occurrences on different days
Validated       5 occurrences over at least two weeks,
                or Candidate + user "yes" with at least 3 occurrences
User confirmation alone is never sufficient.
```

### 12.5 First Week state machine

```text
NEW -> ONBOARDING -> FIRST_WEEK -> WEEKLY_CYCLE
```

`FIRST_WEEK -> WEEKLY_CYCLE` when available days >= 5 and confirmed meals >= 10, or at 15 available days (then with a summary of what is known and no failure language). A day is **available** when less than 50% of it is covered by an `OfflinePeriod` (DECIDED 2026-10-01): a Friday on which Shabbat starts in the evening normally counts, a Saturday does not. No score, no percentages, no "missed" wording.

### 12.6 Weekly cycle

```text
Collect data -> exclude offline periods -> find meaningful events -> weekly story
-> opening mode (Celebrate / Learn / Recover / Reset) -> validated pattern?
-> choose ONE experiment (or none) -> next week
```

**Timing (DECIDED 2026-10-01):** "השבוע שלך" appears after the Motzei Shabbat report is confirmed; if the user skips that report, it appears on Sunday morning.

"השבוע שלך" explains what happened this week, **Progress** explains what changed over time, and the **Weekly Experiment** is the single next step. They are three different screens with three different data scopes.

---

## 13. Offline / Shabbat Architecture

### 13.1 OfflinePeriod

```text
offline_periods { type: SHABBAT | HOLIDAY | USER_DEFINED, start_at, end_at, source }
```

One function `isOffline(user, instant)` is the only authority. Notifications, reminders, engine, reporting UI, streaks, adherence and First Week counting all call it.

### 13.2 Shabbat times

- **DECISION (DECIDED):** use an existing library with the user's location: **`@hebcal/core`**, run **server-side only**.
- Findings: version 6.11.0 published 2026-09-29; computes candle lighting and havdalah locally from latitude, longitude and an IANA time zone (no network); license **GPL-2.0**.
- **Licensing consequence:** using it in unreleased server code does not trigger the GPL's distribution terms, but shipping it to browsers does. So: never import it into client bundles (enforce with a lint rule), and revisit if server code is ever distributed.
- **Candle-lighting minutes differ by place** (library defaults: diaspora 18, Israel 20, Jerusalem 40, Haifa 30), so the profile stores an explicit value that the user confirms.
- **ALTERNATIVES:** `kosher-zmanim` (LGPL; last published 2025-03-23, licence metadata inconsistent), `@hebcal/noaa` (LGPL-2.1, sunset only), `suncalc` (BSD-2, you write the rules), and the free Hebcal REST API (CC BY 4.0, 90 requests per 10 seconds, online only, no SLA found).

A weekly job writes the next Shabbat as an `offline_periods` row (candle lighting to havdalah) with the inputs recorded; the user can override. HOLIDAY periods can come from the same library later (FUTURE).

### 13.3 Motzei Shabbat

```text
Free-form report (text / voice / optional photos)
  -> AI understanding -> expected timeline (evening, morning, kiddush, meals)
  -> user review -> missing items shown as missing + [Add]
  -> confirm -> meal_entries created (flagged as aggregated)
```

Raw text and understandings are stored; only confirmed entries count. The gateway is instructed and validated never to fabricate a meal for an unmatched slot.

---

## 14. Security Architecture

- **Auth:** Supabase Auth, single user, **sign-ups disabled**, password login (DECIDED).
- **RLS:** enabled on every user-owned table with `user_id = auth.uid()`. The service-role key exists only in server environment variables and is used only by server code that cannot be reached with another user's identity (cron route, jobs).
- **Cron route:** `/api/engine/tick` rejects any request without the secret header.
- **Secrets:** AI keys, VAPID private key, service-role key, cron secret live in Vercel environment variables. Nothing sensitive reaches the browser.
- **Photos:** private bucket only if used; short-lived signed URLs; deletion through the Storage API.
- **Transport:** HTTPS (provided by the host).
- **Privacy:** export (JSON) and full delete (cascade delete of rows, purge of stored objects). Analytics carry no content. Least privilege everywhere.
- **Free-tier data terms** are part of the threat model: see the data policy in 11.3.

---

## 15. Testing Strategy

**RECOMMENDATION (tools not researched):** Vitest for unit and integration, Playwright for end-to-end, Supabase local stack for database and RLS tests.

Priorities (no 100% coverage goal):

1. First Week state transitions (5 days with enough meals, 15 days without, offline days inside).
2. Offline periods and `isOffline`, including DST and time-zone edges.
3. Shabbat period generation and the Motzei Shabbat flow (missing items never invented).
4. Meal confirmation and AI output validation (malformed, partial and hostile outputs).
5. Pattern lifecycle thresholds.
6. Intervention rules: budget, cooldown, silence by default.
7. Weekly calculations, weight trend, milestones.
8. **RLS and data ownership:** a second user can never read or write the first user's rows.
9. Hebrew bake-off as a repeatable evaluation script, not a one-off.

---

## 16. Deployment Strategy

### 16.1 Environments and CI/CD

```text
Development: local Next.js + Supabase local stack
Production:  Vercel Hobby + Supabase Free project
Staging:     FUTURE
```

```text
Git -> Pull Request -> lint -> type check -> tests -> build -> deploy (Vercel Git integration)
Database changes: versioned SQL migrations applied with the Supabase CLI
```

Constraints: Vercel Hobby cannot connect repositories owned by a GitHub organization, so the repo lives under the owner's personal account.

### 16.2 Repository structure (RECOMMENDATION)

```text
src/
├── app/                 routes, layouts, route handlers (thin)
├── features/            meals · weight · activity · sleep · stress · patterns
│                        interventions · experiments · shabbat · coach · profile
├── domain/              pure logic: firstWeek, offline, weightTrend, milestones,
│                        patternLifecycle, interventionSelection, weekly
├── lib/                 supabase · ai · notifications · analytics · shabbat
├── components/          design-system UI + product components
├── i18n/                he · en
└── styles/              tokens, globals
```

`domain/` imports nothing from `lib/` or UI. External services are reached through interfaces in `lib/`.

### 16.3 Observability

Platform logs plus `app_errors` and `ai_requests` tables; an audit trail through `audit_log`. No separate observability stack.

---

## 17. Cost Strategy

**CONSTRAINT:** free wherever possible. **RECOMMENDATION:** prefer services with real free tiers and build guardrails, because free tiers can change.

| Service | Free allowance relevant to Phase 1 | Cost driver to watch |
|---|---|---|
| Supabase Free | 500 MB DB, 1 GB storage (50 MB/file), 50K MAU, 5 GB egress, 500K Edge invocations, 2 projects | Pause after a week of inactivity; no backups; over quota leads to read-only restrictions |
| Vercel Hobby | 100 GB transfer, 1M invocations, 4 Active CPU-hours, 300 s functions | Non-commercial only; cron once a day |
| AI | Gemini free, Groq free (see 11.3) | Free-tier privacy; model shutdown dates |
| Web Push | No cost via the browsers' push services | None |
| Cron | `pg_cron` inside the database | Availability on Free unverified |
| Analytics | Own table | Storage growth (small) |
| Email | Supabase built-in (2/hour) | Avoided by password login |

**Guardrails:** per-user daily AI call caps, image compression before upload, a monthly review of quotas and model deprecations, and a deliberate switch plan (Gemini paid about $0.6/month, Vercel Pro $20/month, Supabase Pro from $25/month) that is *not* triggered silently.

Free tier does not mean permanently free: re-check pricing pages before any decision that depends on them.

---

## 18. What We Explicitly Do NOT Build

**Not required in Phase 1:** Kubernetes, microservices, Kafka, RabbitMQ, SQS, EventBridge, Redis, Elasticsearch, Lambda per endpoint, API Gateway, DynamoDB, Cognito, event sourcing, CQRS, custom ML, recommendation models, dedicated workers.

**Technically possible but intentionally deferred:** native iOS/Android apps, HealthKit, Google Health Connect, large UI frameworks, PostHog, Tailwind, a nutrition database, social features, complex gamification.

They become appropriate only when a real requirement appears. *Simple first; add complexity only when evidence justifies it.*

---

## 19. Future Architecture

```text
Phase 1 (1 user)        Next.js + Supabase + AI Gateway + own events + manual data
Phase 2 (5–50 users)    custom SMTP + magic links, Vercel Pro or other host if commercial,
                        AI cost optimization, PostHog (EU), background jobs only if needed,
                        ActivityDataSource: Apple Health / Health Connect, HOLIDAY offline periods,
                        per-user language and gendered copy, privacy policy and legal review
Later (large)           only if required: queues, workers, service separation, dedicated infra
```

---

## 20. Architecture Decision Records

**ADR-1 Backend architecture**
- Status: DECIDED (direction)
- Requirement: simple backend with relational data, auth, storage, user isolation, near-zero cost.
- Options: AWS services; separate backend + database; Supabase-centric.
- Chosen: Supabase + Next.js application server (modular monolith).
- Why: lowest operational load, free tier fits, RLS gives isolation from day one.
- Trade-offs: less infrastructure control; Free plan has no backups and pauses when idle.
- Revisit when: scale, compliance or cost requirements change.

**ADR-2 Scheduler**
- Status: DECIDED
- Requirement: minute-level engine checks, weekly jobs.
- Options: Vercel Hobby cron (daily); Supabase `pg_cron`; Cloudflare Workers cron; GitHub Actions.
- Chosen: `pg_cron` + `pg_net` to a secured Next.js route.
- Why: second-level scheduling inside the database; Hobby cron cannot do it.
- Trade-offs: `pg_cron` availability on Free is documented but not explicitly confirmed for the plan.
- Revisit when: `pg_cron` is unavailable (fallback Cloudflare Workers cron) or load grows.

**ADR-3 AI provider**
- Status: DECIDED
- Requirement: Hebrew vision + structured output + coaching at near-zero cost, with privacy for personal data.
- Options: Gemini, Groq, OpenAI, Anthropic.
- Chosen: provider-neutral gateway with Gemini and Groq adapters, primary picked by a Hebrew bake-off.
- Why: only these have free tiers; quality is unverified; swapping must stay cheap.
- Trade-offs: Google may use and review free-tier content (the owner accepted this for his own data only); Groq's image-plus-schema support and Israel availability need confirmation.
- Revisit when: bake-off results, model shutdowns (`gemini-3.1-flash-lite` 2027-05-07), pricing changes.

**ADR-4 Voice input**
- Status: DECIDED
- Requirement: Hebrew voice notes on iPhone PWA.
- Options: browser SpeechRecognition; server transcription.
- Chosen: record on device, transcribe on the server.
- Why: SpeechRecognition is unavailable in iOS Home Screen web apps.
- Trade-offs: needs a provider and an upload step; Hebrew accuracy unverified.
- Revisit when: Apple enables it for Home Screen web apps.

**ADR-5 Shabbat times**
- Status: DECIDED
- Requirement: local computation from location.
- Options: `@hebcal/core` (GPL-2.0), `kosher-zmanim` (LGPL), `suncalc` (BSD), Hebcal REST API.
- Chosen: `@hebcal/core`, server-only.
- Why: actively maintained, computes candle lighting and havdalah directly.
- Trade-offs: GPL obligations if server code is ever distributed; candle-minute defaults vary by place.
- Revisit when: the product is distributed or becomes commercial.

**ADR-6 Photo handling**
- Status: DECIDED (strengthens a DECIDED rule)
- Requirement: do not retain photos unnecessarily.
- Options: store then delete; never store.
- Chosen: in-memory pass-through; temporary bucket only for large batches, with API deletion and a 24-hour cleanup.
- Why: removes a class of leaks and the Storage orphan trap.
- Trade-offs: request-size limits of the host were not researched.
- Revisit when: large uploads fail.

**ADR-7 Analytics**
- Status: DECIDED
- Requirement: measure product metrics without sending sensitive data away.
- Options: PostHog; own table; none.
- Chosen: own `events` table behind `track()`.
- Why: free, private, enough for one user.
- Revisit when: 5–50 users need funnels.

**ADR-8 Authentication**
- Status: DECIDED
- Chosen: email + password, sign-ups disabled.
- Why: built-in email is 2 messages per hour and team-only.
- Revisit when: more users (custom SMTP, magic links).

**ADR-9 Hosting**
- Status: DECIDED
- Chosen: Vercel Hobby.
- Why: free and native; limited to non-commercial personal use.
- Revisit when: any financial gain is involved.

**ADR-10 Frontend, language, design system**
- Status: DECIDED
- Chosen: Next.js, TypeScript, CSS Modules, own Design System.
- Why: server layer for secrets, PWA path, no UI-library lock-in.
- Revisit when: the team or product scale changes.

---

## 21. Open Questions

**Resolved on 2026-10-01:** login method (email + password, sign-ups disabled); `@hebcal/core` server-side only; "available day" rule (less than 50% offline); timing of "השבוע שלך"; the owner's own data may use Gemini's free tier.

**Still open** (checked against the code and the live project on 2026-10-06; items 1, 3 and 4 are settled and stay in the list, struck through, so the numbers that other documents use do not change):

1. ~~**Primary AI provider:** run the Hebrew bake-off and pick Gemini or Groq; confirm Groq's image-plus-schema support and Israel availability.~~ **Settled:** `gemini-3.1-flash-lite` first and Groq `qwen/qwen3.8-27b` second, chosen by the Hebrew text bake-off of 2026-10-01; the 20-photo run was declared not required on 2026-10-05. Groq answered a real live report as the fallback. Still unverified: Groq with an image plus `json_schema` (the code runs Groq in `json_object`, the mode documented to work with an image).
2. **Voice provider:** choose after a short Hebrew accuracy test; check Groq Hebrew support.
3. ~~**Scheduler:** confirm `pg_cron` works on the Supabase Free plan when the project is created; otherwise use Cloudflare Workers cron.~~ **Settled (2026-10-01):** `pg_cron` and `pg_net` work on the Free plan; `engine-tick` runs every 5 minutes and `shabbat-topup` twice a week. No Cloudflare Workers cron is needed.
4. ~~**Candle-lighting minutes:** per-city default plus a user-confirmed value at onboarding.~~ **Settled:** every one of the 57 built-in places has a default, and the person confirms the minutes in onboarding step A9.
5. **Backups:** where to store the weekly database dump.
6. **Large photo batches:** verify host request-size limits for the in-memory photo path. **Update 2026-10-06:** a single photo is settled (compressed on the phone to at most 700 KB, refused by the server above 1 MB, and a real camera photo worked on 2026-10-02); what remains is the Shabbat batch path, which is not built.
7. **Supabase pausing:** whether `pg_cron`-only activity counts as activity (unverified); daily app use is assumed.
8. **Multiple users later:** their data must not use Gemini's free tier; gendered copy, per-user language, privacy policy and legal review for health-adjacent data.
9. **Vercel Hobby terms** if anyone pays for the product or contributes financially.

---

## Appendix A — Research Log (checked 2026-10-01)

Facts below come from official pages named in each row. "Unverified" means no official statement was found.

| Topic | Fact | Source |
|---|---|---|
| Supabase Free | $0; DB 500 MB; storage 1 GB, 50 MB per file; 50K MAU; egress 5 GB + 5 GB cached; 500K Edge invocations; 2 active projects; no automatic backups | supabase.com/pricing · supabase.com/docs/guides/storage/uploads/file-limits |
| Supabase Pro | From $25/month; 7 days daily backups | supabase.com/pricing · supabase.com/docs/guides/platform/backups |
| Supabase pausing | Paused if insufficient database activity over a week; a few requests a day suffice; restorable | supabase.com/docs/guides/platform/free-project-pausing |
| Supabase cron | `pg_cron` and `pg_net` documented; explicit "included in Free" statement not found | supabase.com/docs/guides/cron · supabase.com/docs/guides/database/extensions/pg_net |
| Supabase Edge Functions | 256 MB, 2 s CPU, 150 s wall clock on Free | supabase.com/docs/guides/functions/limits |
| Supabase email | Built-in SMTP: 2 messages per hour, project-team addresses only | supabase.com/docs/guides/auth/auth-smtp |
| Supabase Storage deletion | SQL deletes orphan objects; use the Storage API | supabase.com/docs/guides/storage/management/delete-objects |
| Vercel Hobby | 100 GB transfer, 1M invocations, 4 CPU-hours; organization repos cannot connect | vercel.com/docs/plans/hobby · vercel.com/docs/limits |
| Vercel fair use | Hobby is "restricted to non-commercial personal use only"; donations are not commercial | vercel.com/docs/limits/fair-use-guidelines |
| Vercel cron (Hobby) | 100 jobs, once per day, precision ±59 minutes | vercel.com/docs/cron-jobs/usage-and-pricing |
| Vercel functions | 300 s default and max on Hobby | vercel.com/docs/functions/configuring-functions/duration |
| Vercel Pro | $20/month per developer seat | vercel.com/pricing |
| GitHub Actions | 5-minute minimum schedule, can be delayed; public-repo schedules disable after 60 days of inactivity | docs.github.com (events that trigger workflows) |
| Cloudflare Workers | Free: 5 cron triggers, 10 ms CPU per trigger | developers.cloudflare.com/workers/platform/limits |
| Next.js | 16 is stable; 16.3 on 2026-08-03; security fix 16.3.8 on 2026-09-30 | nextjs.org/support-policy · nextjs.org/blog |
| PostHog | Free monthly: 1M events, 5K recordings; EU region (Frankfurt); `autocapture` and session recording settings | posthog.com/pricing · posthog.com/docs |
| Gemini | Free tier exists; free content may improve products; paid not used; JSON schema with images; `gemini-3.1-flash-lite` $0.25/$1.50 per 1M, shutdown 2027-05-07; `gemini-3.5-transcribe` he-IL | ai.google.dev/gemini-api/docs (pricing, terms, models, deprecations) |
| Groq | Free: 30 RPM, 1K/day, 8K tokens/min, 200K/day; Whisper free 20 req/min, 2K/day; `qwen/qwen3.8-27b` $0.80/$4.00; no retention by default | console.groq.com/docs |
| OpenAI | No free allowance documented; `gpt-6-luna` $0.10/$0.50; `gpt-transcribe` $0.0045/min; whisper-1 retires 2027-02-26 | developers.openai.com/api/docs |
| Anthropic | No free tier; Haiku 4.5 $1/$5; structured outputs GA; no speech input | platform.claude.com/docs · privacy.claude.com |
| Web Push, iOS | iOS/iPadOS 16.4+, Home Screen only; permission after a tap; no silent push; 4 KB payload; Declarative Web Push from 18.4 | webkit.org/blog/13878 · webkit.org/blog/16535 · developer.apple.com |
| Web Push, Android | Chrome supports it with HTTPS, service worker, user opt-in; Chrome may auto-remove permission for low-engagement sites | developer.mozilla.org · web.dev · blog.google |
| Speech | iOS: `getUserMedia` and `MediaRecorder` available; `SpeechRecognition` not available in Home Screen web apps | bugs.webkit.org (225298, 185448) · caniuse data |
| Shabbat libraries | `@hebcal/core` 6.11.0 (2026-09-29, GPL-2.0); `kosher-zmanim` 0.9.0 (2025-03-23, LGPL); `@hebcal/noaa` 0.12.3 (LGPL-2.1); `suncalc` 2.0.2 (BSD-2); Hebcal REST API free, CC BY 4.0, 90 requests per 10 s | npm registry pages · hebcal.com/home/developer-apis · gnu.org/licenses/gpl-faq |

**Items that are recommendations from general engineering practice and were not researched here:** `use-intl`, `web-push`, Zod, Vitest, Playwright, the Supabase local stack, Sentry, `app/manifest.ts`, the "disable sign-ups" setting, image compression numbers, platform request-size limits.

## Appendix B — Product metrics the architecture must support

| Metric | Target | Data needed |
|---|---|---|
| Weight | about 10 kg over 12 weeks (experimental) | `weight_entries` |
| Food reporting | at least 80% meaningful reporting on available days | `meal_entries`, `isOffline` |
| Reporting friction | median Start Report → Meal Saved at most 20 s | `meal_report_started`, `meal_saved` events |
| AI understanding | at least 85% structured without significant correction | `meal_understandings.status`, `meal_corrected` |
| Recommendation usefulness | at least 70% marked helpful | `intervention_instances.outcome` |
| Behavior change | 2 of 3 personal target behaviors improve by at least 20% | events, entries |
| Pattern discovery | at least 3 validated patterns by week 4 | `patterns` |
| Recovery | at least 80% return next day after a self-defined bad day | events |
| Consistency | at least 5 active days out of 6 available days per week | entries, `isOffline` |
| Shabbat | correct offline handling and return | `offline_periods`, Motzei Shabbat events |
| "Doesn't feel like a diet" | weekly subjective measure | a weekly one-tap question |

Events (no content): `meal_report_started`, `meal_saved`, `meal_corrected`, `activity_reported`, `weight_reported`, `difficult_moment_started`, `intervention_shown`, `intervention_completed`, `intervention_helped`, `experiment_started`, `experiment_completed`, `weekly_summary_viewed`, `shabbat_started`, `shabbat_report_completed`, `recovery_returned`.

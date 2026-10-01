# Prompt: Create the Technology Stack & Technical Architecture Document

אני רוצה שתיצור מסמך Markdown מלא בשם:

`TECHNOLOGY-STACK.md`

עבור המוצר **Personal Eating Coach**.

המסמך צריך להתבסס על כל החלטות המוצר וה-UX שכבר התקבלו, ולא להמציא ארכיטקטורה מורכבת שלא נדרשת ל-Phase 1.

המטרה היא להגדיר **Stack טכנולוגי פשוט, זול, מודולרי וניתן להרחבה**, שמתאים ל-MVP / Phase 1 של משתמש יחיד, אבל לא יוצר Technical Debt מיותר שיקשה על מעבר ל-5–50 משתמשים בהמשך.

---

# 1. Product Context

המוצר הוא Web App מסוג Personal Eating Coach.

המוצר אינו אמור להרגיש כמו:

- calorie tracker
- diet tracker
- medical application
- fitness tracker

הוא אמור לעזור למשתמש:

- לדווח על אוכל בצורה טבעית
- להבין דפוסים אישיים
- לקבל התערבויות קטנות בזמן הנכון
- לעקוב אחרי התקדמות
- ללמוד מה עובד עבורו
- להתמודד טוב יותר עם ימים קשים
- להתחשב בשבת ובתקופות Offline

המערכת כוללת:

- Food reporting
- Photo / Text / Voice
- AI food understanding
- Meal confirmation
- Weight tracking
- Activity tracking
- Sleep tracking
- Stress tracking
- Behavioral patterns
- Interventions
- Weekly experiments
- Weekly summary — "השבוע שלך"
- Progress
- Personal Coach
- Shabbat / Offline periods
- Notifications
- Motivation / engagement

---

# 2. Phase 1 Scope

Phase 1 הוא ניסוי אישי של כ-3 חודשים.

בשלב הראשון:

- המשתמש הוא למעשה User #1
- אין צורך בארכיטקטורה ל-scale גדול
- אין צורך ב-microservices
- אין צורך ב-Kubernetes
- אין צורך ב-event-driven architecture מורכב
- אין צורך ב-message queues
- אין צורך ב-Lambda לכל פעולה
- אין צורך ב-AWS infrastructure מורכב

אבל:

הארכיטקטורה צריכה להיות מספיק מודולרית כדי שאפשר יהיה לעבור בהמשך ל:

```text
1 user
   ↓
5 users
   ↓
10 users
   ↓
20–50 users
```

בלי Rewrite גדול.

---

# 3. Required Frontend Stack

המלצה בסיסית:

- Next.js
- React
- TypeScript
- CSS / CSS Modules
- lightweight internal Design System

יש להסביר למה Next.js מתאים לפרויקט.

התייחס במיוחד ל:

- App Router
- Routing
- Server Components
- Client Components
- SSR / SSG
- SEO עבור אזורים ציבוריים
- Authenticated application
- Mobile-first Web
- אפשרות להפוך את המוצר ל-PWA בעתיד

המערכת צריכה להיות:

```text
Mobile-first
Web-first
PWA-ready
```

אין צורך לבנות Native App בשלב זה.

---

# 4. UI / Design System

אין להשתמש ב-UI library גדולה כברירת מחדל.

העדפה:

```text
CSS
CSS Modules
CSS Variables
Own Design System
```

המערכת צריכה להיות מבוססת Design Tokens:

```text
Design Tokens
      ↓
UI Components
      ↓
Product Components
      ↓
Screens
```

יש לתכנן מראש:

- spacing
- typography tokens
- border radius
- shadows
- sizing
- breakpoints
- semantic colors
- RTL/LTR
- light/dark architecture

אין צורך להחליט כרגע על צבעים סופיים.

יש להסביר האם Tailwind מתאים או לא, ואם כן — האם כדאי להכניס אותו כבר ב-Phase 1.

---

# 5. Internationalization

האפליקציה צריכה להיות Multi-language מהיום הראשון.

Phase 1:

```text
Hebrew
English
```

Hebrew:

```text
RTL
```

English:

```text
LTR
```

הטקסטים צריכים להיות מופרדים מהקוד.

לדוגמה:

```text
locales/
├── he/
│   └── common.json
└── en/
    └── common.json
```

יש להסביר:

- i18n architecture
- RTL support
- direction-aware CSS
- date / number formatting
- future languages

---

# 6. Backend Architecture

העדפה היא:

## Modular Monolith

ולא Microservices.

הצע מבנה לוגי כגון:

```text
users
meals
food
nutrition
weight
activity
sleep
stress
habits
patterns
interventions
experiments
motivation
ai
shabbat
notifications
analytics
```

הסבר איך ניתן לשמור את המודולריות בתוך backend אחד.

---

# 7. Backend / Database Recommendation

בדוק והמלץ האם:

**Supabase**

מתאים ל-Phase 1.

התייחס ל:

- PostgreSQL
- Authentication
- Storage
- Row Level Security
- Edge Functions
- Database access
- Local development
- Free tier
- Cost
- Security
- Future migration options

המטרה היא למזער עלויות ב-Phase 1.

אל תבחר AWS רק בגלל familiarity אם Supabase נותן פתרון פשוט יותר.

---

# 8. Data Architecture

הצע schema לוגי ראשוני עבור הישויות המרכזיות:

```text
User
Profile
MealEntry
MealRawInput
MealUnderstanding
WeightEntry
ActivityEntry
SleepEntry
StressEntry
Pattern
PatternEvidence
Intervention
InterventionOutcome
Experiment
ExperimentOutcome
WeeklySummary
OfflinePeriod
Notification
UserPreference
```

אין צורך לכתוב SQL מלא.

כן צריך להסביר:

- relationships
- ownership
- timestamps
- confidence
- raw vs confirmed data
- audit/history where useful

---

# 9. Important Data State Model

יש להפריד בין:

```text
Raw
 ↓
Understood
 ↓
Confirmed
 ↓
Learned
```

לדוגמה:

```text
rawInput
   ↓
aiUnderstanding
   ↓
confirmedMeal
   ↓
behaviorContext
   ↓
pattern
```

חשוב במיוחד:

AI אינו רשאי להפוך מידע משוער לעובדה מאומתת בלי user confirmation כאשר נדרש.

---

# 10. AI Architecture

ה-AI צריך להיות מאחורי abstraction layer.

לדוגמה:

```text
Frontend
   ↓
Backend
   ↓
AI Gateway
   ↓
AI Provider
```

ה-Gateway צריך לאפשר החלפת provider.

יכולות לדוגמה:

```text
analyzeMeal()
analyzeText()
transcribeVoice()
generateInsight()
detectPatternCandidate()
coach()
```

יש להפריד בין:

### AI

- language understanding
- image understanding
- summarization
- coaching
- candidate pattern detection

לבין:

### Deterministic logic

- weight calculations
- dates
- weekly calculations
- activity totals
- adherence
- offline periods
- metrics

AI אינו source of truth לחישובים.

---

# 11. AI Provider

בדוק האם כדאי להתחיל עם:

- Gemini
- OpenAI
- Anthropic
- provider אחר

המטרה היא:

- low cost
- good multimodal capabilities
- Hebrew support
- structured output
- image understanding
- voice/transcription where relevant

אין צורך להתחייב לספק אחד.

יש להמליץ על abstraction שמאפשר החלפה.

אם יש טענות עדכניות לגבי מחירים, limits או capabilities — יש לבצע Web Research ולציין מקורות ותאריך.

---

# 12. Food / Image Architecture

Food reporting יכול להגיע מ:

```text
Photo
Text
Voice
```

Photo flow:

```text
Photo
 ↓
Compression
 ↓
Storage
 ↓
AI Vision
 ↓
Structured Understanding
 ↓
User Confirmation
 ↓
MealEntry
```

יש להסביר:

- image compression
- upload
- storage
- temporary retention
- deletion
- privacy
- AI access
- האם לשמור original image

העדפה:

לא לשמור תמונות Raw ללא צורך.

---

# 13. Voice Architecture

המשתמש יכול לומר:

> "אכלתי עכשיו פיצה, בערך שלושה משולשים וקולה זירו."

המערכת:

```text
Voice
 ↓
Transcription
 ↓
Food Understanding
 ↓
Confirmation
 ↓
MealEntry
```

יש להציע architecture שמאפשר להחליף transcription provider בעתיד.

---

# 14. Nutrition Architecture

אין להסתמך על AI כמקור אמת תזונתי.

הפרד:

```text
Food Understanding
        ↓
Nutrition Engine
        ↓
Nutrition Database
```

AI מזהה:

```text
שניצל
אורז
סלט
```

Nutrition layer אחראי ל:

- nutrition data
- portions
- calculations
- estimates

ב-Phase 1:

Calories should not dominate the UI.

ניתן לחשב מידע פנימי גם אם לא מציגים אותו למשתמש.

---

# 15. Behavior Engine

זה אחד החלקים המרכזיים של המוצר.

Architecture:

```text
User Data
    ↓
Context Detection
    ↓
What is likely happening?
    ↓
Personal History
    ↓
Candidate Interventions
    ↓
Choose ONE
    ↓
Intervention
    ↓
Outcome
    ↓
Learning
```

המערכת צריכה להיות מסוגלת לבחור:

```text
DO NOTHING
```

אין לשלוח intervention רק כדי "לעשות משהו".

---

# 16. Intervention Library

המערכת צריכה להשתמש בספריית interventions מוגדרת מראש.

לדוגמה:

```text
Pause
Check Hunger
Portion First
Slow Down
Replace Context
Micro Walk
Eat Intentionally
Environment
Delay
Self-Compassion / Recovery
Ask Instead
```

AI לא אמור להמציא intervention חופשי.

AI יכול לבחור / לנסח intervention מתוך controlled library.

---

# 17. Intervention Budget

Phase 1:

```text
Maximum:
1 proactive intervention/day
```

או פחות.

יש להסביר מדוע עדיף להגביל intervention frequency.

---

# 18. First Week Architecture

יש state מיוחד:

```text
NEW
 ↓
ONBOARDING
 ↓
FIRST_WEEK
 ↓
WEEKLY_CYCLE
```

First Week:

- minimum 5 available days
- maximum 15 available days
- Offline periods excluded
- no performance score
- early signals instead of confirmed patterns
- small experiments
- frequent positive feedback

If enough data exists earlier:

```text
FIRST_WEEK
   ↓
WEEKLY_CYCLE
```

If not enough data by 15 available days:

```text
FIRST_WEEK
   ↓
Summary of what is known
   ↓
WEEKLY_CYCLE
```

No failure state.

---

# 19. Weekly Architecture

Weekly cycle:

```text
Collect Data
 ↓
Exclude Offline Periods
 ↓
Analyze Meaningful Events
 ↓
Weekly Story
 ↓
Learning
 ↓
Pattern
 ↓
ONE Experiment
 ↓
Next Week
```

יש להסביר איך:

- Weekly Summary
- Weekly Experiment
- Progress

נבדלים זה מזה.

---

# 20. Offline / Shabbat Architecture

Shabbat הוא לא "missing data".

הגדר abstraction:

```text
OfflinePeriod
```

with:

```text
type
start
end
```

Future types:

```text
SHABBAT
HOLIDAY
VACATION
USER_DEFINED
```

During OfflinePeriod:

```text
notifications = OFF
reminders = OFF
meal reporting = OFF
interventions = OFF
streak penalties = OFF
daily goals = PAUSED
adherence calculations = EXCLUDED
```

---

# 21. Motzei Shabbat Architecture

Important UX rule:

The user does NOT report each Shabbat meal separately.

Instead:

```text
Free-form Report
      ↓
AI Understanding
      ↓
Expected Meal/Event Timeline
      ↓
User Review
      ↓
Missing Information
      ↓
Correction
      ↓
Confirmed MealEntries
```

Important:

If AI does not know what happened:

```text
לא הצלחתי להבין
```

not an invented meal.

---

# 22. Notifications Architecture

Notifications should be driven by the Behavior Engine.

Not:

```text
Timer
 ↓
Notification
```

Instead:

```text
Context
 ↓
Behavior Engine
 ↓
Is there a meaningful reason?
 ├── No → Nothing
 └── Yes
       ↓
Notification
```

Notifications must respect:

- user preferences
- quiet hours
- Shabbat
- OfflinePeriod
- intervention budget

---

# 23. Web Push / PWA

Phase 1 is Web-first.

Investigate current support for:

- Web Push
- Service Workers
- Notifications API
- PWA
- Android
- iOS/iPadOS

Important:

Do not assume that browser Web Push is equivalent to native mobile push.

If discussing current iOS support, verify using current Apple documentation.

No native iOS application is required in Phase 1.

---

# 24. Apple Health / Automatic Integrations

Important Phase 1 decision:

Do NOT build automatic Apple Health / HealthKit integration.

Phase 1:

```text
ActivityDataSource
        ↓
Manual
```

Future architecture:

```text
ActivityDataSource
├── Manual
├── AppleHealth
├── Google Health Connect
└── Other
```

Same principle can apply to sleep.

Do not ask for HealthKit permissions during onboarding in Phase 1.

---

# 25. Activity Architecture

Phase 1 activity data is manual.

Long-term goal:

```text
60 minutes/day
```

Progression:

```text
Week 1    baseline
Week 2    15 min/day
Week 3    20
Week 4    25
Week 5–6  30
Week 7–8  40
Week 9–10 50
Week 11–12 60
```

The architecture should allow automatic sources later without changing the domain model.

---

# 26. Weight Architecture

Product default:

```text
Weekly Weigh-In
```

Not daily.

The system should store:

```text
WeightEntry
- userId
- weight
- timestamp
- source
```

Progress should be based on trend.

Do not build the product around daily weight fluctuations.

---

# 27. Sleep Architecture

Phase 1:

```text
Manual
```

Sleep is primarily used for:

- pattern detection
- context
- understanding hunger / behavior
- learning

No rigid "8 hours" requirement.

---

# 28. Stress Architecture

Simple manual 1–5 measurement.

No long questionnaire.

Used for:

```text
Context
 ↓
Pattern
 ↓
Intervention
```

---

# 29. Authentication

Evaluate Supabase Auth for Phase 1.

Support should be kept simple.

Possible methods:

- email
- magic link
- password
- social login later

Do not implement unnecessary authentication complexity.

---

# 30. Authorization / Security

Every user-owned record must be isolated.

If using Supabase:

```text
Supabase Auth
     ↓
User ID
     ↓
RLS
     ↓
User-owned data
```

Discuss:

- Row Level Security
- server-side secrets
- API keys
- AI provider keys
- Storage access
- signed URLs where appropriate
- least privilege

No AI API key in browser.

---

# 31. Storage

Use object storage for:

- food images
- voice files if retained
- future media

Do not store large binary files directly in PostgreSQL.

Possible Phase 1:

```text
Supabase Storage
```

Future:

```text
Cloudflare R2
```

only if cost / scale makes it useful.

---

# 32. Analytics

Recommended:

```text
PostHog
```

Evaluate whether it is appropriate for Phase 1.

Track product events such as:

```text
meal_report_started
meal_saved
meal_corrected
activity_reported
weight_reported
difficult_moment_started
intervention_shown
intervention_completed
intervention_helped
experiment_started
experiment_completed
weekly_summary_viewed
shabbat_started
shabbat_report_completed
recovery_returned
```

Avoid collecting unnecessary sensitive information in analytics.

---

# 33. Product Metrics

The architecture should support measurement of:

### Weight

~10 kg experimental target over 12 weeks.

### Food Reporting

≥80% meaningful reporting on available days.

### Reporting Friction

Median Start Report → Meal Saved ≤20 seconds.

### AI Understanding

≥85% structured without significant correction.

### Recommendation Usefulness

≥70% marked helpful.

### Behavior Change

At least 2 of 3 personal target behaviors improve by ≥20%.

### Pattern Discovery

≥3 validated patterns by week 4.

### Recovery

≥80% return next day after self-defined bad day.

### Consistency

≥5 active days out of 6 available days/week on average.

### Shabbat

Correct offline handling and return after Shabbat.

### "Doesn't feel like a diet"

Weekly subjective measurement.

---

# 34. Logging / Observability

Phase 1 should remain simple.

Need:

- application logs
- error tracking
- AI request/error tracking
- basic performance monitoring
- audit trail for important data changes

Avoid building a large observability stack.

Recommend a simple approach and explain the choice.

---

# 35. Testing Strategy

Define testing levels:

```text
Unit Tests
 ↓
Integration Tests
 ↓
E2E Tests
```

Prioritize tests around:

- Meal confirmation
- AI output validation
- Offline periods
- Shabbat
- Weekly calculations
- First Week state transitions
- Intervention rules
- RLS/security
- data ownership

Do not chase 100% coverage.

Focus on critical product logic.

---

# 36. Environment Strategy

At minimum:

```text
Development
Production
```

Optional later:

```text
Staging
```

Phase 1 should avoid unnecessary infrastructure.

Explain environment variables and secrets.

---

# 37. Deployment

Evaluate:

```text
Vercel
```

for Next.js frontend/application hosting.

Evaluate Supabase for:

- database
- auth
- storage

Explain current pricing/free-tier considerations only after verifying current official documentation.

Architecture should allow migration if required.

---

# 38. CI/CD

Keep it simple.

Suggested:

```text
Git
 ↓
Pull Request
 ↓
Lint
 ↓
Type Check
 ↓
Tests
 ↓
Build
 ↓
Deploy
```

No complex deployment pipeline is required for Phase 1.

---

# 39. Repository Structure

Recommend a practical repository structure.

For example:

```text
src/
├── app/
├── components/
├── features/
│   ├── meals/
│   ├── weight/
│   ├── activity/
│   ├── sleep/
│   ├── stress/
│   ├── patterns/
│   ├── interventions/
│   ├── experiments/
│   ├── shabbat/
│   ├── coach/
│   └── profile/
├── lib/
│   ├── supabase/
│   ├── ai/
│   ├── analytics/
│   └── notifications/
├── domain/
├── hooks/
├── styles/
└── i18n/
```

Do not blindly use this exact structure.

Explain the recommended structure and why.

---

# 40. Architecture Boundaries

Clearly define boundaries between:

```text
UI
 ↓
Application Logic
 ↓
Domain Logic
 ↓
Data Access
 ↓
External Services
```

External services should be hidden behind abstractions.

Examples:

```text
AIProvider
StorageProvider
NotificationProvider
ActivityDataSource
```

This makes future migration possible.

---

# 41. Cost Strategy

The user wants to keep Phase 1 as close to $0 as reasonably possible.

Main cost risks:

1. AI
2. image processing
3. voice transcription
4. storage
5. analytics at scale

The document should identify:

- free tiers
- likely cost drivers
- usage limits
- cost guardrails

Do not assume free tiers remain unchanged forever.

If current pricing is discussed, verify with official sources.

---

# 42. What NOT to Build in Phase 1

Explicitly list technologies/architecture that should NOT be introduced unless a real requirement appears.

Examples:

```text
Kubernetes
Microservices
Kafka
RabbitMQ
AWS Lambda for every endpoint
API Gateway everywhere
DynamoDB
SQS
EventBridge
Cognito
Redis
Elasticsearch
Complex event sourcing
Complex CQRS
Native mobile app
HealthKit integration
Google Health Connect
Complex recommendation ML
Custom ML models
Large UI framework
```

The goal is:

> Simple first. Add complexity only when justified by evidence.

---

# 43. Future Scale Path

Show how the architecture can evolve:

```text
Phase 1
1 user
↓
Next.js
Supabase
AI Gateway
PostHog
Manual data
↓
Phase 2
5–50 users
↓
Better caching
Background jobs if needed
AI cost optimization
More analytics
Automatic activity integrations
↓
Later
Large user base
↓
Only then evaluate:
queues
workers
service separation
dedicated infrastructure
etc.
```

Do not prematurely implement future infrastructure.

---

# 44. Architecture Decision Records

At the end of the document include an ADR-style table:

| Decision      | Choice               | Why                            | Revisit when                           |
| ------------- | -------------------- | ------------------------------ | -------------------------------------- |
| Frontend      | Next.js              | React + routing + SSR/PWA path | Product scale requires different model |
| Language      | TypeScript           | Safety and maintainability     | —                                      |
| Backend       | Modular Monolith     | Simple Phase 1                 | Real scaling pressure                  |
| Database      | Supabase/Postgres    | Low operational overhead       | Scale/cost requirement                 |
| Auth          | Supabase Auth        | Integrated                     | Requirements change                    |
| Storage       | Supabase Storage     | Simple                         | Cost/scale                             |
| AI            | Provider abstraction | Avoid lock-in                  | —                                      |
| Activity      | Manual               | Phase 1 simplicity             | Automatic data needed                  |
| Notifications | Web Push             | Web-first                      | Native app                             |
| Analytics     | PostHog              | Product experimentation        | Scale/privacy requirements             |
| UI            | Own Design System    | Control and simplicity         | —                                      |

---

# 45. Final Recommendation

The document must end with a clear technical recommendation.

The recommendation should answer:

1. What stack should we use?
2. Why?
3. What should we NOT use?
4. What should be abstracted?
5. What should remain simple?
6. What can be added later?
7. What are the main technical risks?

The expected high-level direction is:

```text
Next.js
+ TypeScript
+ React
+ CSS / CSS Modules
+ Own Design System
+ Supabase
+ PostgreSQL
+ Supabase Auth
+ Supabase Storage
+ AI Gateway
+ AI Provider
+ PostHog
+ Web Push / PWA-ready
```

with:

```text
Modular Monolith
        +
Simple Domain Model
        +
Provider Abstractions
        +
Manual Phase-1 Data
        +
Minimal Infrastructure
```

---

# 46. Important Research Requirement

Before making claims about current:

- Next.js capabilities
- Supabase features/pricing
- Vercel pricing
- Gemini capabilities/pricing
- OpenAI capabilities/pricing
- Anthropic capabilities/pricing
- PostHog pricing
- Web Push
- iOS/iPadOS PWA notifications
- Apple Health / HealthKit
- Google Health Connect

perform current Web Research.

Prefer official documentation and official pricing pages.

For each current external claim:

- cite the source
- include the date checked
- distinguish documented facts from recommendations

Do not rely on outdated knowledge.

---

# 47. Output Requirements

Return a complete Markdown document.

Do not return a short summary.

Do not skip technical decisions.

Do not over-engineer.

The final document should be understandable to:

- product owner
- frontend developer
- backend developer
- AI developer
- future technical reviewer

It should be detailed enough that a developer can use it as the technical foundation for Phase 1.

The final architecture should optimize for:

```text
Simplicity
+
Low Cost
+
Fast Development
+
Security
+
Modularity
+
Future Migration
```

not for theoretical maximum scale.

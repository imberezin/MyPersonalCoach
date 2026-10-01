# Personal Eating Coach

# Screen Design Specification

**Phase:** 1 — Personal Experiment
**Status:** Product / UX Design
**Document type:** Detailed Screen & Screen Group Specification
**Last updated:** 2026-10-01 — decisions from `Technology Stack.md` and `INTERVENTIONS.md` are incorporated. Where this document and those two documents differ, they win.

---

# 1. Purpose of This Document

This document defines the detailed behavior and structure of the application's screens.

It sits below the Product Specification and UX & Flows Specification.

```text
Product Specification
        ↓
UX & Flows Specification
        ↓
Screen Specification
        ↓
Detailed Screen Design  ← THIS DOCUMENT
        ↓
Implementation
```

The purpose of this document is to define, for every screen or related group of screens:

- Why the screen exists
- When the user sees it
- What the user sees
- What the user can do
- What the system does
- What happens after each action
- Loading states
- Empty states
- Error states
- Important edge cases
- Relationships between related screens

This document does **not** define:

- Colors
- Typography
- CSS
- Pixel-perfect dimensions
- Final illustrations
- Final branding
- Technical implementation details

Those decisions belong to the Design System and implementation stages.

---

# 2. Core Screen Design Principles

## 2.1 Every screen needs a reason

A screen should exist only if it helps the user:

- understand something
- decide something
- report something
- take an action
- recover
- learn

If nothing useful needs to happen, the system should be comfortable showing less.

---

## 2.2 One primary action

Each screen should normally have:

- one primary action
- optionally one or more secondary actions

The user should not need to understand the entire application before knowing what to do next.

---

## 2.3 User reports, system organizes

The user should provide information naturally.

The system should perform the organizational work.

```text
User
 ↓
Photo / Text / Voice / Simple choice
 ↓
System understanding
 ↓
Structured information
 ↓
User confirmation
```

The system should not force the user to fill forms when the same information can be inferred safely.

---

## 2.4 The user remains in control

The system may:

- suggest
- summarize
- identify patterns
- propose experiments
- ask questions

The system must not:

- pretend certainty where there is uncertainty
- invent missing information
- force an intervention
- punish the user
- make the user feel monitored

---

## 2.5 Observation ≠ Pattern

A single observation is not a confirmed pattern.

Early:

> "משהו קטן ששמתי לב אליו..."

Later:

> "שמנו לב שזה קורה אצלך לעיתים קרובות..."

Patterns should be based on sufficient supporting data and, when appropriate, user confirmation.

---

## 2.6 No shame

Avoid:

- failed
- ruined
- bad user
- missed target
- punishment
- compensation
- "start over"

Prefer:

- noticed
- learned
- tried
- returned
- continued
- this was difficult
- let's understand what happened

---

## 2.7 Silence is a valid system state

The application does not need to create an intervention every time the user opens the app.

Possible Home state:

> "הכול בסדר. אין כרגע משהו שאני חושב שכדאי להוסיף."

Doing nothing can be the correct behavior.

---

## 2.8 Offline periods are first-class

Shabbat and future offline periods are not missing data.

They are intentional periods where:

- reporting stops
- notifications stop
- reminders stop
- streak penalties stop
- adherence calculations exclude the period

---

## 2.9 The farther the user is from the event, the freer the report

```text
Immediately after event
        ↓
Short / specific report

Later
        ↓
Freer report

Much later
        ↓
Aggregated report
        ↓
System performs more organization
```

This principle is especially important for:

- Shabbat
- holidays
- vacations
- long offline periods

---

# 3. Screen Anatomy Standard

Every detailed screen in this document should contain the following sections.

```text
Purpose
Entry
User sees
Primary action
Secondary actions
System behavior
Next state
Loading
Empty / Unknown
Error
Important edge cases
```

Not every screen needs every section visually, but the behavior must be defined.

---

# 4. SCREEN GROUP A — ONBOARDING

The onboarding should establish enough context for useful personalization without becoming a questionnaire.

The user should feel:

> "This is simple. I can just start."

---

## A1. Welcome

### Purpose

Introduce the product philosophy.

### Entry

New user after account creation / first launch.

### User sees

```text
┌─────────────────────────────┐
│                             │
│       בוא נבין יחד          │
│       איך אתה אוכל          │
│                             │
│ לא דיאטה.                   │
│ לא איסורים.                 │
│                             │
│ פשוט להבין מה עוזר לך       │
│ לאכול ולהרגיש טוב יותר.     │
│                             │
│        [ בוא נתחיל ]        │
└─────────────────────────────┘
```

### Primary action

בוא נתחיל

### System behavior

Start onboarding.

---

# A2. Goal

### Purpose

Understand the user's primary motivation.

### User sees

```text
מה היית רוצה לשפר?

☐ לרדת במשקל
☐ להרגיש קל ובריא יותר
☐ לשפר את האכילה שלי
☐ להיות יותר פעיל
☐ להבין למה אני אוכל יותר מדי
☐ אני עדיין לא בטוח
```

Multiple selections may be allowed.

### Important rule

The user does not need to define a perfect goal.

"אני עדיין לא בטוח" is valid.

---

# A3. Weight

### Purpose

Establish baseline information when relevant.

### User sees

```text
מה המשקל שלך היום?

[ 120 ] ק"ג

[ המשך ]
```

### Important rules

- Weight is not presented as a judgment.
- This becomes the starting point.
- Daily weighing is not required.
- Product default is weekly weighing.

---

# A4. Goal Weight

### Purpose

Capture a target if the user wants one.

### User sees

```text
יש לך משקל שאליו היית רוצה להגיע?

[ 99 ] ק"ג

או

[ אני לא רוצה להגדיר יעד מספרי ]
```

### Important rule

A user can choose a behavioral goal instead of a numeric goal.

---

# A5. Age + Height

### Purpose

Collect baseline information needed for personalization and internal calculations.

### User sees

```text
כמה פרטים כדי שאכיר אותך קצת יותר

גיל
[    ]

גובה
[    ] ס"מ

[ המשך ]
```

---

# A6. Activity Baseline

### Purpose

Understand current movement level.

### User sees

```text
איך נראית התנועה שלך בדרך כלל?

○ כמעט לא פעיל
○ קצת הליכה
○ פעיל חלק מהשבוע
○ פעיל רוב השבוע
○ משתנה מאוד
```

### Important rule

Do not immediately present the 60-minute target as a demand.

The long-term target is:

> 60 minutes of movement per day

Progression happens gradually.

---

# A7. Food Preferences

### Purpose

Capture useful food context.

### User sees

```text
יש דברים שכדאי שאדע על האוכל שלך?

אוכל שאני אוהב:
[ ... ]

אוכל שאני לא אוהב:
[ ... ]

סגנון אוכל / דברים שחשוב לי לשמור:
[ ... ]
```

This screen should remain lightweight.

The system learns more over time.

---

# A8. Kashrut

### Purpose

Understand kosher constraints.

### User sees

```text
יש מגבלות או העדפות תזונתיות שחשוב לי להכיר?

☐ כשרות
☐ בשר / חלב
☐ העדפות אחרות

[ המשך ]
```

### Important rule

The application must not invent Halachic rulings.

Complex Halachic questions should be referred to an appropriate authority.

Nutrition data and Kashrut metadata should remain separate conceptually.

---

# A9. Shabbat / Offline Period

### Purpose

Understand periods where the user will not use technology.

### User sees

```text
יש זמנים שבהם אתה לא משתמש בטלפון?

☐ שבת
☐ זמנים אחרים
☐ לא

[ המשך ]
```

For Shabbat, the system configures an `OfflinePeriod`.

When Shabbat is selected, ask for the user's city. Shabbat times are computed from the location (see K6). The candle-lighting minutes get a default for that place and can be changed in settings.

---

# A10. Motivation

### Purpose

Understand why the user cares.

### User sees

```text
למה חשוב לך לעשות את השינוי הזה?

אפשר לכתוב כמה מילים.
אפשר גם לדלג.

[ __________________ ]

[ המשך ]
```

This is optional.

The motivation can later be used gently.

---

# A11. Notifications

### Purpose

Ask for notification preference.

### User sees

```text
איך תרצה שאהיה איתך בקשר?

☐ תזכורות לדיווח
☐ הצעות מהמאמן
☐ סיכום שבועי
☐ שקילה שבועית

[ המשך ]
```

The system should not assume that every notification type is wanted.

The product has five notification types: Coach, meal reporting, activity, weekly weigh-in, weekly summary (see K8). Onboarding asks only about the types shown above. The rest, and quiet hours, live in settings.

**iPhone:** notifications require the app to be installed to the Home Screen first. Show an "Add to Home Screen" step before asking for permission, and request permission only after the user taps.

---

# A12. Onboarding Complete

### Purpose

Transition into First Week.

### User sees

```text
אנחנו מוכנים.

מעכשיו לא צריך לעשות הרבה.

פשוט תספר לי מה קורה,
ואני אתחיל ללמוד מה עוזר לך.

[ בוא נתחיל ]
```

### System behavior

```text
ONBOARDING_COMPLETE
        ↓
FIRST_WEEK_STARTED
        ↓
HOME
```

---

# 5. SCREEN GROUP B — FIRST WEEK

The First Week is a special product mode.

It is not a performance test.

Its goal is:

> Build familiarity, trust and early usefulness.

---

# B1. First Week Start

### Purpose

Explain the first-week philosophy.

### User sees

```text
השבוע הראשון שלנו

השבוע לא צריך להוכיח כלום.

אני רוצה פשוט להכיר אותך:
איך אתה אוכל,
מתי קשה,
מה עוזר,
ומה קורה ביום רגיל.

[ בוא נתחיל ]
```

### Important rule

Do not show:

- score
- completion percentage
- missed days
- target compliance

---

# B2. First Report

This uses the standard Report flow.

After the first meaningful report:

```text
קיבלתי.

כבר התחלתי להבין קצת
איך אתה אוכל.

לא צריך לעשות יותר עכשיו.
```

The feedback should be immediate.

---

# B3. First Week Early Feedback

### Purpose

Reward meaningful actions.

Possible events:

- meal reported
- activity reported
- weight reported
- sleep reported
- stress reported
- difficult moment shared
- intervention attempted
- recovery after difficult day

Example:

```text
✓ דיווח ראשון נשמר

זה כבר מידע שעוזר לי
להכיר אותך.
```

No points are required to be shown.

Internal events may exist, but the user should not experience the product as a scorecard.

---

# B4. Early Signal

### Purpose

Surface a possible observation without claiming a pattern.

### Example

```text
💡 משהו קטן ששמתי לב אליו

בכמה מהערבים שדיווחת על אוכל,
ציינת גם עייפות.

עדיין מוקדם לדעת אם זה באמת
דפוס אצלך.

נמשיך לראות.

[ נשמע לי נכון ]
[ לא בטוח ]
[ לא קשור אליי ]
```

### System behavior

Store feedback.

Do not promote the observation to a confirmed pattern solely because the user selected "sounds right."

Evidence still matters. An Early Signal needs at least 2 occurrences; the thresholds for Candidate and Validated patterns are in F5.

---

# B5. First Small Experiment

### Purpose

Introduce the intervention model.

Example:

```text
שמתי לב שלפעמים אתה מגיע
לאוכל כשאתה כבר מאוד רעב.

רוצה לנסות משהו קטן?

בפעם הבאה שזה קורה,
עצור לרגע ושאל:

"אני רעב, או פשוט עייף?"

[ אנסה ]
[ לא הפעם ]
```

Only one small experiment should be active at a time.

---

# B6. First Week Summary

### Purpose

Transition from First Week to normal weekly learning.

### User sees

```text
כבר הכרנו קצת.

אני מתחיל להבין מה קורה אצלך.

### מה עשית

✓ דיווחת על ארוחות
✓ ניסית משהו חדש
✓ חזרת גם אחרי יום קשה

### מה שמנו לב אליו

💡 בערבים שבהם היית עייף,
דיווחת לעיתים קרובות יותר על רעב.

עדיין נמשיך לבדוק את זה.

### רגע משמעותי

זיהית פעם אחת שאתה רעב
ולא רק עייף.

### ומה עכשיו?

נבחר דבר קטן אחד לשבוע הבא.

[ בוא נבחר ]
[ נמשיך פשוט לעקוב ]
```

### Important rule

Do not say:

> "סיימת בהצלחה את השבוע הראשון."

Instead:

> "כבר הכרנו קצת."

---

# 6. FIRST WEEK TRANSITION LOGIC

The First Week does not necessarily end after exactly seven calendar days.

Suggested rules:

```text
Minimum:
5 available days

Maximum:
15 available days

Available day:
a day with less than 50% of its time
covered by an OfflinePeriod

Offline periods:
excluded

Enough meaningful data before 15 days
(at least 5 available days AND
at least 10 confirmed meals):
→ transition to normal weekly cycle

Insufficient data at 15 available days:
→ transition anyway
→ no failure language
→ summarize what is known
```

The First Week is an internal state.

The user does not need to see:

> "Day 9 of 15"

---

# 7. SCREEN GROUP C — MAIN NAVIGATION

Bottom navigation:

```text
Home | Progress | Report | Coach | Me
```

---

# C1. Home

Purpose:

> What is useful for me right now?

Home is contextual, not a dashboard.

It may contain:

- one relevant action
- insight
- encouragement
- recent event
- small experiment
- recovery support
- nothing

---

# C2. Progress

Purpose:

> What has changed in me?

Progress contains:

- weight trend
- milestones
- behavior changes
- activity
- learned patterns
- experiments

It should not be a daily score.

---

# C3. Report

The central action.

It opens a Bottom Sheet.

```text
┌─────────────────────────────┐
│       מה תרצה לדווח?        │
│                             │
│ 🍽️ אוכל                     │
│ 🚶 פעילות                   │
│ ⚖️ משקל                     │
│ 😴 שינה                     │
│ 🧠 איך אתה מרגיש?           │
│                             │
│ או פשוט:                    │
│ 📷 צילום  ✍️ כתיבה 🎙️ דיבור │
└─────────────────────────────┘
```

The user can select a category or simply provide raw input.

---

# C4. Coach

Purpose:

> Let the user proactively talk to the system.

Main options:

```text
דבר איתי
מה למדנו עליך
הניסוי השבועי
השיחות שלנו
```

Quick topics:

```text
אוכל
הליכה
שינה
מתח ורעב
התקדמות
משהו אחר
```

---

# C5. Me

Profile and settings.

```text
אני
├── פרטים אישיים
├── המטרה שלי
├── העדפות אוכל
├── פעילות
├── שבת
├── התראות
├── שפה
└── פרטיות
```

---

# 8. SCREEN GROUP D — FOOD REPORTING

This is one of the most important screen groups.

Core principle:

> The user reports naturally. The system structures the information.

---

# D1. Input Selection

User can choose:

```text
📷 צילום
✍️ כתיבה
🎙️ דיבור
```

Voice is delivered after the core loop (see D4). Until then the Report sheet shows photo and text only.

Or category:

```text
🍽️ אוכל
```

---

# D2. Photo Input

### User sees

```text
צלם מה שאכלת

[ camera / image ]

[ שלח ]
```

The user may optionally add text.

---

# D3. Text Input

Example:

```text
מה אכלת?

[ אכלתי שתי פרוסות לחם
  עם גבינה וקפה ]

[ שמור ]
```

Natural language is preferred.

No form required.

---

# D4. Voice Input

```text
🎙️ ספר לי מה אכלת

[ הקלט ]

לדוגמה:
"אכלתי עכשיו פיצה,
בערך שלושה משולשים
וקולה זירו"
```

Voice is transcribed and interpreted.

**Delivery order:** voice is not part of the core loop. It is added after the core loop and before Shabbat reporting. The device records the audio and the server transcribes it, because browser dictation is not available in apps installed to the iPhone Home Screen.

---

# D5. AI Processing

This is a transient state.

```text
מנסה להבין מה אכלת...
```

The system should not expose unnecessary technical details.

---

# D6. Meal Confirmation

### User sees

```text
זה מה שהבנתי:

🍗 שניצל — מנה בינונית
🍚 אורז — בערך כוס
🥗 סלט
🥤 קולה זירו

[ משהו לא נכון? תיקון ]

[ ✓ שמור ]
```

### Rules

- AI may express uncertainty.
- AI must not invent food.
- Portion estimates are estimates.
- Calories are not shown by default.
- User can correct before saving.

---

# D7. Edit Meal

The user can modify:

- food
- portion
- meal type
- time

Example:

```text
עריכת הארוחה

שניצל
[ מנה בינונית ▼ ]

אורז
[ בערך כוס ▼ ]

סלט
[ קיים ]

[ ביטול ]
[ שמור שינוי ]
```

After editing:

```text
Edit
 ↓
Confirmation
```

---

# D8. Meal Saved

Short confirmation:

```text
✓ נשמר

הארוחה נוספה.

[ חזרה ]
```

Optional contextual question:

```text
איך הרגשת אחרי הארוחה?

רעב ←────────→ שבע
```

This should not always appear.

The system decides when context is useful.

---

# 9. SCREEN GROUP E — OTHER REPORTING

---

# E1. Activity

Manual reporting in Phase 1.

```text
כמה זזת היום?

[ 20 ] דקות

מה עשית?

○ הליכה
○ אימון
○ אחר

[ שמור ]
```

Long-term progression:

```text
Week 1 — baseline
Week 2 — 15 min/day
Week 3 — 20
Week 4 — 25
Weeks 5–6 — 30
Weeks 7–8 — 40
Weeks 9–10 — 50
Weeks 11–12 — 60
```

The user can split movement into several sessions.

---

# E2. Weight

Default behavior:

```text
השקילה השבועית

מה המשקל שלך?

[ 118.7 ] ק"ג

[ שמור ]
```

The system should not encourage daily weighing.

---

# E3. Sleep

Manual reporting.

Example:

```text
איך ישנת?

שעות שינה:
[ 6.5 ]

איך הרגשת כשקמת?
😫  😐  🙂  😄

[ שמור ]
```

No rigid 8-hour requirement.

The goal is learning relationships.

---

# E4. Stress

Very simple:

```text
איך אתה מרגיש מבחינת מתח?

1 — רגוע
2
3
4
5 — מאוד לחוץ
```

Optional.

After choosing a level, the user can add an optional note (text or voice). Free text or voice is always a valid way to report stress, without choosing a number.

Do not create a questionnaire.

---

# 10. SCREEN GROUP F — BEHAVIORAL SUPPORT

---

# F1. Difficult Moment

Entry may come from:

- Home
- Coach
- intervention
- user report
- contextual detection

Opening:

```text
אני איתך.

מה קורה עכשיו?

[ 🔥 אני ממש רעב ]
[ 😣 אני בלחץ ]
[ 😴 אני עייף ]
[ 🍕 פשוט מתחשק לי משהו ]
[ 🤷 אני לא יודע ]
[ פשוט לדבר איתי ]
```

---

# F2. Context

The system tries to understand what is happening.

Possible contexts:

```text
True hunger
Stress
Fatigue
Craving
Social context
Environment
Habit
Unclear
```

The system should not assume certainty.

---

# F3. Intervention

Controlled intervention library.

Possible interventions:

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

*Note (2026-10-01): "Next Bite" was merged into "Slow Down" as a variant, so the library has 11 interventions. Full definitions: `INTERVENTIONS.md`.*

**Who decides:** the Behavior Engine selects the intervention and its approved variant. The AI may only personalize the wording. It may not change the action, scope or safety constraints, and may not add advice.

The system can also choose to ask a short question (`ASK`) or to do nothing (`DO_NOTHING`). Doing nothing is always allowed.

**Budget:** at most one proactive intervention per day. An intervention the user starts (for example the "I'm really hungry" button, or a Coach conversation) is not counted.

**True hunger:** before eating, or when the eating phase is unknown, true hunger gets no intervention. The system says it is fine to eat and invites a report.

**Repeats:** if an intervention gets "not really" twice in a row in the same context, it is not offered again in that context for 14 days.

---

# F4. Intervention Outcome

After the action:

```text
איך זה עזר?

[ 👍 ממש עזר ]
[ קצת עזר ]
[ לא ממש ]
[ לא יודע ]
```

Only when the intervention was around eating, a second optional question:

```text
אכלת בסוף?

[ כן ]  [ לא ]  [ לא יודע ]
```

Two separate fields are stored: `helpfulness` (`HELPFUL`, `SOMEWHAT`, `NOT_REALLY`, `UNKNOWN`) and `continued_eating` (`YES`, `NO`, `UNKNOWN`). The second question can be skipped, and its default is `UNKNOWN`.

Eating after an intervention is not a failure. Learning reads `helpfulness`; `continued_eating` is context only.

A short question (`ASK`, level 1) does not get an outcome question.

This outcome is important learning data.

---

# F5. Pattern Candidate

After repeated evidence:

```text
שמתי לב למשהו שחוזר אצלך.

לפעמים סביב 17:00,
אחרי יום עבודה ארוך,
אתה מגיע מאוד רעב.

רוצה לבדוק אם זה באמת מתאים לך?

[ כן ]
[ לא בטוח ]
[ לא ]
```

The system should not call this a confirmed pattern until sufficient evidence exists.

**Evidence thresholds** (tunable constants):

```text
Early Signal    2 occurrences
Candidate       3 occurrences on different days
Validated       5 occurrences over at least two weeks,
                or a Candidate the user confirms with "yes"
                and at least 3 occurrences
```

User confirmation alone is never sufficient.

---

# 11. SCREEN GROUP G — BAD DAY / RECOVERY

---

# G1. Difficult Day

```text
היום היה קצת קשה.

רוצה לדבר על זה?

[ כן, בוא נבין מה קרה ]
[ לא עכשיו ]
```

---

# G2. Trigger

```text
מה לדעתך קרה?

[ אכלתי יותר ממה שרציתי ]
[ הייתי רעב מאוד ]
[ הייתי בלחץ ]
[ הייתי עייף ]
[ זה היה בגלל הסביבה ]
[ לא יודע ]
[ משהו אחר ]
```

---

# G3. Recovery

If user says:

> "הרסתי את היום."

The system should respond without punishment.

Possible action:

```text
מה יעזור לך עכשיו?

[ פשוט להמשיך כרגיל ]
[ לצאת להליכה ]
[ להבין מה הפעיל אותי ]
[ לדבר על זה ]
[ כלום כרגע ]
```

No:

- compensation
- skipping meals
- punishment
- "start over"

---

# G4. Return After Difficult Day

When the user returns:

```text
✓ חזרת.

זה בדיוק מה שחשוב.

ממשיכים מכאן.
```

This is a significant positive event.

---

# 12. SCREEN GROUP H — WEEKLY LEARNING

---

# H1. "השבוע שלך"

This is the weekly motivational/learning bridge.

It is not a dashboard.

Flow:

```text
End of week
 ↓
Collect data
 ↓
Find meaningful events
 ↓
Choose weekly story
 ↓
Reinforce / learn
 ↓
Identify pattern
 ↓
Choose next step
 ↓
ONE experiment
```

**Timing:** the weekly summary appears after the Motzei Shabbat report is confirmed. If the user skips that report, it appears on Sunday morning.

---

# H2. Weekly Opening Modes

The system chooses one:

```text
Celebrate
Learn
Recover
Reset
```

"Reset" means insufficient meaningful information, not failure.

---

# H3. Weekly Summary

Example:

```text
השבוע שלך

### מה היה משמעותי

✓ דיווחת על 8 ארוחות
✓ הלכת 3 פעמים
✓ חזרת אחרי יום קשה

### מה למדנו

בערבים שבהם ישנת מעט,
היית רעב יותר.

### מה השתנה

המשקל הוא חלק מהתמונה,
אבל גם ההתנהגות השתנתה.

### הצעד הבא

רוצה לנסות השבוע משהו קטן?

[ כן ]
[ לא הפעם ]
```

No weekly score.

---

# H4. Weekly Experiment

Only one active experiment.

Example:

```text
הניסוי שלך לשבוע

בימים שבהם אתה מגיע רעב מאוד
בערב:

לפני שאתה מתחיל לאכול,
עצור ל-10 שניות ובדוק
כמה אתה רעב.

[ אנסה ]
```

---

# H5. Experiment Result

```text
איך היה הניסוי?

[ ממש עזר ]
[ קצת עזר ]
[ לא ממש ]
[ לא יודע ]
[ לא יצא לי לנסות ]
```

Stored as `helpfulness` (`HELPFUL`, `SOMEWHAT`, `NOT_REALLY`, `UNKNOWN`) plus `tried` (`YES` / `NO`; "didn't get to try" is `tried = NO`). Experiments are measured by usefulness, never by compliance.

This becomes learning data.

---

# 13. SCREEN GROUP I — PROGRESS

Purpose:

> What has changed in me?

---

# I1. Progress Overview

Structure:

```text
איפה אני?
        ↓
מה השתנה?
        ↓
מה למדנו?
        ↓
מה הצעד הבא?
```

---

# I2. Weight Trend

Weekly measurements.

```text
120
 ↓
118.7
 ↓
117.9
 ↓
...
```

Show trend rather than daily fluctuations.

Optional ranges:

- 7 days
- 30 days
- 90 days

---

# I3. Milestones

Milestones are computed from the user's starting weight and goal weight: one every 5 kg from the starting weight toward the goal, and the last one is the goal itself. A step that would land less than 2.5 kg from the goal is skipped, so 120 to 99 gives 120, 115, 110, 105, 99. Without a numeric goal there are no weight milestones.

Example (starting weight 120 kg, goal 99 kg):

```text
120 kg
  ●
115 kg
  ○
110 kg
  ○
105 kg
  ○
 99 kg
  ○
```

Milestones are motivational landmarks, not pass/fail levels.

---

# I4. Behavior Progress

Possible areas:

```text
Food reporting
Walking
Sleep
Stress
Recovery
Mindful choices
```

Do not collapse everything into a single score.

---

# I5. Learned Patterns

```text
מה למדנו עליך?

✓ עייפות בערב קשורה אצלך
  לעיתים לרעב גבוה

✓ אחרי הליכה קצרה אתה מדווח
  לעיתים על תחושת שליטה טובה יותר
```

Patterns should show evidence/context where appropriate.

---

# I6. Plateau

If weight does not change:

```text
המשקל כמעט לא השתנה לאחרונה.

אבל משהו אחר כן:

✓ אתה מדווח יותר
✓ אתה הולך יותר
✓ אתה מזהה רעב מוקדם יותר

נמשיך לראות מה קורה.
```

The system should not automatically recommend aggressive restriction.

---

# 14. SCREEN GROUP J — SHABBAT / OFFLINE

---

# J1. Shabbat Approaching

```text
┌─────────────────────────────┐
│       🕯️ שבת מתקרבת         │
│       עוד 52 דקות            │
│                             │
│ עכשיו לא צריך לעשות הרבה.  │
│ רק נבחר דבר קטן אחד        │
│ שנרצה לשים לב אליו בשבת.  │
│                             │
│ [ בוא נבחר ]                │
│ [ לא הפעם ]                 │
└─────────────────────────────┘
```

---

# J2. Choose Small Experiment

Show one or two relevant options.

Example:

```text
השבת אפשר לשים לב לדבר קטן:

○ לעצור רגע לפני מנה שנייה
○ לשים לב מתי אני באמת רעב

[ בחרתי ]
[ בלי ניסוי הפעם ]
```

If no personal pattern exists, show limited generic choices.

---

# J3. Shabbat Start

```text
שבת שלום 🕯️

האפליקציה תהיה שקטה עכשיו.

אין צורך לדווח.
אין תזכורות.
אין מעקב.

נתראה במוצאי שבת.
```

---

# J4. Shabbat Offline State

Internally:

```text
OfflinePeriod
type = SHABBAT
start = ...
end = ...
```

During this period:

```text
notifications = OFF
reminders = OFF
streak penalties = OFF
meal reporting = OFF
interventions = OFF
daily goals = PAUSED
adherence calculations = EXCLUDED
```

The application must not treat this period as missing behavior.

---

# J5. Motzei Shabbat Welcome

```text
🌙 ברוך הבא.

איך הייתה השבת?

[ 🙂 היה לי טוב ]
[ 😐 אכלתי יותר ממה שרציתי ]
[ 😕 הרגשתי שאיבדתי שליטה ]
[ 🔥 הצלחתי לעשות שינוי שרציתי ]
```

This should be lightweight.

---

# J6. Aggregated Shabbat Report

The user does NOT report every meal separately.

Instead:

```text
איך הייתה השבת?

ספר לי בקצרה מה אכלת ומה קרה.

אפשר לכתוב.
אפשר לדבר.
אפשר גם להוסיף תמונות.

[ _______________________ ]

[ 🎙️ דבר ]
[ 📷 הוסף תמונה ]

[ המשך ]
```

---

# J7. AI Shabbat Organization

The system parses the free-form report into expected events.

Example:

```text
ליל שבת
────────────
🍗 שניצל
🍚 אורז
🥗 סלט
🍷 יין

שבת בבוקר
────────────
☕ קפה
🍰 עוגה

קידוש
────────────
🍷 יין
🍰 עוגה

ארוחת שבת
────────────
...
```

The expected schedule comes from the user's known Shabbat structure where available.

---

# J8. Missing Information

If AI does not understand an event:

```text
ליל שבת
────────────

לא הצלחתי להבין מה אכלת.

[ ✎ הוספה ]
```

The system must not invent the missing meal.

---

# J9. Confirm Shabbat Data

The user reviews the organized timeline.

Only after confirmation:

```text
rawInput
   ↓
aiUnderstanding
   ↓
user review / correction
   ↓
confirmedMeal
```

Only confirmed information becomes official MealEntries.

---

# 15. SCREEN GROUP K — PROFILE & SETTINGS

---

# K1. Me

```text
אני

ישראל

המטרה שלי
להרגיש טוב יותר ולרדת בהדרגה
לכיוון 99 ק"ג

[ עריכה ]

ההעדפות שלי
🍽️ אוכל
🚶 פעילות
🕯️ שבת

הנתונים שלי
⚖️ משקל
📊 ההתקדמות שלי

הגדרות
שפה
התראות
פרטיות
```

---

# K2. Personal Details

- Name
- Age
- Height
- Starting weight
- Goal weight

---

# K3. Goal

Allow:

- numeric weight goal
- behavior goal
- no fixed goal

---

# K4. Food Preferences

- likes
- dislikes
- food style
- dietary preferences
- kosher information

The system should learn rather than require a large initial questionnaire.

---

# K5. Activity Preferences

Possible activities:

- walking
- exercise
- other movement

Long-term target remains 60 minutes/day.

---

# K6. Shabbat Settings

Allow:

- Shabbat schedule
- Offline periods
- notification behavior
- future custom offline periods

Shabbat times are computed from the user's location. Settings include the city and the candle-lighting minutes. The default depends on the place (for example Jerusalem 40, Haifa 30, elsewhere in Israel 20, outside Israel 18), and the user confirms the value.

Generic architecture:

```text
OfflinePeriod
├── SHABBAT
├── HOLIDAY
└── USER_DEFINED      (VACATION: a future type)
```

---

# K7. Language

Phase 1:

```text
עברית
English
```

The entire UI must support RTL/LTR.

---

# K8. Notifications

User controls:

- coach
- meal reporting
- activity
- weekly weigh-in
- weekly summary
- quiet hours

Notifications are Web Push. On iPhone they require installing the app to the Home Screen first (see A11).

The system may still suppress notifications because of:

- Shabbat
- quiet hours
- no meaningful intervention
- user preferences

---

# K9. Privacy

Allow:

- data visibility
- photo retention preferences
- export
- delete account/data

Raw food photos should not be retained unnecessarily.

Food photos are not kept. They are deleted when the meal is confirmed or discarded, and a single photo is not stored at all. Export is in an open format (JSON).

---

# 16. SCREEN GROUP L — MOTIVATION & ENGAGEMENT

---

# L1. Personal Activity Feed

A lightweight behavioral feed.

Example:

```text
08:30
🍽️ דיווחת על ארוחת בוקר

13:15
🍽️ בחרת מנה רגילה

18:40
🚶 הלכת 12 דקות

20:10
🧠 זיהית שאתה עייף ולא רעב
```

The feed should celebrate behavior, not only weight.

**Placement (2026-10-01):** the feed is integrated into Home. It is not a separate screen and not a social feed.

---

# L2. Achievements

Possible achievements:

```text
דיווח ראשון
שבוע ראשון
חזרת אחרי יום קשה
ניסית ניסוי
זיהית דפוס
הגעת לאבן דרך
```

Do not make achievements punitive.

**Placement (2026-10-01):** achievements are contextual only. They appear inside existing screens (for example Home and Progress) when relevant. There is no separate achievements or trophy section in Phase 1.

---

# L3. Streaks

Streaks may be used carefully.

Rules:

- based on meaningful behavior
- Shabbat does not break streak
- grace/freeze can exist
- one bad day should not erase everything
- streaks should not become the primary product objective

---

# 17. SCREEN GROUP M — NOTIFICATIONS

Notifications should not be treated as a separate product experience.

They are an extension of the Behavior Engine.

Possible notification:

```text
שמתי לב שבדרך כלל בשעה הזאת
קצת יותר קשה לך.

רוצה לנסות משהו קטן?
```

But only if there is a meaningful reason.

---

## Notification levels

```text
0 — Nothing                (DO_NOTHING)
1 — Short question         (ASK: a short question or invitation, no action)
2 — Small suggestion       (a small action the user may choose to do)
3 — Guided action          (a short action with several steps, a timer or a return prompt)
```

Initial proactive intervention budget:

> Maximum one proactive intervention per day, or less when appropriate. Interventions the user starts themselves are not counted.

---

# 18. HOME SCREEN STATES

Home is state-driven.

Possible states:

```text
Morning
 ↓
After Meal Report
 ↓
Before Known Risk Context
 ↓
Good Day
 ↓
Difficult Day
 ↓
Evening
 ↓
Before Shabbat
 ↓
Motzei Shabbat
 ↓
Nothing Important / Silence
```

These are states, not a fixed sequence: the system shows the one that fits now. "Meal Confirmation" is a flow, not a Home state.

"Nothing Important / Silence" is a valid state. If there is nothing useful to say, do not invent an intervention.

The Home screen should not simply display the same dashboard every day.

---

# 19. COMPLETE FOOD FLOW

```text
HOME
  ↓
REPORT
  ↓
Choose Food
  ↓
Photo / Text / Voice
  ↓
AI Processing
  ↓
Meal Confirmation
  ├───────────────┐
  ↓               ↓
Save            Edit
  ↓               ↓
Saved ←──── Confirmation
  ↓
Optional Context
  ↓
HOME
```

---

# 20. COMPLETE FIRST WEEK FLOW

```text
ONBOARDING
    ↓
FIRST WEEK START
    ↓
HOME
    ↓
FIRST REPORT
    ↓
Immediate Feedback
    ↓
Observe
    ↓
Early Signal
    ↓
Small Experiment
    ↓
Outcome
    ↓
Continue
    ↓
Enough Data?
    ├── No → Continue First Week
    │
    └── Yes
          ↓
    FIRST WEEK SUMMARY
          ↓
    NORMAL WEEKLY CYCLE
```

Maximum:

> 15 available days

Minimum:

> 5 available days

Offline periods are excluded.

---

# 21. COMPLETE SHABBAT FLOW

```text
Normal Week
    ↓
Shabbat Approaching
    ↓
Choose Small Experiment
    ↓
Shabbat Start
    ↓
OFFLINE
    ↓
Shabbat Ends
    ↓
Motzei Shabbat Welcome
    ↓
Aggregated Free-form Report
    ↓
AI Organization
    ↓
Timeline Review
    ↓
Fill Missing Information
    ↓
Confirm
    ↓
MealEntries Created
    ↓
Learning
    ↓
Normal Flow
```

---

# 22. COMPLETE DIFFICULT MOMENT FLOW

```text
Context Detection
       ↓
Difficult Moment
       ↓
What is happening?
       ↓
Context
       ↓
ONE Intervention
       ↓
Outcome
       ↓
Learning
       ↓
Future Personalization
```

The system can choose:

```text
DO NOTHING
```

when no intervention is appropriate.

---

# 23. COMPLETE BAD DAY FLOW

```text
Difficult Day
      ↓
Talk?
 ├── No → Continue
 │
 └── Yes
       ↓
     Trigger
       ↓
     Context
       ↓
     Recovery Action
       ↓
     Return
       ↓
     Learn
```

---

# 24. COMPLETE WEEKLY FLOW

```text
End of Week
      ↓
Collect Available Data
      ↓
Exclude Offline Periods
      ↓
Find Meaningful Events
      ↓
Determine Weekly Story
      ↓
Celebrate / Learn / Recover / Reset
      ↓
Validated Pattern?
      ↓
Choose ONE Experiment
      ↓
Next Week
```

---

# 25. GLOBAL LOADING RULES

Loading states should communicate what is happening without exposing technical implementation.

Good:

```text
מנסה להבין מה אכלת...
```

Bad:

```text
Calling AI provider...
```

For long operations:

- show progress where meaningful
- allow cancellation where safe
- preserve user input

Never silently discard user input.

---

# 26. GLOBAL ERROR RULES

Errors should be recoverable.

Example:

```text
לא הצלחתי להבין את התמונה.

אפשר לנסות שוב,
או פשוט לכתוב מה אכלת.

[ נסה שוב ]
[ כתוב במקום ]
```

Never:

> "AI failed."

The user should always have a fallback where possible.

---

# 27. GLOBAL EMPTY STATES

Empty state should explain what can happen next.

Bad:

```text
אין נתונים.
```

Better:

```text
עדיין אין מספיק מידע כדי
להראות לך דפוס.

כשתספר לי עוד קצת,
נוכל להתחיל לראות מה חוזר אצלך.
```

---

# 28. GLOBAL UNKNOWN STATE

When information is unavailable:

```text
אני עדיין לא יודע.
```

The system should prefer uncertainty over invention.

---

# 29. AI BEHAVIOR ON SCREENS

AI is not the source of truth for:

- calculated nutrition
- weight calculations
- activity totals
- dates
- user history

AI may:

- interpret natural language
- interpret food photos
- summarize
- identify candidate patterns
- personalize the wording of interventions that the Behavior Engine selected from the controlled library (the AI does not choose the intervention and may not change its action)
- conduct coaching conversations

Architecture:

```text
User Data
    ↓
Behavior Engine
    ↓
Context
    ↓
Personal Pattern
    ↓
Intervention Library
    ↓
AI Coach
```

---

# 30. SCREEN-TO-SCREEN DATA PRINCIPLE

A screen should receive only the context it needs.

Example:

```text
Meal Report
    ↓
rawInput
    ↓
AI Understanding
    ↓
Meal Confirmation
    ↓
confirmedMeal
    ↓
Behavior Engine
```

Do not allow screens to independently reinterpret the same raw data in different ways.

---

# 31. DATA STATE PRINCIPLE

Important distinction:

```text
Raw
 ↓
Understood
 ↓
Confirmed
 ↓
Learned
```

Example:

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

Each state has different confidence.

---

# 32. SCREEN PRIORITY

When designing the actual UI, prioritize:

### P0 — Core Loop

```text
Onboarding
Home
Report
Food Input (text and photo)
Meal Confirmation
First Week
Weekly Learning
```

### P1 — Behavioral Support

```text
Difficult Moment
Intervention
Recovery
Progress
Voice Input (after the core loop, before Shabbat)
Shabbat
```

### P2 — Supporting Experience

```text
Coach
Achievements (contextual, inside existing screens)
Activity Feed (inside Home)
Advanced Settings
```

P2 should not delay the core experiment.

---

# 33. MVP SCREEN PRINCIPLE

If a feature can be represented by an existing screen state rather than creating a new screen, prefer the existing screen.

Examples:

Do not create:

```text
"Good Day Screen"
"Bad Day Screen"
"Walking Screen"
```

unless there is a strong UX reason.

Prefer:

```text
Home
  ↓
Contextual State
```

This keeps Phase 1 small.

---

# 34. DESIGN REVIEW CHECKLIST

Before approving any screen, ask:

### Purpose

- Why does this screen exist?
- Could the same information/action live in an existing screen?

### User

- Does the user know what to do?
- Is there one primary action?
- Is the user still in control?

### Information

- Are we showing only what is useful?
- Are we claiming more certainty than we have?
- Are we asking the user for information the system could organize itself?

### Emotion

- Could this screen create shame?
- Could it feel like a diet tracker?
- Does it reward returning after difficulty?

### Context

- Is this First Week?
- Is this Shabbat?
- Is this a difficult moment?
- Is this after a meal?
- Is this a normal day?

### AI

- What does AI know?
- What does AI not know?
- Can AI invent information here?
- What does the user confirm?

### Recovery

- What happens if the user does nothing?
- What happens if they leave?
- What happens if AI fails?
- What happens if the user comes back after a bad day?

---

# 35. FINAL PRODUCT SCREEN MAP

```text
PERSONAL EATING COACH
│
├── ONBOARDING
│   ├── Welcome
│   ├── Goal
│   ├── Weight
│   ├── Goal Weight
│   ├── Age / Height
│   ├── Activity
│   ├── Food Preferences
│   ├── Kashrut
│   ├── Shabbat
│   ├── Motivation
│   ├── Notifications
│   └── Complete
│
├── FIRST WEEK
│   ├── Start
│   ├── Immediate Feedback
│   ├── Early Signal
│   ├── Small Experiment
│   └── Summary
│
├── MAIN NAVIGATION
│   ├── Home
│   ├── Progress
│   ├── Report
│   ├── Coach
│   └── Me
│
├── REPORTING
│   ├── Report Sheet
│   ├── Food
│   │   ├── Photo
│   │   ├── Text
│   │   ├── Voice (after the core loop, before Shabbat)
│   │   ├── Processing
│   │   ├── Confirmation
│   │   ├── Edit
│   │   └── Saved
│   ├── Activity
│   ├── Weight
│   ├── Sleep
│   └── Stress
│
├── BEHAVIORAL SUPPORT
│   ├── Difficult Moment
│   ├── Context
│   ├── Intervention
│   ├── Outcome
│   └── Pattern Candidate
│
├── RECOVERY
│   ├── Difficult Day
│   ├── Trigger
│   └── Recovery
│
├── WEEKLY LEARNING
│   ├── This Week
│   ├── Weekly Summary
│   ├── Weekly Experiment
│   └── Experiment Result
│
├── PROGRESS
│   ├── Overview
│   ├── Weight Trend
│   ├── Milestones
│   ├── Behavior
│   ├── Patterns
│   └── Plateau
│
├── SHABBAT / OFFLINE
│   ├── Shabbat Approaching
│   ├── Choose Experiment
│   ├── Shabbat State
│   ├── Motzei Shabbat
│   ├── Aggregated Report
│   ├── AI Organization
│   ├── Timeline Review
│   └── Confirmation
│
├── PROFILE
│   ├── Me
│   ├── Personal Details
│   ├── Goal
│   ├── Food
│   ├── Activity
│   ├── Shabbat
│   ├── Language
│   ├── Notifications
│   └── Privacy
│
└── ENGAGEMENT (embedded in existing screens, not separate sections)
    ├── Activity Feed (inside Home)
    ├── Achievements (contextual)
    └── Streaks
```

---

# 36. Next Design Step

This document intentionally defines the entire screen architecture before detailed visual design.

The next step is **not** to design all screens at once.

Work through the product in related groups:

```text
1. Onboarding
        ↓
2. First Week
        ↓
3. Home
        ↓
4. Report / Food Reporting
        ↓
5. Weekly Learning
        ↓
6. Progress
        ↓
7. Difficult Moment / Recovery
        ↓
8. Shabbat
        ↓
9. Coach
        ↓
10. Profile / Settings
```

For each group:

```text
Flow
 ↓
Screens
 ↓
States
 ↓
User actions
 ↓
System behavior
 ↓
Edge cases
 ↓
ASCII Wireframes
 ↓
Final UX decision
```

Only after the group is approved should it move toward visual design and implementation.

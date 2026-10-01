אני רוצה לעדכן את מסמך ה־UX הקיים:

Personal Eating Coach — Phase 1 UX & Flows Specification

שלב במסמך את כל החלטות ה־UX שהתקבלו במהלך האפיון האחרון.

חשוב:

- אל תשנה החלטות שכבר אושרו.
- אל תמציא מסכים או flows חדשים ללא צורך.
- שמור על UX פשוט, mobile-first ולא עמוס.
- אין צורך בעיצוב גרפי, צבעים או קומפוננטות.
- התמקד ב־user flow, states, actions ו־system behavior.
- אם יש סתירה עם המסמך הקיים — ההחלטות החדשות כאן גוברות.
- התוצאה צריכה להיות מסמך UX מלא ומעודכן, לא changelog.

יש לעדכן את הנושאים הבאים:

1. MAIN NAVIGATION

Home | Progress | central Report | Coach | Me

Home:
מה חשוב עכשיו?

Progress:
מה השתנה אצלי?

Report:
מה קרה עכשיו?

Coach:
בוא נבין יחד

Me:
מי אני?

2. CENTRAL REPORT

Bottom Sheet:

מה תרצה לדווח?

🍽️ אוכל
🚶 פעילות
⚖️ משקל
😴 שינה
🧠 איך אני מרגיש?

או פשוט:
📷 צילום
✍️ כתיבה
🎙️ דיבור

המשתמש יכול לדלג על בחירת category והמערכת תנסה להבין את סוג האירוע.

3. HOME

Home אינו Dashboard.

יש להגדיר state-based behavior:

- Morning
- After Food Report
- Before Known Risk Context
- Meal Confirmation
- Good Day
- Difficult Day
- Evening
- Before Shabbat
- Motzei Shabbat

אם אין intervention מועיל:
לא להציג intervention בכוח.

4. FOOD REPORT

Flow:

Photo/Text/Voice
→ AI Understanding
→ One-screen Confirmation
→ Save MealEntry
→ Optional Context

Confirmation:

"זה מה שהבנתי"

רשימת foods + portions

[ משהו לא נכון? תיקון ]
[ ✓ שמור ]

Calories/macros אינם מרכז המסך.

5. FIRST WEEK

להגדיר First Week כ־internal product mode.

Flow:

Onboarding
→ First Week
→ Observe / Encourage / Learn / Experiment
→ First Week Summary
→ Weekly Cycle

Rules:

- minimum 5 available days
- maximum 15 available days
- Offline excluded
- no score
- no failure
- no missed-day language
- early signals only
- small experiment optional

First Week אינו בהכרח בדיוק 7 calendar days.

6. FIRST WEEK FEEDBACK

אחרי פעולה משמעותית אפשר לתת immediate positive feedback.

דוגמה:
"קיבלתי. כבר התחלתי להבין קצת איך אתה אוכל."

לא לתת:

- score
- percentages
- performance grade
- missed days

7. EARLY SIGNAL

יש להציג early signal רק כאשר יש משהו מעניין אבל לא מספיק evidence ל־pattern.

לדוגמה:

"בכמה מהערבים שבהם דיווחת על אוכל, ציינת גם עייפות.
עדיין מוקדם לדעת אם זה באמת דפוס אצלך."

אפשר:

- confirm
- reject
- unsure

8. FIRST WEEK SUMMARY

לא לכתוב:
"סיימת את השבוע הראשון"

עדיף:
"כבר הכרנו קצת. אני מתחיל להבין מה קורה אצלך."

Sections:

- What you did
- What we noticed
- Meaningful moment
- Next small experiment / No experiment

9. WEEKLY EXPERIMENT

Maximum one active experiment.

Flow:

Pattern/Observation
→ Experiment
→ User tries
→ Outcome
→ Learning

Outcome:

- ממש עזר
- קצת עזר
- לא ממש
- לא יודע

אין success/failure score.

10. "השבוע שלך"

זה weekly summary ולא dashboard.

פתיחה יכולה להיות:

Celebrate
Learn
Recover
Reset

Flow:

What happened
→ What we learned
→ What next

אין weekly score.

Maximum one experiment.

11. PROGRESS

Progress הוא long-term view.

Sections:

- Snapshot
- Weekly Weight Trend
- Milestones
- Behavior Changes
- What We Learned
- Experiments
- Activity
- Plateau/Context
- Next Step

Weight:
weekly only.

Milestones:
120 → 115 → 110 → 105 → 99

12. ACTIVITY

Manual reporting only in Phase 1.

Add Activity:

- activity type
- duration

No GPS requirement.

Long-term target:
60 minutes/day

Progression:
Week 1 baseline
Week 2 15
Week 3 20
Week 4 25
Weeks 5–6 30
Weeks 7–8 40
Weeks 9–10 50
Weeks 11–12 60

13. SLEEP

Manual.

Quick report:
quality + approximate hours.

No rigid target.

14. STRESS

Quick 1–5 report with optional context.

Free text/voice is always valid.

15. DIFFICULT MOMENT

Opening:

"אני איתך.
מה קורה עכשיו?"

Options:

- רעב
- לחץ
- עייפות
- craving
- לא יודע
- פשוט לדבר

Flow:
Context
→ ONE intervention
→ Outcome
→ Learning

16. BAD DAY / RECOVERY

Opening:

"היום היה קצת קשה.
רוצה לדבר על זה?"

No punishment.
No compensation.
No fasting.
No reset.

Continue from next meal.

17. COACH

User can proactively initiate.

Quick topics:

- אוכל
- הליכה
- שינה
- מתח ורעב
- התקדמות
- משהו אחר

Free text and voice supported.

Coach uses context but does not invent facts.

18. SHABBAT PREPARATION

Before Shabbat:

"עכשיו לא צריך לעשות הרבה.
רק נבחר דבר קטן אחד שנרצה לשים לב אליו בשבת."

Actions:

- choose small experiment
- no experiment

Then:
"עכשיו האפליקציה תהיה שקטה.
שבת שלום."

19. OFFLINE PERIOD

During Shabbat/offline:

- no app interaction
- no reporting
- no reminders
- no notifications
- no intervention
- no streak penalty
- daily goals paused
- excluded from adherence

20. MOTZEI SHABBAT

Opening:

"🌙 ברוך הבא.
איך הייתה השבת?"

Then one aggregated report.

The user does NOT report every meal separately.

Input:

- text
- voice
- optional photos

AI parses into expected meal/event sequence.

Then show organized timeline.

Missing event:

"ליל שבת
────────
לא הצלחתי להבין מה אכלת
[ ✎ עריכה ]"

Never invent missing data.

Only confirmed data becomes MealEntry.

21. NOTIFICATIONS

Web/PWA.

Android:
PWA → Web Push

iPhone:
Add to Home Screen → PWA → Web Push

Notification settings are user preferences, not instructions to always send.

Behavior Engine decides whether to send.

Offline Period always suppresses notifications.

22. ME / PROFILE

Main:

אני
שם
מטרה
אוכל
פעילות
שבת
משקל והתקדמות
התראות
שפה
פרטיות

Food:
likes/dislikes/preferences

Kashrut:
simple status/preferences

23. PRIVACY

User can:

- export data
- delete data
- manage privacy
- understand stored data

24. END OF DAY

Optional and contextual.

Only show when there is something meaningful to reflect on.

25. PERSONAL ACTIVITY FEED

Integrated into Home.

Shows meaningful events:

- food report
- activity
- mindful choice
- difficult moment handled
- pattern discovery

Not a social feed.

26. ACHIEVEMENTS

Contextual only.

Do not create a large trophy/achievement section in Phase 1.

27. CORE UX RULES

Add these rules at the end:

1. One action is better than many.
2. Free reporting is better than forms.
3. AI understanding should be confirmed before important structured data is saved.
4. Missing information is never invented.
5. Observation is not Pattern.
6. No shame.
7. No punishment.
8. No forced daily interaction.
9. Weight is important but not the whole product.
10. If there is no useful intervention, stay silent.
11. The user decides; the system suggests.
12. Offline Periods are real product states.
13. The farther the user is from an event, the freer reporting should become and the more organization the system should perform.

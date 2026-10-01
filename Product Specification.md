אני רוצה לעדכן את מסמך ה־Product Specification הקיים של:

Personal Eating Coach — Phase 1 Product Specification

המטרה היא לשלב במסמך את כל ההחלטות שהתקבלו במהלך האפיון האחרון.

חשוב:

- אל תשנה החלטות שכבר אושרו.
- אל תמציא דרישות חדשות.
- שמור על Phase 1 פשוט ולא over-engineered.
- אם יש סתירה בין המסמך הישן לבין ההחלטות החדשות למטה — ההחלטה החדשה גוברת.
- המסמך צריך להישאר Product Specification ולא להפוך למסמך UX מפורט.
- שמור על מבנה ברור, מקצועי וקל לקריאה.

יש לעדכן/להוסיף את הנושאים הבאים:

1. FIRST WEEK

First Week הוא מצב מוצר נפרד שמטרתו לבנות היכרות ואמון עם המשתמש, ולא למדוד ביצועים.

מטרת First Week:
"המערכת הזאת באמת יכולה לעזור לי."

השלבים:
Curiosity → Reporting → Feedback → Personal Relevance → Small Experiment → Result → Trust

כללים:

- מתחיל מיד לאחר onboarding.
- אין score.
- אין performance measurement.
- אין comparison to previous week.
- Early Signals בלבד, לא Patterns.
- אפשר לבצע ניסוי קטן מאוד.
- אין חובה לניסוי.
- Offline Periods אינם נספרים.
- מינימום 5 available days.
- אפשר לסיים מוקדם אם נאסף מספיק מידע משמעותי.
- maximum 15 available days.
- אם לאחר 15 ימים אין מספיק מידע, לא מציגים failure. מסכמים את מה שכן ידוע ועוברים ל־regular weekly cycle.
- אין לומר למשתמש שהוא "לא השלים" או "נכשל".

First Week Summary צריך להיות שונה מ־Weekly Summary רגיל.

2. EARLY SIGNALS VS PATTERNS

יש להוסיף עיקרון ברור:

Observation ≠ Pattern

ב־First Week ניתן להציג Early Signal כאשר יש אינדיקציה מעניינת, אך עדיין אין מספיק evidence.

לדוגמה:
"בכמה מהערבים שבהם דיווחת על אוכל, ציינת גם עייפות. עדיין מוקדם לדעת אם זה באמת דפוס אצלך."

Pattern ייחשב רק לאחר evidence חוזר ו/או אישור המשתמש.

3. WEEKLY EXPERIMENT

הניסוי השבועי הוא מנגנון מרכזי במוצר.

כללים:

- לכל היותר ניסוי אחד פעיל.
- ניסוי הוא behavioral ולא weight target.
- הניסוי קטן.
- עדיפות לניסוי שנובע מ־personal pattern.
- אפשר לבחור "בלי ניסוי".
- אין compliance score.
- בסוף הניסוי מודדים usefulness ולא "הצלחה/כישלון".

Flow:
Personal Pattern / Observation
→ Small Experiment
→ User Tries
→ Outcome
→ Learning

4. "השבוע שלך"

יש להגדיר אותו כ־weekly bridge ולא כ־dashboard.

המטרה:
"מה קרה השבוע, מה למדנו, ומה הצעד הבא?"

פתיחה יכולה להשתנות לפי מצב השבוע:

- Celebrate
- Learn
- Recover
- Reset / insufficient information

אין weekly score.

מבנה:
What happened → What we learned → What next

Maximum one experiment.

5. PROGRESS

Progress שונה מ־"השבוע שלך".

השבוע שלך:
מה קרה עכשיו?

Progress:
מה השתנה לאורך זמן?

Progress צריך לכלול:

- weekly weight trend
- milestones
- behavior changes
- validated patterns
- experiments
- activity progress
- plateau/context

אין:

- daily weight focus
- score
- ranking
- good/bad grade

6. WEIGHT

יש לעדכן שהמוצר משתמש ב־weekly weighing כ־default.

אין צורך בשקילה יומית.
אין daily weight score.
יש להציג trend ולא daily fluctuations.

Milestones:
120 → 115 → 110 → 105 → 99 kg

7. MOVEMENT

Phase 1 הוא manual reporting בלבד.

Long-term target:
60 minutes/day

Progression:
Week 1 — baseline
Week 2 — 15 min/day
Week 3 — 20
Week 4 — 25
Weeks 5–6 — 30
Weeks 7–8 — 40
Weeks 9–10 — 50
Weeks 11–12 — 60

ניתן לפצל למספר הליכות.

אין Phase 1 integrations עם Apple Health או מקורות אוטומטיים אחרים.

כן לשמור Architecture פתוח ל־future data sources.

8. SLEEP

Phase 1 manual בלבד.

Sleep הוא context/pattern variable ולא יעד קשיח.

אין להציג "חייב 8 שעות".

9. STRESS

Stress הוא מדד פשוט 1–5 עם optional context.

המטרה היא pattern discovery ולא יצירת score פסיכולוגי.

10. SHABBAT / OFFLINE PERIOD

Shabbat הוא first-class product concept.

יש להשתמש במודל גנרי:

OfflinePeriod {
type,
start,
end
}

Future types:
SHABBAT
HOLIDAY
USER_DEFINED

במהלך Offline Period:

- notifications OFF
- reminders OFF
- interventions OFF
- meal reporting OFF
- streak penalties OFF
- daily goals PAUSED
- adherence EXCLUDED

11. MOTZEI SHABBAT REPORTING

יש לעדכן החלטה חשובה:

המשתמש אינו מדווח כל ארוחה בנפרד לאחר שבת.

במקום זאת:

- aggregated free-form report
- text או voice
- אפשר להוסיף photos
- AI מארגן את הדיווח לפי expected meal/event sequence
- לפני שמירה המשתמש רואה timeline מסודר
- מידע חסר אינו מומצא
- אם AI לא הבין אירוע, מציגים אותו כ־missing ונותנים Edit/Add
- רק לאחר confirmation נשמרות MealEntries

Architecture:
rawInput
→ aiUnderstanding
→ confirmedMeal

העיקרון הכללי:
ככל שהמשתמש רחוק יותר בזמן מהאירוע, הדיווח חופשי ומרוכז יותר והמערכת עושה יותר עבודת ארגון.

12. NOTIFICATIONS

Phase 1 הוא Web/PWA.

Notifications יתבססו על Web Push.

Android:
Browser/PWA → Web Push → Notification

iPhone:
Web App → Add to Home Screen → PWA → Notification Permission → Web Push

חשוב:
Notification enabled אינו אומר שהמערכת חייבת לשלוח notification.

Behavior Engine מחליט אם יש סיבה אמיתית לפנות.

Offline Period תמיד גובר ומבטל notifications.

13. INTERVENTION BUDGET

יש לשמור:

- maximum 1 proactive intervention/day
- לעיתים 0
- default יכול להיות silence

Intervention levels:
0 Silence
1 Short Question
2 Small Suggestion
3 Guided Action

14. RECOVERY

Bad Day / Recovery הוא capability ולא navigation section.

אין:

- punishment
- compensation
- fasting
- forced reset
- "start over"

הצלחה מוגדרת גם לפי ability to return.

15. MOTIVATION

Motivation צריכה להתבסס על meaningful behavior ולא רק weight.

אפשרויות:

- behavioral wins
- milestones
- contextual encouragement
- activity feed
- small challenges
- streaks with grace

אין לבנות social network או gamification מורכב ב־Phase 1.

16. HOME PRINCIPLE

Home אינו Dashboard.

Home עונה:
"מה הדבר שהכי יעזור לי עכשיו?"

אם אין דבר מועיל:
המערכת יכולה פשוט לא להתערב.

17. KASHRUT

יש לשמור dietary/kosher preferences בפרופיל.

AI אינו פוסק הלכה.

יש להפריד בין:
Nutrition Data
Food Metadata
Kosher/Food Preferences

18. SUCCESS PRINCIPLE

המוצר נמדד לא רק לפי weight loss אלא גם לפי:

- reporting coverage
- low reporting friction
- AI understanding
- intervention usefulness
- pattern discovery
- recovery
- consistency
- Shabbat behavior
- "doesn't feel like a diet"

בסוף המסמך יש להוסיף Core Product Loop:

DATA
→ CONTEXT
→ PERSONAL PATTERN
→ INTERVENTION LIBRARY
→ ONE SMALL INTERVENTION
→ OUTCOME
→ LEARNING
→ BETTER NEXT DECISION

בצע את העדכון כ־מסמך Markdown מלא ומעודכן, לא כרשימת שינויים.

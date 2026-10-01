צור מסמך Markdown חדש בשם:

Personal Eating Coach — Phase 1 Screen Specification

המטרה של המסמך היא לרכז את כל המסכים וה־states של Phase 1 במקום אחד.

זה אינו מסמך Product Strategy ואינו מסמך Architecture.

המסמך צריך לתאר עבור כל מסך:

- Purpose
- Entry
- Main content
- User actions
- System behavior
- Exit / next state
- Important rules

אין צורך בעיצוב גרפי, צבעים או CSS.

המסמך צריך להיות mobile-first.

יש לכלול את כל המסכים/מצבים הבאים:

==================================================
A. ONBOARDING
==================================================

1. Welcome
2. Goals
3. Weight
4. Goal Weight
5. Age / Height
6. Activity Baseline
7. Food Preferences
8. Kashrut
9. Shabbat / Offline Period
10. Motivation / Why
11. Notifications
12. Onboarding Complete

Onboarding צריך להיות קצר ולא להפוך לשאלון ארוך.

==================================================
B. FIRST WEEK
==================================================

13. First Week Day 1
14. First Week Feedback
15. Early Signal
16. First Week Small Experiment
17. First Week Recovery
18. First Week Summary

Rules:
- minimum 5 available days
- maximum 15 available days
- Offline excluded
- no score
- no failure state
- no missed-day language
- Early Signals ≠ Patterns
- small experiment optional

First Week Summary:
"What you did"
"What we noticed"
"Meaningful moment"
"Next experiment / No experiment"

==================================================
C. CORE NAVIGATION
==================================================

19. Home
20. Progress
21. Central Report
22. Coach
23. Me

Navigation meaning:

Home = מה חשוב עכשיו?
Progress = מה השתנה אצלי?
Report = מה קרה עכשיו?
Coach = בוא נבין יחד
Me = מי אני?

==================================================
D. REPORTING
==================================================

24. Food — Photo
25. Food — Text
26. Food — Voice
27. Food AI Confirmation
28. Activity
29. Weight
30. Sleep
31. Stress

Food flow:

Photo/Text/Voice
→ AI Understanding
→ One-screen Confirmation
→ Save
→ Optional Context

AI confirmation must show:
"זה מה שהבנתי"

And:
[ משהו לא נכון? תיקון ]
[ ✓ שמור ]

No calorie/macro dashboard by default.

Activity:
- manual
- type
- duration
- no GPS requirement

Weight:
- weekly default
- no daily requirement

Sleep:
- quality
- approximate duration
- no rigid target

Stress:
- 1–5
- optional context
- free text/voice supported

==================================================
E. BEHAVIORAL SUPPORT
==================================================

32. Difficult Moment
33. Intervention
34. Intervention Outcome
35. Bad Day / Recovery
36. End of Day

Difficult Moment:

"אני איתך.
מה קורה עכשיו?"

Options:
- רעב
- לחץ
- עייפות
- craving
- לא יודע
- לדבר

Flow:

Context
→ ONE Intervention
→ Outcome
→ Learning

Intervention levels:
0 Silence
1 Short Question
2 Small Suggestion
3 Guided Action

Intervention budget:
maximum 1 proactive intervention/day.

Bad Day:
- no punishment
- no compensation
- no fasting
- no forced reset

End of Day:
optional only when meaningful.

==================================================
F. LEARNING
==================================================

37. Personal Pattern
38. Pattern Confirmation
39. Weekly Experiment
40. Experiment Outcome
41. "השבוע שלך"
42. Progress / Long-term Learning

Pattern lifecycle:

Observation
→ Repeated Evidence
→ Candidate Pattern
→ User Confirmation / Strong Evidence
→ Validated Pattern

Weekly Experiment:
- maximum one
- behavioral
- small
- optional
- based on pattern when possible
- outcome based on usefulness, not compliance

"אני השבוע שלך":
- Celebrate
- Learn
- Recover
- Reset

No weekly score.

Progress:
- weekly weight trend
- milestones
- behavior changes
- patterns
- experiments
- activity
- plateau/context

==================================================
G. SHABBAT / OFFLINE
==================================================

43. Shabbat Preparation
44. Offline State
45. Motzei Shabbat Welcome
46. Aggregated Shabbat Report
47. Shabbat Timeline Confirmation
48. Missing Meal/Event Edit

Shabbat Preparation:

"עכשיו לא צריך לעשות הרבה.
רק נבחר דבר קטן אחד שנרצה לשים לב אליו בשבת."

Allow:
- one small experiment
- no experiment

Then:
"עכשיו האפליקציה תהיה שקטה.
שבת שלום."

Offline State:

No:
- reporting
- reminders
- notifications
- interventions
- streak penalties

Daily goals paused.
Adherence excluded.

Motzei Shabbat:

The user does NOT report every meal separately.

Instead:
- one aggregated free-form report
- text or voice
- optional photos

AI parses the report into expected meal/event order.

Then show timeline.

If information is missing:

"לא הצלחתי להבין מה אכלת
[ ✎ עריכה ]"

Never invent missing information.

Only confirmed data is stored.

Generic architecture:

OfflinePeriod {
  type,
  start,
  end
}

==================================================
H. PROFILE / SETTINGS
==================================================

49. Me / Profile
50. Personal Details
51. Food Preferences
52. Kashrut
53. Activity Preferences
54. Shabbat Settings
55. Notifications
56. Language
57. Privacy

Personal Details:
- name
- age
- height
- starting weight
- goal weight
- optional non-weight goal

Food Preferences:
- likes
- dislikes
- styles
- free notes

Kashrut:
- simple status/preferences
- AI does not provide halachic rulings

Activity:
- preferred activities

Shabbat:
- Offline Period settings

Notifications:
- Coach
- Meal reporting
- Activity
- Weekly weight
- Weekly summary
- quiet hours

Language:
- Hebrew
- English
- RTL/LTR

Privacy:
- stored data
- export
- delete
- photo retention

==================================================
I. MOTIVATION / ENGAGEMENT
==================================================

58. Personal Activity Feed
59. Contextual Achievement
60. Milestone

Personal Activity Feed is integrated into Home.

It is not a social network.

Achievements are contextual, not a separate trophy system.

Examples:
- meaningful behavior
- first useful pattern
- milestone reached
- successful recovery

==================================================
J. NOTIFICATION UX
==================================================

Notifications are Web Push.

Android:
Browser/PWA → Web Push → Notification

iPhone:
Web App → Add to Home Screen → PWA → Web Push

Notification settings do not mean notifications are always sent.

Decision:

Useful reason?
→ No: silence
→ Yes: continue

Offline Period?
→ Yes: silence
→ No: continue

Already intervened recently?
→ Yes: usually silence
→ No: notification may be sent

==================================================
K. HOME STATES
==================================================

Home must be described as state-based.

Include:

- Morning
- After Meal Report
- Before Known Risk Context
- Good Day
- Difficult Day
- Evening
- Before Shabbat
- Motzei Shabbat
- Nothing Important / Silence

The last state is important:

If there is nothing useful to say, do not invent an intervention.

==================================================
L. COMPLETE SCREEN FLOW
==================================================

At the end of the document include:

ONBOARDING
↓
FIRST WEEK
↓
FIRST WEEK SUMMARY
↓
WEEKLY EXPERIMENT
↓
HOME
↓
REPORT / COACH / DIFFICULT MOMENT
↓
LEARNING
↓
PERSONAL PATTERN
↓
INTERVENTION
↓
OUTCOME
↓
"THE WEEK"
↓
NEXT EXPERIMENT
↓
REPEAT

And the Offline flow:

PREPARATION
↓
OFFLINE PERIOD
↓
NO INTERACTION
↓
RETURN
↓
AGGREGATED REPORT
↓
CONFIRMATION
↓
LEARNING

==================================================
M. GLOBAL SCREEN RULES
==================================================

End the document with these rules:

1. One action is better than many.
2. The user reports; the system organizes.
3. The system suggests; the user decides.
4. Missing data is never invented.
5. Observation is not Pattern.
6. No shame.
7. No punishment.
8. No forced daily interaction.
9. Weight is not the whole product.
10. Silence is a valid system state.
11. Offline Periods are first-class states.
12. The farther the user is from an event in time, the freer the report should be and the more organizational work the system should do.
13. Phase 1 should remain simple and avoid unnecessary infrastructure.
14. Every screen should have a clear reason to exist.
15. If a capability can be contextual instead of becoming another navigation screen, prefer the contextual approach.

Write the complete Markdown document.
Do not provide a changelog.
Do not provide only an outline.
Produce the full specification.
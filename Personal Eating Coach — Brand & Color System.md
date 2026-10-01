# Personal Eating Coach — Brand & Color System

## 1. Brand Direction

המוצר צריך להרגיש כמו:

- Personal Coach
- רגוע
- אנושי
- חיובי
- חם
- אמין
- פשוט
- לא שיפוטי
- לא רפואי
- לא "דיאטה"
- לא אפליקציית קלוריות
- לא אפליקציית Fitness

התחושה המרכזית:

> **"מישהו שעוזר לי להבין את עצמי ולעשות צעד קטן שטוב לי."**

המיתוג צריך לתמוך בתחושת:

```text
Trust
+
Calm
+
Progress
+
Self-compassion
+
Personal guidance
```

---

# 2. Brand Personality

### אנחנו כן:

- אישיים
- רגועים
- מעודדים
- חכמים אבל לא מתנשאים
- חיוביים
- פרקטיים
- לא שיפוטיים
- עדינים ברגעים קשים

### אנחנו לא:

- מאמנים קשוחים
- שופטים
- מטיפים
- "דיאטנים" בכל משפט
- מערכת הישגים אגרסיבית
- אפליקציית קלוריות
- מערכת שמפחידה את המשתמש
- מערכת שמענישה על חוסר עקביות

---

# 3. Primary Color Palette

הצבעים צריכים להיות מבוססים על צבעים טבעיים, רגועים וחמים.

## Primary — Sage Green

```text
Primary:       #6F9B82
Primary Dark:  #527561
Primary Light: #E4EFE8
```

שימושים:

- Primary CTA
- כפתורים מרכזיים
- מצב חיובי
- progress
- confirmation
- active states
- highlights

הירוק מסמל:

```text
Growth
Balance
Calm
Health
Progress
```

אין להשתמש בירוק כדי ליצור תחושת "ניצחון" אגרסיבית.

---

# 4. Secondary — Warm Sand

```text
Secondary:       #D9B98C
Secondary Dark:  #B99566
Secondary Light: #F5EBDD
```

שימושים:

- highlights
- cards
- subtle emphasis
- food-related areas
- warm backgrounds
- special moments

המטרה היא להכניס חום אנושי ולא להפוך את המוצר ל"ירוק רפואי".

---

# 5. Accent — Soft Coral

```text
Accent:       #D98F7A
Accent Dark:  #B96D59
Accent Light: #F7E2DC
```

שימושים:

- emotional moments
- attention
- difficult moments
- gentle warnings
- recovery
- selected secondary actions

חשוב:

הצבע אינו "אדום של כישלון".

אין להשתמש בו כדי לסמן:

```text
"You failed"
"Bad food"
"Too many calories"
```

---

# 6. Neutral Palette

## Background

```text
Background: #FAF9F6
```

## Surface

```text
Surface: #FFFFFF
```

## Text

```text
Text Primary:   #26332C
Text Secondary: #68736C
Text Muted:     #98A19B
```

## Borders

```text
Border:       #E3E7E3
Border Light: #EEF1EE
```

העיצוב צריך להרגיש מעט חם ולא לבן/אפור "טכנולוגי".

---

# 7. Semantic Colors

Semantic colors חייבים להיות מופרדים מהצבעים המיתוגיים.

## Success

```text
Success:       #6F9B82
Success Light: #E4EFE8
```

## Warning

```text
Warning:       #D9B98C
Warning Light: #F5EBDD
```

## Attention / Difficult Moment

```text
Attention:       #D98F7A
Attention Light: #F7E2DC
```

## Error

```text
Error:       #C96B62
Error Light: #F6E1DF
```

Error הוא מצב טכני או פעולה שלא הצליחה.

אין להשתמש ב־Error כדי לתייג התנהגות של המשתמש.

---

# 8. Important Product Rule — Colors Must Not Judge Food

אין להשתמש בצבעים כדי לומר:

```text
Green = good food
Red = bad food
```

אין:

```text
🥗 Green = healthy
🍕 Red = unhealthy
```

אין דירוג צבעוני של ארוחות.

אין "ציון בריאות" לאוכל.

הצבעים מתארים:

```text
System state
Interaction state
Progress
Attention
Recovery
```

ולא:

```text
Good user
Bad user
Good food
Bad food
```

---

# 9. Dark Mode

Dark Mode אינו Phase 1 priority.

הארכיטקטורה צריכה להיות מוכנה לכך באמצעות Design Tokens.

אין להגדיר צבעים ישירות בתוך קומפוננטות.

לדוגמה:

```css
--color-primary
--color-primary-dark
--color-primary-light

--color-background
--color-surface

--color-text-primary
--color-text-secondary

--color-border

--color-success
--color-warning
--color-attention
--color-error
```

בעתיד ניתן להוסיף:

```text
Light Theme
Dark Theme
```

בלי לשנות את ה־components.

---

# 10. Design Tokens

יש להגדיר את הצבעים כ־tokens ולא להשתמש ב־hex values ישירות בתוך UI components.

לדוגמה:

```css
:root {
  --color-primary: #6f9b82;
  --color-primary-dark: #527561;
  --color-primary-light: #e4efe8;

  --color-secondary: #d9b98c;
  --color-secondary-dark: #b99566;
  --color-secondary-light: #f5ebdd;

  --color-accent: #d98f7a;
  --color-accent-dark: #b96d59;
  --color-accent-light: #f7e2dc;

  --color-background: #faf9f6;
  --color-surface: #ffffff;

  --color-text-primary: #26332c;
  --color-text-secondary: #68736c;
  --color-text-muted: #98a19b;

  --color-border: #e3e7e3;
  --color-border-light: #eef1ee;

  --color-success: #6f9b82;
  --color-warning: #d9b98c;
  --color-attention: #d98f7a;
  --color-error: #c96b62;
}
```

---

# 11. Typography

הטיפוגרפיה צריכה להיות:

- נקייה
- מודרנית
- עגולה מעט
- מאוד קריאה בעברית
- לא "טכנולוגית" מדי
- לא רפואית

המערכת צריכה לתמוך היטב ב:

```text
Hebrew RTL
English LTR
```

יש להשתמש ב־font stack מתאים ולא לקבע font יחיד בתוך components.

לדוגמה:

```css
--font-family: "Inter", "Noto Sans Hebrew", system-ui, sans-serif;
```

יש לבדוק בפועל איזה font מספק את התוצאה הטובה ביותר בעברית ובאנגלית לפני החלטה סופית.

---

# 12. Typography Hierarchy

היררכיה בסיסית:

```text
Display
Heading 1
Heading 2
Heading 3
Body Large
Body
Body Small
Caption
```

ה־UI צריך להעדיף:

```text
Short text
Large readable numbers
Generous spacing
Clear hierarchy
```

ולא מסכים עמוסים.

---

# 13. Rounded UI

העיצוב צריך להשתמש בפינות מעוגלות בצורה עקבית.

Suggested tokens:

```text
Small:  8px
Medium: 12px
Large: 16px
XL:     24px
Pill:   999px
```

Cards מרכזיים יכולים להשתמש ב־16–24px.

אין צורך להפוך כל אלמנט ל־pill.

---

# 14. Shadows

הצללות צריכות להיות עדינות.

המטרה:

```text
Depth
Hierarchy
Separation
```

לא:

```text
Heavy neumorphism
Glossy UI
3D effects
```

העדפה היא:

```text
Subtle border
+
Very light shadow
```

---

# 15. Buttons

Primary button:

```text
Primary Green
White Text
Rounded
Clear CTA
```

Secondary:

```text
Light neutral / light green
Dark text
```

Tertiary:

```text
Text button
```

אין להשתמש בכפתורים אדומים כדי לגרום למשתמש להרגיש לחץ.

---

# 16. Cards

Cards צריכים להרגיש כמו:

> "מידע שעוזר לי"

ולא כמו:

> "דוח ביצועים"

למשל:

```text
💡 משהו קטן ששמתי לב אליו...
```

או:

```text
השבוע שלך

השבוע הצלחת...
```

ה־card צריך להיות קצר וברור.

---

# 17. Progress Visualization

Progress צריך להיות:

```text
Calm
Simple
Encouraging
```

אין:

```text
Leaderboard
Aggressive progress bars
Red/green judgment
Daily score
```

אפשר להשתמש ב:

- subtle progress bar
- trend line
- milestones
- small celebrations

הדגש הוא:

> "מה השתנה אצלי?"

ולא:

> "כמה טוב הייתי?"

---

# 18. Difficult Moments

ברגע קשה הצבעים צריכים להיות:

```text
Warm
Soft
Calm
```

ולא:

```text
Red
Alarm
Danger
Failure
```

לדוגמה:

```text
Soft Coral background
+
Dark readable text
```

המטרה היא שהמשתמש ירגיש:

> "אפשר לעצור רגע."

ולא:

> "עשיתי משהו לא בסדר."

---

# 19. Recovery

Recovery צריך להשתמש בשפה ובצבעים חיוביים ועדינים.

לדוגמה:

```text
Soft Green
+
Warm background
```

המסר:

```text
חזרת.
זה חשוב.
ממשיכים מכאן.
```

לא:

```text
Restart
Reset
Start over
```

---

# 20. Food Photography

תמונות אוכל צריכות להופיע בצורה טבעית.

אין:

- red/green food borders
- health score
- "good/bad" labels
- calorie warning overlays

התמונה היא:

```text
Input
→ Understanding
→ Confirmation
```

ולא:

```text
Input
→ Judgment
```

---

# 21. Icons & Illustration

העדפה:

- simple
- friendly
- rounded
- minimal
- human

להימנע מ:

- aggressive fitness imagery
- body transformation imagery
- scales as dominant visual
- before/after body photos
- medical imagery

ה־scale יכול להופיע כחלק מ־Weight reporting, אבל לא כסמל המרכזי של המוצר.

---

# 22. Photography / Visual Language

אם משתמשים בתמונות:

עדיפות ל:

- אוכל אמיתי
- אנשים במצבים יומיומיים
- בית
- מטבח
- הליכה
- רגעים רגועים
- אינטראקציות טבעיות

להימנע מ:

- bodies before/after
- fitness models
- unrealistic healthy lifestyle
- "perfect food"
- imagery שמייצרת אשמה

---

# 23. Emoji Usage

Emoji יכולים להיות חלק מהשפה של המוצר, אבל במינון נמוך.

לדוגמה:

```text
🍽️ אוכל
🚶 פעילות
⚖️ משקל
😴 שינה
🧠 איך אתה מרגיש?
💡 תובנה
🕯️ שבת
🌙 מוצאי שבת
```

אין להפוך כל משפט ל־emoji-heavy.

---

# 24. Brand Voice

הקול של המוצר:

```text
חברי
רגוע
ישיר
אנושי
קצר
מעודד
לא שיפוטי
```

דוגמאות:

### במקום:

> נכשלת לעמוד ביעד שלך.

להשתמש:

> היום היה קצת קשה. ממשיכים מהארוחה הבאה.

### במקום:

> חרגת מהקלוריות היומיות.

להשתמש:

> נראה שהיה היום קצת יותר מהרגיל. רוצה להבין יחד מה קרה?

### במקום:

> חובה לבצע את המשימה.

להשתמש:

> רוצה לנסות משהו קטן?

---

# 25. Core Brand Message

המסר המרכזי:

> **לא צריך להיות מושלם. צריך להבין מה עובד בשבילך.**

מסר משני:

> **צעד קטן עכשיו יכול ללמד אותנו משהו לפעם הבאה.**

---

# 26. Visual Principle

כל החלטת UI צריכה לעבור את השאלה:

> האם המסך הזה גורם למשתמש להרגיש שהוא מקבל עזרה — או שהוא מקבל ציון?

אם הוא מרגיש כמו ציון:

```text
Simplify
Soften
Remove judgment
```

אם הוא מרגיש כמו עזרה:

```text
Keep
```

---

# 27. Color Usage Summary

| Color            | Token                     | Main Use                              |
| ---------------- | ------------------------- | ------------------------------------- |
| Sage Green       | `--color-primary`         | Primary actions / progress / positive |
| Light Sage       | `--color-primary-light`   | Soft positive backgrounds             |
| Warm Sand        | `--color-secondary`       | Warm highlights                       |
| Light Sand       | `--color-secondary-light` | Food / contextual surfaces            |
| Soft Coral       | `--color-accent`          | Attention / emotional moments         |
| Light Coral      | `--color-accent-light`    | Difficult moments                     |
| Off White        | `--color-background`      | Main background                       |
| White            | `--color-surface`         | Cards / surfaces                      |
| Dark Green-Gray  | `--color-text-primary`    | Main text                             |
| Gray Green       | `--color-text-secondary`  | Secondary text                        |
| Light Gray Green | `--color-text-muted`      | Muted information                     |
| Border           | `--color-border`          | Borders                               |
| Error Red        | `--color-error`           | Technical errors only                 |

---

# 28. Non-Negotiable Brand Rules

1. No shame.
2. No punishment.
3. No food morality.
4. No red/green food scoring.
5. No "you failed".
6. No compensation messaging.
7. No aggressive fitness aesthetic.
8. No medical aesthetic.
9. No calorie-first visual hierarchy.
10. No visual ranking of users.
11. No UI that makes the user feel monitored.
12. Progress should feel encouraging, not competitive.
13. Recovery should feel like returning, not restarting.
14. The user remains in control.
15. Silence is a valid system state.

---

# 29. Design System Architecture

The implementation should follow:

```text
Brand
 ↓
Design Tokens
 ↓
Theme
 ↓
Primitive Components
 ↓
Product Components
 ↓
Screens
```

Example:

```text
Brand Colors
     ↓
CSS Variables
     ↓
Button / Card / Input
     ↓
Meal Card / Intervention Card
     ↓
Home / Report / Progress / Coach
```

Product components must not contain hard-coded brand colors.

---

# 30. Final Design Direction

The overall visual language should feel like:

```text
Calm
+
Warm
+
Human
+
Modern
+
Trustworthy
+
Personal
```

and explicitly not:

```text
Diet App
+
Fitness App
+
Medical App
+
Calorie Tracker
+
Gamified Competition
```

The design should communicate:

> **"אני כאן כדי לעזור לך להבין את עצמך, לא כדי לשפוט אותך."**

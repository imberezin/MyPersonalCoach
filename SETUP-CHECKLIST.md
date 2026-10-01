# רשימת הגדרה: מה צריך לעשות בעצמך

שלד האפליקציה מוכן ב-`app/` ועובר את כל הבדיקות. הצעדים האלה דורשים חשבונות וסודות, ולכן רק אתה יכול לעשות אותם. הם לפי הסדר, ואפשר לעצור אחרי כל צעד.

> הפקודות מיועדות ל-PowerShell. הרץ אותן מתוך התיקייה `app`.

## 1. הרצה מקומית (בלי שום חשבון)

```powershell
cd C:\Users\LENOVO\Documents\myApp\app
```

```powershell
npm run dev
```

פתח `http://localhost:3000`. כל עוד Supabase לא מחובר תראה את מסך **"צריך להשלים הגדרה"**, וזה תקין.

## 1ב. הרצה מלאה מקומית (Docker, בלי שום חשבון)

זו הדרך לראות את האתר עובד עם כניסה אמיתית ובסיס נתונים אמיתי, כולה על המחשב שלך. צריך **Docker Desktop פועל** (פותחים את התוכנה וממתינים שהסמל יהפוך לירוק).

```powershell
npm run local:start
```

בפעם הראשונה זה מוריד תמונות Docker (כמה דקות). אחר כך, פעם אחת:

```powershell
npm run local:setup
```

הסקריפט כותב את `.env.local`, יוצר משתמש פיתוח, ומדפיס את הכתובות של Studio (דשבורד מקומי) ושל Mailpit (תיבת דואר מקומית). פרטי משתמש הפיתוח נמצאים בשתי השורות `LOCAL_DEV_EMAIL` ו-`LOCAL_DEV_PASSWORD` בקובץ `.env.local`.

```powershell
npm run dev
```

פתח `http://localhost:3000` והיכנס. במצב פיתוח מופיע בבית פאנל "בדיקת מערכת" שמראה שהכול מחובר: המשתמש, הפרופיל, בדיקת RLS וזמני שבת.

| פקודה | מה היא עושה |
|---|---|
| `npm run local:stop` | עוצר את Supabase המקומי (הנתונים נשמרים) |
| `npm run local:start` | מפעיל אותו שוב |
| `npm run local:reset` | מוחק את הנתונים ומריץ את המיגרציות מחדש (אחריו להריץ שוב `npm run local:setup`) |

## 2. Supabase (חינם)

1. היכנס ל-[supabase.com](https://supabase.com), צור פרויקט חדש בתוכנית **Free**, ובחר אזור קרוב אליך. שמור את סיסמת בסיס הנתונים.
2. בפרויקט: **Project Settings → API**. העתק את שלושת הערכים: **Project URL**, **Publishable key** ו-**Secret key**.
3. צור את קובץ ההגדרות המקומי:

```powershell
Copy-Item .env.example .env.local
```

4. פתח את `.env.local` ומלא:
   - `NEXT_PUBLIC_SUPABASE_URL`: ה-Project URL
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: ה-Publishable key (מותר שיגיע לדפדפן)
   - `SUPABASE_SECRET_KEY`: ה-Secret key (**סוד**, שרת בלבד, לא לשתף ולא לשלוח לאף אחד)
5. הרץ את סכמת בסיס הנתונים: ב-Supabase פתח **SQL Editor**, הדבק את כל התוכן של `app\supabase\migrations\20261001000000_init.sql` והרץ.
6. צור את המשתמש שלך: **Authentication → Users → Add user**. אימייל וסיסמה, וסמן אישור אוטומטי של המשתמש.
7. כבה הרשמה ציבורית (ההגדרה שמאפשרת למשתמשים חדשים להירשם), כדי שאף אחד אחר לא יוכל ליצור חשבון. **אל תכבה את ספק ה-Email עצמו**: אז גם הכניסה שלך נחסמת ("Email logins are disabled"). זו בדיוק הטעות שנתפסה בהרצה המקומית.
8. הפעל את `pg_cron` ו-`pg_net`: **Database → Extensions**. אם אחד מהם לא זמין בתוכנית Free, תגיד לי ונעבור ל-Cloudflare Workers cron.

הפעל מחדש את `npm run dev`. עכשיו `http://localhost:3000` מעביר למסך הכניסה, ואתה נכנס עם המשתמש שיצרת.

## 3. סודות נוספים

סוד לנתיב ה-Cron:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

העתק את התוצאה ל-`CRON_SECRET` ב-`.env.local`.

מפתחות Web Push:

```powershell
npx web-push generate-vapid-keys
```

העתק את שני המפתחות ל-`NEXT_PUBLIC_VAPID_PUBLIC_KEY` ו-`VAPID_PRIVATE_KEY`, ובשדה `VAPID_SUBJECT` רשום `mailto:` ואחריו האימייל שלך.

## 4. GitHub

צור repository **פרטי** בחשבון **האישי** שלך (Vercel Hobby לא מתחבר ל-repos של ארגון).

אחרי שיש repo, תגיד לי ואבצע `git init`, commit ו-push. עוד לא עשיתי את זה, כי זה מפרסם קוד לשירות חיצוני ורציתי את אישורך.

## 5. Vercel (חינם, שימוש אישי)

1. ב-[vercel.com](https://vercel.com): **Add New → Project**, וייבא את ה-repo.
2. **Root Directory**: `app`.
3. **Environment Variables**: אותם ערכים כמו ב-`.env.local` (כולל `SUPABASE_SECRET_KEY`, `CRON_SECRET`, ומפתחות ה-VAPID).
4. Deploy.

## 6. תזמון ה-Behavior Engine

אחרי שהאתר באוויר, ב-Supabase **SQL Editor** (החלף את הכתובת ואת הסוד):

```sql
select cron.schedule('engine-tick', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://YOUR-APP.vercel.app/api/engine/tick',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
$$);
```

בדיקה שהנתיב מגיב:

```powershell
curl.exe -X POST https://YOUR-APP.vercel.app/api/engine/tick -H "Authorization: Bearer YOUR_CRON_SECRET"
```

התשובה הצפויה: `{"ok":true,...}`. בלי ה-header התשובה היא 401.

## 7. אופציונלי: בדיקה מול Supabase מקומי

ה-RLS כבר נבדק על Postgres אמיתי (PGlite). אם תרצה בדיקה נוספת מול הסביבה המלאה של Supabase: הפעל את Docker Desktop, ואז:

```powershell
npx supabase init
```

```powershell
npx supabase start
```

## תקלות נפוצות

- **"צריך להשלים הגדרה"** אחרי שמילאת את `.env.local`: הפעל מחדש את `npm run dev`. משתני סביבה נקראים רק בהפעלה.
- **אין התחברות:** ודא שיצרת את המשתמש בשלב 2.6 ושסימנת אישור אוטומטי.
- **הדפדפן לא מציג התראות באייפון:** צריך קודם "הוסף למסך הבית". המסך שמסביר את זה ייבנה עם ה-Onboarding.

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

### שתי סביבות במקביל: מקומית ומארחת

| פקודה | כתובת | מול מה |
|---|---|---|
| `npm run dev` | http://localhost:3000 | Supabase המקומי (Docker) |
| `npm run dev:hosted` | http://localhost:3001 | הפרויקט המארח (האמיתי) |
| `npm run dev:both` | שתי הכתובות | שתיהן בטרמינל אחד, עם קידומת `[local]` או `[hosted]` בכל שורה |

אפשר להריץ את שתיהן יחד. כותרת כל לשונית מתחילה ב-`[local]` או ב-`[hosted]`, כדי לא להתבלבל. בכל צד נכנסים עם המשתמשים של אותו צד: המשתמש האמיתי שלך קיים רק במארח, וחשבונות הפיתוח והבדיקה רק במקומי. עוצרים עם Ctrl+C.

### לראות שוב את מסכי ה-Onboarding

בבית, בלוח "בדיקת מערכת" (מופיע רק בפיתוח מקומי), יש כפתור **הצג שוב את מסכי ה-Onboarding**. הוא מחזיר את התהליך להתחלה ושומר את כל התשובות שלך, והן מוצגות מראש בכל מסך. לאיפוס מלא של התשובות השתמש בקוד שבהמשך.

### איפוס ה-Onboarding לבדיקה חוזרת

כדי לעבור את ה-Onboarding שוב מההתחלה, הרץ ב-Studio (**SQL Editor**) את הקוד הבא. הוא מחזיר את הפרופיל, ההתראות והשבתות האוטומטיות למצב של משתמש חדש, ולא נוגע בחשבון עצמו. הקוד מוגבל למשתמש אחד לפי המייל שבו (החלף אותו אם צריך), כדי לא לאפס משתמשים אחרים במסד:

```sql
update public.profiles set lifecycle_state='NEW', onboarding_step=null, onboarding_completed_at=null, first_week_started_at=null,
  goal_type='none', goal_weight_kg=null, start_weight_kg=null, goal_focus='{}', observes_shabbat=null, wants_other_offline=false,
  place_key=null, city=null, latitude=null, longitude=null, in_israel=null, candle_lighting_minutes=null,
  age=null, height_cm=null, motivation=null, kashrut='{}', food_preferences='{}', activity_preferences='{}'
  where user_id = (select id from auth.users where email = 'dev@eating-coach.test');
delete from public.offline_periods where type='SHABBAT' and source='auto' and user_id = (select id from auth.users where email = 'dev@eating-coach.test');
update public.user_preferences set notifications='{"coach":false,"meal_reporting":false,"activity":false,"weekly_weigh_in":false,"weekly_summary":false}'
  where user_id = (select id from auth.users where email = 'dev@eating-coach.test');
delete from public.push_subscriptions where user_id = (select id from auth.users where email = 'dev@eating-coach.test');
```

אחרי ההרצה פתח את `http://127.0.0.1:3000`, והאפליקציה תחזיר אותך למסך הפתיחה.

## 2. Supabase (חינם)

> **סטטוס (2026-10-06):** בוצע ב-2026-10-01. המיגרציות הורצו במסד המארח בהדרגה, עד 2026-10-05, וכל עשר המיגרציות הוחלו.

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
5. הרץ את סכמת בסיס הנתונים: ב-Supabase פתח **SQL Editor**, והרץ **כל** קובץ בתיקייה `app\supabase\migrations\` לפי הסדר (לפי שם הקובץ, מהישן לחדש): הדבק את כל התוכן של קובץ אחד, הרץ, וחזור על זה עם הבא. לא מספיק `20261001000000_init.sql` לבדו.
6. צור את המשתמש שלך: **Authentication → Users → Add user**. אימייל וסיסמה, וסמן אישור אוטומטי של המשתמש.
7. כבה הרשמה ציבורית (ההגדרה שמאפשרת למשתמשים חדשים להירשם), כדי שאף אחד אחר לא יוכל ליצור חשבון. **אל תכבה את ספק ה-Email עצמו**: אז גם הכניסה שלך נחסמת ("Email logins are disabled"). זו בדיוק הטעות שנתפסה בהרצה המקומית.
8. הפעל את `pg_cron` ו-`pg_net`: **Database → Extensions**. אם אחד מהם לא זמין בתוכנית Free, תגיד לי ונעבור ל-Cloudflare Workers cron. (עודכן 2026-10-06: שתי התוספות זמינות ופועלות בתוכנית Free, אומת ב-2026-10-01, ואין צורך ב-Cloudflare Workers cron.)

הפעל מחדש את `npm run dev`. עכשיו `http://localhost:3000` מעביר למסך הכניסה, ואתה נכנס עם המשתמש שיצרת.

## 3. סודות נוספים

> **סטטוס (2026-10-06):** בוצע ב-2026-10-01: `CRON_SECRET` ומפתחות VAPID הוגדרו ב-Vercel, והם עובדים (קריאת ה-cron מתקבלת באתר, והתראת בדיקה הגיעה לאייפון).

סוד לנתיב ה-Cron:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

העתק את התוצאה ל-`CRON_SECRET` ב-`.env.local`.

מפתחות Web Push:

```powershell
npx web-push generate-vapid-keys
```

העתק את שני המפתחות ל-`NEXT_PUBLIC_VAPID_PUBLIC_KEY` ו-`VAPID_PRIVATE_KEY`, ובשדה `VAPID_SUBJECT` רשום `mailto:` ואחריו האימייל שלך. (עודכן 2026-10-06: בפרודקשן ערך `VAPID_SUBJECT` הוא כתובת האתר, `https://my-personal-coach-delta.vercel.app`; גם `mailto:` מותר.)

## 4. GitHub

נעשה: ה-repo הוא `imberezin/MyPersonalCoach` בחשבון **האישי** (Vercel Hobby לא מתחבר ל-repos של ארגון). הוא **ציבורי**, בהחלטתך מ-2026-10-01, והקוד כבר עלה ל-`main`.

ה-CI (`.github/workflows/ci.yml`) רץ על כל push ל-`main` ועל כל pull request: lint, בדיקת טיפוסים, בדיקות ו-build.

## 5. Vercel (חינם, שימוש אישי)

> **סטטוס (2026-10-06):** בוצע ב-2026-10-01. האתר באוויר: https://my-personal-coach-delta.vercel.app.

1. ב-[vercel.com](https://vercel.com): **Add New → Project**, וייבא את ה-repo.
2. **Root Directory**: `app`.
3. **Environment Variables**: אותם ערכים כמו ב-`.env.local` (כולל `SUPABASE_SECRET_KEY`, `CRON_SECRET`, ומפתחות ה-VAPID).
4. Deploy.

## 6. תזמון ה-Behavior Engine

> **סטטוס (2026-10-06):** בוצע ב-2026-10-01. התזמון `engine-tick` רץ כל 5 דקות, והסוד נקרא מה-Vault בזמן הריצה ולא נכתב בטקסט הפקודה. הדוגמה למטה היא בדיקה ידנית של הנתיב בלבד.

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

## 6ב. תזמון: שבתות עתידיות (ראשון ורביעי)

> **סטטוס (2026-10-06):** שלבים 1–5 בוצעו ב-2026-10-02, והריצה השבועית הראשונה הצליחה ב-2026-10-04. בדיקת הבריאות בסוף הסעיף נשארת קבועה (ב-1 בכל חודש ואחרי כל פריסה שנוגעת בנתיב). בדיקת בריאות ב-2026-10-06 (שאילתת קריאה שהרצת): שתי העבודות, `engine-tick` ו-`shabbat-topup`, פעילות, והריצה האחרונה של כל אחת הצליחה, בלי כשלונות ב-3 הימים האחרונים. הריצה הבאה של `shabbat-topup` ביום רביעי 2026-10-07.

ה-Onboarding כותב 8 שבתות קדימה. הנתיב `/api/engine/shabbat-topup` מוסיף את החסרות לכל משתמש שמקיים שבת (לפי המקום שלו), כך שתמיד יש 8 קדימה. בלעדיו Home מפסיק לזהות שבת בערך ב-2026-11-26. הוא רק מוסיף שורות `SHABBAT` מסוג `auto` שמתחילות בעתיד; הוא לא נוגע בדיווחים, בשורות ידניות, בשורות עבר או בנתונים אישיים אחרים, והתשובה והלוגים שלו כוללים מספרים בלבד.

הסדר, וכל שלב במארח באישורך:

1. האתר ב-Vercel כבר כולל את הנתיב (מהקוד הזה), עם אותו `CRON_SECRET`.
2. ב-SQL Editor מריצים את הקובץ `app/supabase/migrations/20261002120000_shabbat_topup.sql` פעם אחת (פונקציה אחת, לא נוגע בשום טבלה). בודקים שהיא סגורה לכולם חוץ מ-`service_role`:

```sql
select p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('service_role', p.oid, 'execute') as service_role
  from pg_proc p where p.oid = 'public.top_up_future_auto_shabbat(uuid, text, integer, jsonb)'::regprocedure;
```

   התוצאה הצפויה: `false | false | false | true`.

3. קריאת בדיקה בלי כתיבה (dry-run). בחשבון שלך היום צפוי `"ok":true` עם `"candidates":1`, ו-`current` או שורה אחת מתוכננת (`rowsPlanned`):

```powershell
curl.exe -X POST "https://YOUR-APP.vercel.app/api/engine/shabbat-topup?dryRun=1" -H "Authorization: Bearer YOUR_CRON_SECRET"
```

   אם יש `skippedBy.stale_rows` (תשובה 500 ו-`"ok":false`), הנתונים השמורים חושבו למקום או לדקות אחרים מהפרופיל: עוצרים ובודקים לפני הריצה האמיתית. הנתיב לא מתקן שורות כאלה (שמירה מחדש של המקום ב-Onboarding מתקנת אותן).

4. אם התוצאה תקינה, אותה קריאה בלי `?dryRun=1` (ריצה אמיתית; צפוי `current` או שורה אחת שנוספה).
5. תזמון. את שם הסוד ב-Vault קח מהפקודה של `engine-tick` (התוצאה מכילה את השם, לא את הערך):

```sql
select command from cron.job where jobname = 'engine-tick';
```

```sql
-- ראשון ורביעי ב-06:00 UTC. הג'וב אידמפוטנטי, ולכן הניסיון השני בשבוע בחינם.
-- שבת שעדיין מתנהלת לא נוספת אף פעם, ולכן השעה המדויקת לא חשובה.
select cron.schedule('shabbat-topup', '0 6 * * 0,3', $$
  select net.http_post(
    url := 'https://YOUR-APP.vercel.app/api/engine/shabbat-topup',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'THE_SAME_NAME_AS_ENGINE_TICK'),
      'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);

select jobname, schedule, active from cron.job where jobname in ('engine-tick', 'shabbat-topup');
```

   `timeout_milliseconds` מפורש כי ברירת המחדל של pg_net (5 שניות) מסמנת ריצה איטית ככישלון גם כשהשרת סיים.

### בדיקת בריאות (הסימן העיקרי)

פעם אחרי ראשון ורביעי הראשונים, ואז ב-1 בכל חודש (וגם אחרי כל פריסה שנוגעת בנתיב), ב-SQL Editor:

```sql
-- תקין: under_6_weeks = 0. מעל 0 פירושו שריצה אחת לפחות לא עבדה; מתחת ל-3 שבועות כיסוי, לפעול באותו יום.
select count(*) as observing_users,
       count(*) filter (where covered_until is null or covered_until < now() + interval '6 weeks') as under_6_weeks,
       min(covered_until) as least_covered_until
  from (select p.user_id,
               (select max(o.end_at) from public.offline_periods o
                 where o.user_id = p.user_id and o.type = 'SHABBAT' and o.source = 'auto' and o.end_at > now()) as covered_until
          from public.profiles p where p.observes_shabbat is true) s;
```

בריצה שבועית תקינה `least_covered_until` נשאר כ-7 עד 8 שבועות קדימה; שבוע חג יכול לגרוע בערך שבוע, ולכן הסף הוא 6. אם `under_6_weeks` מעל 0, מריצים את קריאת ה-dry-run שבשלב 3 ובודקים מה כתוב בגוף התשובה: 200 תקין; 500 או 503 מראים בספירות מה השתבש (`failed`, `aborted`, `skippedBy`).

התוצאה של `net._http_response` נמחקת אחרי `pg_net.ttl` (ברירת מחדל 6 שעות, `show pg_net.ttl;`) ו-`cron.job_run_details` מראה רק שהקריאה נשלחה, לכן שתיהן טובות רק בשעות שאחרי ריצה:

```sql
select status, start_time from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'shabbat-topup') order by start_time desc limit 3;
select status_code, created from net._http_response order by created desc limit 3;
```

## 6ג. בדיקות קריאה לפני בניית שולח ההתראות

(נוסף 2026-10-07. זה צעד 1ב בסדר הבנייה של שולח ההתראות, `TODO.md` סעיף 4. אין כאן שום שינוי במסד: רק קריאה.)

מריצים ב-**Supabase → SQL Editor** (המסד המארח) את השאילתה הבאה כמות שהיא, ומדביקים לי את הטבלה שחוזרת. היא פקודה אחת, כי ה-SQL Editor מציג רק את התוצאה של הפקודה האחרונה. היא מציגה רק את שם המארח של כל מנוי push (למשל `web.push.apple.com`), לא את הכתובת המלאה ולא את המפתחות.

```sql
select '1. push subscriptions' as check_name, count(*)::text as detail
  from public.push_subscriptions
union all
select '1b. subscription ' || row_number() over (order by created_at),
       split_part(endpoint, '/', 3)
         || ' | created ' || created_at::date
         || ' | last_success ' || coalesce(last_success_at::date::text, 'never')
         || ' | ' || left(coalesce(user_agent, 'no user agent'), 50)
  from public.push_subscriptions
union all
select '2. notification preferences',
       notifications::text
         || ' | quiet ' || coalesce(quiet_hours_start::text, 'null') || ' to ' || coalesce(quiet_hours_end::text, 'null')
  from public.user_preferences
union all
select '3. profile',
       lifecycle_state
         || ' | first_week_ended_at ' || coalesce(first_week_ended_at::text, 'null')
         || ' | ' || timezone
  from public.profiles
union all
select '4. cron ' || jobname,
       schedule
         || ' | active ' || active
         || ' | vault secret ' || (command like '%vault.decrypted_secrets%')
         || ' | ' || coalesce(substring(command from 'timeout_milliseconds\s*:=\s*[0-9]+'), 'no explicit timeout')
  from cron.job
union all
select '5. notification_log rows', count(*)::text
  from public.notification_log
union all
select '6. constraint ' || conname, 'validated ' || convalidated
  from pg_constraint
 where conname = 'push_subscriptions_shape'
order by 1;
```

איך קוראים את התוצאה:

- **1 ו-1b, מנויי push:** כמה מנויים נשמרו ומאיזה שירות. מנוי מ-`web.push.apple.com` הוא האייפון. מנוי משירות אחר (למשל `fcm.googleapis.com`) הוא כנראה מנוי הפיתוח מ-localhost, שנוצר עם מפתחות VAPID אחרים ולכן לא יהיה תקף מול הפרודקשן; נחליט ביחד אם להסיר אותו ידנית.
- **2, העדפות:** האם `weekly_summary` הוא `true`. אם `false`, התראה שבועית לא תגיע גם אחרי שהשולח ייבנה, ונדליק אותו בצעד 11. שעות השקט צריכות להופיע `00:00:00 to 08:00:00`.
- **3, פרופיל:** `WEEKLY_CYCLE` עם `first_week_ended_at` מלא פירושו שכבר לחצת "נמשיך". `FIRST_WEEK` פירושו שעוד לא.
- **4, cron:** `engine-tick` צריך להופיע עם `*/5 * * * *` ו-`active true`. `vault secret true` אומר שהסוד נקרא מה-Vault ולא כתוב בפקודה. אם כתוב `no explicit timeout`, ה-timeout הוא ברירת המחדל של `pg_net` (5 שניות), וזה בסדר ל-tick הריק; לנתיב החדש נקבע 30000 במפורש.
- **5, `notification_log`:** צפוי `0`.
- **6, האילוץ `push_subscriptions_shape`:** `validated false` צפוי (הוא נוצר `NOT VALID` כדי לבדוק רק שורות חדשות), ו-`true` גם תקין.


## 7. בדיקה מול Supabase מקומי

נעשה, ראה סעיף 1ב: `npm run local:start` מפעיל את הסביבה המלאה של Supabase בתוך Docker (ה-`init` כבר בוצע, והתצורה ב-`app/supabase/config.toml`). ה-RLS נבדק גם על PGlite (`npm test`) וגם על תמונת Supabase האמיתית.

## תקלות נפוצות

- **"צריך להשלים הגדרה"** אחרי שמילאת את `.env.local`: הפעל מחדש את `npm run dev`. משתני סביבה נקראים רק בהפעלה.
- **אין התחברות:** ודא שיצרת את המשתמש בשלב 2.6 ושסימנת אישור אוטומטי.
- **הדפדפן לא מציג התראות באייפון:** צריך קודם "הוסף למסך הבית". המסך שמסביר את זה נבנה (A11, מסך ההתראות ב-Onboarding), והדרך באייפון, מהוספה למסך הבית ועד התראת בדיקה, אומתה באייפון אמיתי ב-2026-10-01.

💍 Wedding RSVP App — אפליקציית אישור הגעה לחתונה
אפליקציית RSVP מודרנית ומלאה לחתונה, בנויה עם React ו-Supabase, עם תמיכה מלאה בעברית ו-RTL.

✨ תכונות

🕐 טיימר ספירה לאחור — ספירה חיה לתאריך החתונה
📋 טופס RSVP — שם, טלפון, אישור הגעה ומספר אורחים
📅 הוסף ליומן — קישור ישיר ל-Google Calendar
🧭 ניווט ב-Waze — ניווט ישיר לאולם האירועים
🔐 לוח ניהול מוגן בסיסמה — לאדמין בלבד
📊 סטטיסטיקות — מגיעים / לא מגיעים / סה"כ אורחים
📥 ייצוא Excel — 3 קבצים נפרדים (כולם / מגיעים / לא מגיעים)
⚙️ הגדרות עריכה — שינוי שמות, תאריך ואולם מתוך הדאשבורד
💾 Supabase — שמירת נתונים בענן עם fallback ל-localStorage


🛠 טכנולוגיות
טכנולוגיהשימושReact 18ממשק משתמשViteבנייה ופיתוחSupabaseמסד נתונים בענןTailwind CSSעיצובVercelפריסה

🚀 התקנה והרצה מקומית
bash# שכפול הפרויקט
git clone https://github.com/amirnagat/-wedding-rsvp.git
cd -wedding-rsvp/wedding-rsvp-project

# התקנת תלויות
npm install

# הרצה מקומית
npm run dev

🗄 הגדרת Supabase
הרץ את ה-SQL הבא ב-Supabase SQL Editor:
sqlcreate table guests (
  id uuid default gen_random_uuid() primary key,
  full_name text not null,
  phone text,
  attending boolean not null default true,
  guest_count integer not null default 1,
  created_at timestamp with time zone default now()
);

alter table guests enable row level security;

create policy "Allow insert" on guests for insert with check (true);
create policy "Allow select" on guests for select using (true);
לאחר מכן עדכן את פרטי Supabase בהגדרות האדמין באפליקציה.

⚙️ הגדרות האפליקציה
ניתן לערוך את כל הפרטים הבאים ישירות מלוח הניהול (סיסמה: admin123):

💑 שמות החתן והכלה
📅 תאריך ושעת החתונה
🏛 שם האולם וכתובת
🧭 קישור Waze
🔐 סיסמת אדמין
☁️ פרטי Supabase


📱 תצוגה
האפליקציה מותאמת לכל המכשירים — מובייל, טאבלט ומחשב.

📄 רישיון
MIT License — שימוש חופשי לכל מטרה.

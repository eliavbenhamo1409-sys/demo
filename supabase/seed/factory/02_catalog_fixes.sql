begin;
update products set name = replace(name, 'מחיק קיר מסך', 'טרנזום קיר מסך') where sku like 'CWL-50-TR%';
update products set price = 62 where sku = '243535521';
update products set price = 72 where sku = 'CHN-4020';
update products set description = 'צינור עגול בסגסוגת 6063-T5, למעקות, לידיות ולמתקנים, באורך מוט מלא.' where sku = 'TUB-50';
update products set notes = 'נמכר במטר, חיתוך לפי מידה' where sku ~ '^PRF-';
update products set description = 'גליל לקווי פריסה ולעיבוד.', notes = v.n from (values ('COL-07-1250','כ־2.4 טון לגליל'),('COL-1-1250','כ־2.9 טון לגליל'),('COL-15-1250','כ־3.1 טון לגליל'),('COL-2-1500','כ־3.7 טון לגליל'),('COL-WH-07','כ־2.2 טון לגליל, צבוע PVDF'),('COL-GR-07','כ־2.2 טון לגליל, צבוע PVDF')) v(s, n) where sku = v.s;
update products set description = 'לוח מרוכב עם ליבת פוליאתילן וציפוי PVDF, לחיפוי ולשילוט.', notes = 'ליבת PE, ניילון מגן' where sku ~ '^ACP-(4|3)-';
update products set description = 'לוח מרוכב עם ליבה מינרלית חסינת אש, לחזיתות בבניינים גבוהים.', notes = 'ליבה מינרלית FR, ניילון מגן' where sku ~ '^ACP-FR';
update products set description = 'לוח בגימור ראי, לעיצוב פנים ולמעליות.', notes = 'ניילון מגן בצד אחד' where sku = 'SHT-MIR-1';
update products set notes = 'מברשת פוליפרופילן עם סנפיר' where sku = 'GSK-BR-45';
update products set notes = 'סיליקון אפור' where sku = 'GSK-SIL-8';
update products p set description = v.d, notes = v.n from (values
 ('ACC-SIL','סיליקון ניטרלי לאיטום זיגוג ופרופילים.','24 שפופרות בארגז'),('ACC-BTL','סרט בוטיל דו־צדדי לאיטום חיבורים ופחים.','12 גלילים בארגז'),
 ('ACC-SCR-48','בורג קודח נירוסטה לחיבור פרופילים ופחים, בלי קדח מקדים.','נירוסטה 410'),('ACC-RVT-48','מסמרת עיוורת לחיבור פחים ופרופילים.','אלומיניום ופלדה'),
 ('ACC-ANC-10','דיבל עיגון מתכת לבטון, לעיגון תושבות ועמודים.','פלדה מגולוונת'),('BLT-M8','בורג ראש צילינדר לחיבור אביזרים לפרופילים.','פלדה 8.8'),
 ('TNT-M5','אום הזזה לחריץ של פרופיל 20×20.','נמכר באריזות שלמות'),('TNT-M8','אום הזזה לחריץ של פרופיל 40×40 ו־40×80.','נמכר באריזות שלמות'),
 ('BRK-3030','זווית יצוקה לחיבור פרופילים 30×30 בזווית ישרה.','אלומיניום יצוק'),('BRK-8080','זווית יצוקה מחוזקת לפרופילים 80×80.','אלומיניום יצוק'),('CAP-4040','פקק פלסטיק לסגירת קצה פרופיל 40×40.','פוליאמיד שחור'),
 ('ACC-RLR-45','גלגל כפול לכנף הזזה בסדרה 45, עד 120 ק״ג לזוג.','מיסב נירוסטה'),('ACC-LCK-45','מנעול נעילה לכנף הזזה בסדרה 45.','נירוסטה'),
 ('ACC-HNG-60','ציר נסתר לכנף בסדרה 60, עד 130 ק״ג.','פלדה מצופה'),('ACC-HDL-60','ידית נעילה לכנף בסדרה 60.','צבע בתנור'),('ACC-CRN-60','פינת הרכבה לכנף בסדרה 60.','אלומיניום יצוק'),
 ('ACC-HNG-70','ציר שלושה חלקים לדלתות בסדרה 70.','נירוסטה'),('ACC-CLS-70','מחזיר עילי לדלתות כניסה, עד 80 ק״ג.','כוח 2 עד 4'),
 ('ACC-BKT-CW','תושבת עיגון לעמוד קיר מסך, עם כיוון בשלושה צירים.','אלומיניום מחושל'),('ACC-RLG-PT','פלטת רצפה לעמוד מעקה 60×60.','נירוסטה')) v(s, d, n) where p.sku = v.s;
update suppliers set notes = 'לוחות, צינורות עגולים ואטמים · מינימום הזמנה 10 לוחות' where name = 'שחר לוחות ומתכת';
update suppliers set notes = 'שיחול פרופילים מערכתיים ומבניים · אספקה בימי א׳ וד׳' where name = 'שיחולי הערבה בע״מ';
update suppliers set notes = 'צביעה בתנור ואנודייז, גם גלילים צבועים · אספקה בימי ב׳ וה׳' where name = 'ציפויי גליל עליון';
update suppliers set notes = 'לוחות מרוכבים · מכולה כל 3 שבועות בערך' where name = 'קומפוזיט פאנל יבוא';
update suppliers set notes = 'אטמים ומברשות · מינימום הזמנה 20 גלילים' where name = 'אטמי השפלה';
update suppliers set notes = 'פלטות, גלילים ומוטות בייבוא · מכולות כל 3 עד 5 שבועות' where name = 'נמל מתכות יבוא ושיווק';
-- White system bars come painted from both: the extruder's own line and the coating house.
update products set primary_supplier_id = (select id from suppliers where name = 'ציפויי גליל עליון') where sku ~ '^(WIN|DOR|PRG|SLT|LOU|RAL|FNC).*-W$' and abs(hashtext(sku)) % 2 = 0;
update products set primary_supplier_id = (select id from suppliers where name = 'שיחולי הערבה בע״מ') where sku = 'FRM-70';
update agents set created_at = v.d::timestamptz from (values ('שירה לוי','2022-06-05'),('איתי מזרחי','2023-02-12'),('ירדן קופרמן','2023-09-03'),('מעיין טרבלסי','2024-11-17')) v(n, d) where agents.name = v.n;
select count(*) from products where name like '%טרנזום%';
commit;

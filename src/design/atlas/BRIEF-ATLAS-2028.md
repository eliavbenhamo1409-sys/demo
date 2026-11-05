# ATLAS 2028 — The Industrial Clarity Design System
The owner's brief for the theme (מרחב 4), 2026-11-05, kept here as the source every page is judged against. The engineering side is README.md.

## THE MISSION
You are the creative director of an elite product design studio in the year 2028. Your task is to design and implement a completely new visual theme for an existing industrial management system: a 3D warehouse, inventory, products, movements, orders, faults, suppliers and administrative screens. Almost unlimited creative freedom, but one requirement stands above everything: **ORDER. VISUAL CLARITY. ABSOLUTE UNDERSTANDING.**

אני רוצה מערכת שאדם מסתכל עליה ומיד מבין איפה הוא, מה חשוב, מה קורה ומה הוא יכול לעשות. בלי לחפש. בלי לפענח. בלי להתאמץ. עיצוב ברמה בינלאומית, אבל לא כזה שנועד להרשים מעצבים: עיצוב שנועד לגרום לבעל מפעל להרגיש שליטה מוחלטת בעסק שלו. התחושה: "סוף סוף הכול מסודר לי מול העיניים."

### CRITICAL SCOPE
זו משימת עיצוב בלבד. Theme חדש ועצמאי בשם ATLAS 2028. אל תשנה את ה־Theme הקיים. אל תשנה לוגיקה עסקית, מסד נתונים, API, הרשאות, חישובי מלאי או התנהגות תפעולית. מותר ואף רצוי לשנות לחלוטין: פריסות מסך, היררכיה חזותית, קומפוננטות UI, גדלים ומרווחים, טיפוגרפיה, צבעים, צורת הניווט, סידור מידע, תצוגת הנתונים, המעטפת החזותית של התלת־ממד, אנימציות ומעברי מסכים. שמור על כל היכולות הקיימות ועל כל הפעולות הזמינות למשתמש. אם אתה מציע תצוגה חדשה למידע שאינו קיים בפועל, אל תמציא אותו.

## 01 — THE CORE CONCEPT: Architecture, not Decoration
תחשוב על תוכנית אדריכלית של בניין מתקדם. לכל דבר יש מקום. לכל אזור יש תפקיד. לכל מספר יש משמעות. לכל קו יש סיבה. הנדסה מדויקת. **Not futuristic. Inevitable.**
Six principles: 01 One Screen, One Clear Purpose. 02 Hierarchy Before Beauty (first, second, third). 03 Less UI, More Understanding. 04 Spatial Consistency (אותו סוג מידע תמיד באותו אזור). 05 Precision Creates Trust (יישור מושלם, ריווח עקבי, צבעים מדויקים, טיפוגרפיה יציבה). 06 Calm Is Power (גם עם עשרות התראות, המערכת נראית בשליטה).

## 02 — EXACT COLOR SYSTEM
מינרלים, מתכת, אור קר וירוק תעשייתי עמוק. לא פסטלית, לא צבעונית, לא אפורה ומשעממת.
| Token | HEX | Usage |
|---|---|---|
| Forest Ink | #142822 | Main navigation, dark anchors |
| Mineral White | #F6F8F6 | Main workspace background |
| Pure White | #FFFFFF | Active content surfaces |
| Mineral Layer | #EDF1EE | Secondary surfaces |
| Deep Jade | #0D6653 | Primary actions and selection |
| Soft Jade | #E5F1EC | Selected backgrounds |
| Primary Text | #15231E | Main text |
| Secondary Text | #586760 | Metadata |
| Subtle Text | #75837C | Tertiary information |
| Divider | #DCE3DE | Thin separators |
| Amber | #B36A25 | Warnings |
| Signal Red | #BA3B32 | Errors and critical problems |
Distribution: 70% mineral white and light surfaces, 20% neutrals and text, 8% dark green and action green, 2% exception colours. צבעי התראה רק כאשר יש משהו שדורש תשומת לב.
Sidebar: Forest Ink, refined white text, active item with a slightly lighter background and a thin Jade stripe; no huge capsules, no frames around every item, no coloured icons. Main canvas: Mineral White, active surfaces in pure white, delicate dividers, no large shadows: depth by layers, contrast and geometry, not shadow.
3D: the model's background close to the workspace colour so it feels part of the interface; shelves in light metal tones; construction in dark graphite; precise green stripes; important items get colour only by their state.

## 03 — TYPOGRAPHY
Hebrew: Heebo. Latin and numbers: Inter. Weights 400, 500, 600 (large titles may be 400 but never so thin that legibility suffers).
Scale: main page title 32–40px; primary business metric 44–60px; section title 20–24px; item title 15–16px; main body 14–15px; secondary 13–14px; small metadata 12–13px.
Rules: no more than four hierarchy levels in one area; big numbers only when they really matter; never enlarge a number to fill space; tabular numbers in tables; consistent alignment of numbers and units; correct RTL; codes like D-2 and C-1 always readable in the right direction; long product names get room; secondary text not too weak. נעים לעין גם אחרי שמונה שעות.

## 04 — THE MASTER LAYOUT: Three Zones, One Clear Hierarchy
ZONE A — Navigation Spine: fixed on the right, ~196px on desktop, Forest Ink. Holds: identity, search, סקירה, מלאי, הזמנות, פעילות, ניהול, user area and settings at the bottom. No repeated module names, no open sub-menus piled up; secondary items revealed by the active screen. Stable, quiet, reliable.
ZONE B — Primary Workspace: gets most of the attention. מחסן shows the model, תנועות the activity history, מלאי the product data. Each screen gives most of its area to its central task.
ZONE C — Contextual Intelligence Panel: secondary, only when needed, 360–420px on wide screens. Shows what is selected now: a shelf, a product, a movement. Without a selection, a relevant summary or collapse. **Never show an empty panel just because the layout expects one.**
Layout rules: CSS Grid; every screen on the same grid; spacing in 4px steps; inner padding 24–32px; gaps between zones 24–32px; tables denser; 1px borders; radius 6–10px on working components, larger only on modals/floating panels; no cards everywhere. White space separates concepts; it is never a dead area.

## 05 — THE OVERVIEW: The First Five Seconds
The most impressive screen because of how easy it is to understand. Top: the title "סקירה" and beside or under it a short state sentence from the data (not a greeting, not explanations: one sharp business sentence); under it up to three key figures: 1 שווי מלאי, 2 הזמנות פתוחות או דורשות טיפול, 3 תקלות או חוסרים משמעותיים; clear type, separated by lines, not three giant cards. Main: the 3D model is the large visual element, in a wide clean lit area, blending into the background almost naturally, not in a big framed card, not a small object in a huge void; big enough to see the warehouse's arrangement; labels only by zoom level and importance. Context: beside the model a short clear list "דורש טיפול": each row has the problem's name, place or context, a short measure, a state colour, an existing action if available; a vertical organised list, not separate cards. Bottom: a reduced activity axis, not a decorative chart: easy to see when there was activity, with a clear legend, time range and quantities by the existing options; no microscopic bars. The eye's order: the general state, then the warehouse, then what needs attention.

## 06 — THE 3D WAREHOUSE EXPERIENCE: A Physical Space That Feels Digital
Keep the clean isometric character of the current model; upgrade the visual language around it. Materials: shelves light metallic grey; beams Forest Ink or graphite; floor cold white with delicate dividing lines; machines in a precise industrial green without exaggerated saturation; labels white with dark text; active selection a sharp Jade line; exception orange or red only when needed.
Camera: in the general view the warehouse is centred and fills the workspace well, not so close that edges are cut, not so far that nothing can be read. On a single shelf: the camera focuses on the shelf, the background becomes secondary, the shelf's details show in the information panel, competing labels are hidden, the selected item is marked with a precise line.
Labels: today too many appear at once. Far zoom: mainly zone names and important exceptions. Middle zoom: relevant shelf names. Near zoom: products and quantities. No overlapping labels; no dozens of texts just because objects could carry them.
Selection: a thin Jade frame around the base of the chosen shelf; other shelves lose a little contrast; an optional thin connecting line between the selection and its details; the details panel updates smoothly. No glow, no halos, no constant pulse. Architectural and precise.

## 07 — INVENTORY SCREEN: The Cleanest Inventory Table Ever Designed
A perfect tool, not Excel in disguise, not a site with dozens of cards. Header "מלאי", under it one summary line: products, below minimum, missing, reserved, per the existing data, with delicate separators. Controls: a wide clear search, filter by category, filter by supplier, sort, and "מוצר חדש" as the single primary action; actions not scattered in corners. Table: wide, open, ordered; suggested columns מוצר | מיקום | זמין | משוריין | ביחס למינימום | סטטוס, adapted to the existing data; the product gets significant room, name always clear, sku and secondary info in a delicate line under it; aligned numbers, consistent units; shortages in colour but never a fully coloured row. Replace the dense bars at the top with a readable distribution bar by stock state with a legend and clear numbers, or remove them. 3D: no half screen for a small model; a reduced mini-map or an expanded warehouse view when a product is chosen, keeping the existing options. The table is the hero.

## 08 — SHELF DETAIL VIEW: Precision in Every Millimeter
Opening a shelf such as D-2 feels like entering an ordered technical drawing. Model side: a large clear model of the shelf, every level identified, the shelf's contents ordered and distinct, fewer overlapping labels, no products hidden behind text. Details side: a large title "D-2", under it "מיקום במחסן", a summary line "6 מוצרים · שווי מלאי", then the list of levels; each level: level number, product, quantity, unit, status against the minimum; thin horizontal rules; only the chosen level highlighted. Interaction: pointing at a row highlights the level in 3D; pointing at a product in the model highlights the row. One object with two representations.

## 09 — MOVEMENTS: An Operational Ledger
Title "תנועות", under it the number of movements in the chosen range; show receipts, issues and receipt faults if they are part of the relevant filter. A clean timeline at the top of the workspace: entries in green, exits in soft red or neutral with a clear minus, by the datum's meaning; a clear explanation of the axis and units. Rows answer: when? which product? how much in or out? from where or to where? who did it? which document is related? Primary information first; secondary delicate but readable. 3D: when a movement is chosen, its place in the warehouse may show in a secondary area; no need for a 3D warehouse taking half the page all the time.

## 10 — FAULTS: Calm Under Pressure
Title "תקלות", states open and resolved, a clear list by severity or age per the existing options. Each fault one clean row: description, place, opened at, reporting worker, status, action. Not every fault looks like an emergency; only severe ones get significant emphasis. A photo, if any, at an exact fixed size. A chosen fault with a place highlights that place in the warehouse. A calm work board that shows exactly what waits, not a stressful list of problems.

## 11 — SUPPLIERS & CATALOG: Structured Relationships
An ordered industrial library, not a contact list. Supplier table: name, contact, phone, product count, documents or names waiting for approval; exact alignment, no giant gaps. Name matching: at the top a dedicated area for pending matches; each match: the product's name as it appeared at the supplier, the factory product it is mapped to, a clear approve button, an option to correct or create a new product if it exists; a clean two-sided structure instead of long decorative lines; the user understands the relation within a second; no dozens of unnecessary icons.

## 12 — ORDERS
Keep the existing order processes. The layout emphasises: order number, customer or supplier, state, relevant date, items, shortages or attention needs if any. Same table, spacing and typography rules as the inventory screen. Every order has a clear state even without colour. A chosen order's details appear in an ordered secondary view. No crowded card layout if a simple table works better.

## 13 — DESIGN COMPONENTS
Buttons: primary Jade background, white text, radius 7px; secondary white with a thin border and dark text; text button no background with a delicate hover; danger red only for a truly destructive action; no more than one prominent primary action in an area. Inputs: height 40–44px, white, Mineral Divider border, Jade focus, clear placeholder. Tabs: plain text, a precise underline on the active one, no capsules. Tables: dense row 48px, row with secondary info 56–64px, no vertical borders, a delicate horizontal line between rows, almost imperceptible hover, selected row on light Jade. Panels: white, delicate border, small radius, no significant shadow. Empty states: a small monochrome icon, one clear sentence, one relevant action, no giant illustrations. Status: colour plus text, never colour alone. Icons: consistent line icons (e.g. Lucide), uniform stroke, 18px, to identify an action, not to decorate.

## 14 — SPACING AND VISUAL ORDER
Consistency is more important than creativity in spacing. 4px micro, 8px between related details, 12px between sub-components, 16px between rows or working components, 24px between information groups, 32px between screen areas, 48px between large sections if needed. No random values. Alignment: all screens on shared alignment lines; titles start on the same line; tables start on the same line; buttons ordered by hierarchy; numbers never jump between rows. Density: high data density is fine when ordered; no big gaps between two rows just to look minimal; a factory manager sees enough without endless scrolling.

## 15 — MOTION DESIGN 2028
Short, precise animations: hover 120ms, row selection 150ms, panel opening 200–260ms, 3D camera 350–600ms by distance; natural easing; no jumps, no animations that run all the time, no flashing light, no distracting effects. Every animation explains a change of interface state.

## 16 — RESPONSIVENESS
Large desktop: fixed right spine, wide workspace, context panel as needed. Laptop: reduce spacing, allow a narrower spine, secondary panels may open over the workspace. Tablet: one central task at a time, no three crowded columns. Mobile: if used, prioritise the existing workflows; don't squeeze the desktop view; keep actions big and clear.

## 17 — THE DESIGN AUDIT
Before changing, check all existing screens for: visual overload; small or hard to read information; dead areas; lack of hierarchy; duplicated information; overlapping labels; actions hard to identify; inconsistency between screens. Solve these inside the new theme; no need to change business processes for visual order.

## 18 — BUILD THE NEW THEME
1 scan the components and the existing theme; 2 an independent design-token system for ATLAS 2028; 3 a new layout shell; 4 a uniform component language; 5 the overview redesigned; 6 the layout and visual connection of the 3D warehouse upgraded; 7 the language applied to inventory, movements, orders, faults and suppliers; 8 responsive adjustments; 9 visual QA on every screen; 10 the existing theme preserved and switchable. Don't change functionality for a design result. Don't put sample data in the live interface.

## 19 — THE 10-SECOND HUMAN TEST
As a factory owner who doesn't know the system: do I immediately understand which screen I'm on? do I see the most important information? is it clear what needs attention? do I know where to click? is anything confusing the eye? are numbers ordered and aligned? could I work on this screen all day? does the system convey reliability and precision? If something is unclear, improve it; if something is pretty but useless, remove it; if important information is swallowed by the design, give it back its importance.

## 20 — THE FINAL STANDARD
Not a regular SaaS site, not dozens of cards, not minimalism that sacrifices usability: a product with a clear, unique visual language. Every component part of one family; every screen ordered even when full; every colour serves a meaning; every number in a clear context; every action predictable. **The interface should feel engineered, not decorated.** Creative freedom to invent layouts and break conventions, but never the principles: order over originality, understanding over effect, legibility over sophistication, control over beauty.
FINAL DIRECTIVE: not louder, not more colourful, not more complicated; more precise, more intelligent in composition, more coherent, more understandable, more beautiful because it is organised. The factory owner opens the application and immediately feels: **"Everything is exactly where it should be."**

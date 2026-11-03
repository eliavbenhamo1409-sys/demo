/**
 * What the top search finds besides rows: the questions a manager asks and the things they do, each one press away.
 * Typing "באיחור" answers with the count and goes to the list. Empty, the search offers the ones that have something to show.
 */
import type { IconName } from "@/components/ui";
import type { ActionKind } from "./ui-state";

export type CommandHit =
  | { kind: "go"; id: string; title: string; sub: string; icon: IconName; href: string }
  | { kind: "do"; id: ActionKind; title: string; sub: string; icon: IconName };

export interface CommandFacts {
  late: number;
  open: number;
  low: number;
  out: number;
  faults: number;
  pending: number;
  today: number;
}

type Command = CommandHit & { words: string[]; waiting?: number };

const many = (n: number, one: string, more: string, none: string) => (n === 0 ? none : n === 1 ? one : `${n} ${more}`);

function commands(f: CommandFacts): Command[] {
  return [
    { kind: "go", id: "late", title: "הזמנות באיחור", sub: many(f.late, "הזמנה אחת", "הזמנות", "אין"), icon: "inbox", href: "/orders?status=late", words: ["איחור", "מאחר", "מאוחר", "לא נמסר"], waiting: f.late },
    { kind: "go", id: "faults", title: "תקלות פתוחות", sub: many(f.faults, "תקלה אחת", "תקלות", "אין"), icon: "tool", href: "/faults", words: ["תקלה", "תקלות", "בעיה", "נזק"], waiting: f.faults },
    { kind: "go", id: "pending", title: "ממתינים לאישור", sub: many(f.pending, "אחד", "ממתינים", "אין"), icon: "clipboard-check", href: "/#ov-work", words: ["אישור", "אישורים", "ממתין", "לאשר"], waiting: f.pending },
    { kind: "go", id: "low", title: "מלאי נמוך", sub: many(f.low, "מוצר אחד", "מוצרים", "אין"), icon: "package", href: "/inventory?filter=low", words: ["נמוך", "מינימום", "חוסר", "חוסרים", "להשלים"], waiting: f.low },
    { kind: "go", id: "out", title: "אזל מהמלאי", sub: many(f.out, "מוצר אחד", "מוצרים", "אין"), icon: "package", href: "/inventory?filter=out", words: ["אזל", "נגמר", "אין במלאי"], waiting: f.out },
    { kind: "go", id: "orders", title: "הזמנות פתוחות", sub: many(f.open, "הזמנה אחת", "הזמנות", "אין"), icon: "inbox", href: "/orders", words: ["הזמנה", "הזמנות", "פתוחות"] },
    { kind: "go", id: "today", title: "תנועות היום", sub: many(f.today, "תנועה אחת", "תנועות", "אין"), icon: "activity", href: "/movements?period=today", words: ["תנועות", "היום", "מה קרה"] },
    { kind: "go", id: "closing", title: "סגירת יום", sub: "מה נכנס, מה יצא, מה פתוח", icon: "calendar", href: "/closing", words: ["סגירה", "סיכום", "יום"] },
    { kind: "do", id: "receive", title: "קליטת סחורה", sub: "פעולה", icon: "arrow-down-left", words: ["קליטה", "קבלה", "נכנס", "ספק"] },
    { kind: "do", id: "issue", title: "הוצאת סחורה", sub: "פעולה", icon: "arrow-up-right", words: ["הוצאה", "מסירה", "יצא", "לקוח"] },
    { kind: "do", id: "fault", title: "דיווח תקלה", sub: "פעולה", icon: "tool", words: ["דיווח", "תקלה"] },
    { kind: "do", id: "new-product", title: "מוצר חדש", sub: "פעולה", icon: "package", words: ["מוצר", "הוספה"] },
  ];
}

/** Typed, what the words match. Empty, what has something waiting, then the two things done most. */
export function findCommands(query: string, facts: CommandFacts): CommandHit[] {
  const q = query.trim();
  const all = commands(facts);
  if (!q) return all.filter((c) => (c.waiting ?? 0) > 0 || c.id === "receive" || c.id === "issue");
  return all.filter((c) => c.title.includes(q) || c.words.some((w) => w.includes(q) || q.includes(w))).slice(0, 4);
}

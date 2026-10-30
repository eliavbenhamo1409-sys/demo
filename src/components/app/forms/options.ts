/** Select option builders shared by the action forms. */
import type { SelectOption } from "@/components/ui";
import type { Product, Supplier, Worker } from "@/lib/store";

export const NEW_OPTION = "__new__";

export function productOptions(products: Product[], withNew = false): SelectOption[] {
  const opts: SelectOption[] = products.map((p) => ({ value: p.id, label: `${p.name} · ${p.sku}` }));
  if (withNew) opts.push({ value: NEW_OPTION, label: "+ מוצר חדש" });
  return opts;
}

export function supplierOptions(suppliers: Supplier[]): SelectOption[] {
  return suppliers.map((s) => ({ value: s.id, label: s.name }));
}

export function workerOptions(workers: Worker[], withNew = false): SelectOption[] {
  const opts: SelectOption[] = workers.filter((w) => w.active).map((w) => ({ value: w.id, label: w.name }));
  if (withNew) opts.push({ value: NEW_OPTION, label: "+ עובד חדש" });
  return opts;
}

export const UNIT_OPTIONS = ["יח׳", "ק\"ג", "ליטר", "מטר", "אריזה"];
export const ROLE_OPTIONS = ["עובד", "מחסנאי", "מנהל"];

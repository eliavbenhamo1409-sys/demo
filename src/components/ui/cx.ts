/** Joins truthy class names. */
export type ClassValue = string | false | null | undefined | 0;

export function cx(...parts: ClassValue[]): string {
  const out: string[] = [];
  for (const p of parts) if (p) out.push(p);
  return out.join(" ");
}

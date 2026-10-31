/**
 * OCR extension point for the worker app.
 *
 * `parseDeliveryNote(file)` will later hand the photographed delivery note to an
 * AI model and return the lines it read (supplier wording + quantity). The
 * receive flow already consumes its result: any line returned here is shown as
 * a "scanned line" that the worker confirms, maps and corrects before saving.
 *
 * Today it is a stub returning no lines, so the worker types the lines by hand.
 */

export type ScannedLine = {
  /** Product name exactly as written on the note. */
  externalName: string;
  /** Supplier's SKU, when printed on the note. */
  externalSku?: string | null;
  qty: number;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function parseDeliveryNote(_file: File): Promise<ScannedLine[]> {
  return [];
}

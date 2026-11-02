"use client";

/**
 * Runs one document reading, stage by stage, so the screen always tells the
 * truth about where it stands: preparing the photo, reading it, then matching
 * what it read against the warehouse dictionary.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Product } from "@/lib/store";
import { matchLine, suggestProducts, type Dictionary, type Match } from "@/lib/worker/match";
import { prepareDocument, readDocument, type ScannedLine } from "@/lib/worker/ocr";
import type { Region } from "@/lib/worker/ink";

export type ScanStage = "prepare" | "read" | "match";
/** A line read from the document, and what the dictionary said about it. */
export type ReadLine = ScannedLine & { match: Match; suggested?: string };
export type ScanDoc = { url: string; regions: Region[] };

export type Scan =
  | { status: "idle" }
  | { status: "reading"; stage: ScanStage; doc: ScanDoc | null }
  | { status: "read"; doc: ScanDoc; goods: ReadLine[]; services: ScannedLine[] }
  | { status: "empty"; doc: ScanDoc }
  | { status: "failed"; doc: ScanDoc | null };

export type ScanContext = { dictionary: Dictionary; products: Product[]; supplierId?: string | null };

/** The line's first pass over the page, so a quick answer doesn't cut it short. */
const MIN_READ_MS = 3200;
/** A little past the server's own limit; after this the worker carries on by hand. */
const READ_TIMEOUT_MS = 40_000;

export function useDocumentScan() {
  const [scan, setScan] = useState<Scan>({ status: "idle" });
  const run = useRef<AbortController | null>(null);
  const shown = useRef<string | null>(null);

  const release = useCallback(() => {
    if (shown.current) URL.revokeObjectURL(shown.current);
    shown.current = null;
  }, []);

  const close = useCallback(() => {
    run.current?.abort();
    release();
    setScan({ status: "idle" });
  }, [release]);

  useEffect(() => () => {
    run.current?.abort();
    release();
  }, [release]);

  const start = useCallback(async (file: File, ctx: ScanContext) => {
    run.current?.abort();
    release();
    const ctl = new AbortController();
    run.current = ctl;
    const alive = () => !ctl.signal.aborted;

    setScan({ status: "reading", stage: "prepare", doc: null });
    const prepared = await prepareDocument(file);
    if (!alive()) {
      URL.revokeObjectURL(prepared.url);
      return;
    }
    shown.current = prepared.url;
    const doc: ScanDoc = { url: prepared.url, regions: prepared.regions };
    setScan({ status: "reading", stage: "read", doc });

    const sweep = new Promise((r) => setTimeout(r, MIN_READ_MS));
    const timer = setTimeout(() => {
      ctl.abort();
      setScan({ status: "failed", doc });
    }, READ_TIMEOUT_MS);
    try {
      const scanned = await readDocument(prepared.image, ctl.signal);
      if (!alive()) return;
      setScan({ status: "reading", stage: "match", doc });
      const goods = scanned.filter((l) => l.kind !== "service");
      const services = scanned.filter((l) => l.kind === "service");
      const matches = goods.map((l) => matchLine(ctx.dictionary, l.externalName, l.externalSku, ctx.supplierId));
      const unmatched = goods.filter((_, i) => matches[i].status === "none").map((l) => l.externalName);
      const suggested = await suggestProducts(unmatched, ctx.products, ctx.dictionary);
      await sweep;
      if (!alive()) return;
      if (!scanned.length) setScan({ status: "empty", doc });
      else setScan({ status: "read", doc, services, goods: goods.map((l, i) => ({ ...l, match: matches[i], suggested: suggested.get(l.externalName) })) });
    } catch {
      if (alive()) setScan({ status: "failed", doc });
    } finally {
      clearTimeout(timer);
    }
  }, [release]);

  return { scan, start, close };
}

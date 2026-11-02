"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

/** Private bucket of the photographed receipts, read through signed URLs. */
export const DOCUMENTS_BUCKET = "delivery-notes";

const URL_SECONDS = 60 * 60;
/** Links renew well before they expire, so a page left open keeps working. */
const RENEW_AFTER_MS = 45 * 60 * 1000;
const RENEW_CHECK_MS = 5 * 60 * 1000;

/** Signed URLs by storage path; a path appears once its URL is ready. */
export function useDocumentUrls(paths: string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);
  const signedAt = useRef(new Map<string, number>());
  const key = paths.join("\n");

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), RENEW_CHECK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const now = Date.now();
    const stale = key ? key.split("\n").filter((p) => now - (signedAt.current.get(p) ?? 0) > RENEW_AFTER_MS) : [];
    if (stale.length === 0) return;
    void supabase().storage.from(DOCUMENTS_BUCKET).createSignedUrls(stale, URL_SECONDS).then(({ data }) => {
      const fresh: Record<string, string> = {};
      for (const row of data ?? []) {
        if (!row.path || !row.signedUrl) continue;
        fresh[row.path] = row.signedUrl;
        signedAt.current.set(row.path, now);
      }
      setUrls((prev) => ({ ...prev, ...fresh }));
    });
  }, [key, tick]);

  return urls;
}

/** A short-lived link that downloads the photo under `fileName`. */
export async function documentDownloadUrl(path: string, fileName: string): Promise<string> {
  const { data, error } = await supabase().storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, 60, { download: fileName });
  if (error || !data) throw new Error(error?.message ?? "ההורדה נכשלה");
  return data.signedUrl;
}

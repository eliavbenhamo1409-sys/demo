"use client";

/**
 * The saved floor. It has its own fetch and channel and stays out of the store: a failed table in
 * reload() flips the whole admin to error, and one bad binding on the shared channel risks every table.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { DEFAULT_OBJECTS, validateObjects } from "./layout";
import type { MapObject } from "./types";

const ROW = "main";

/** PostgREST and Postgres saying the table isn't there: the migration hasn't run. */
const NO_TABLE = new Set(["PGRST205", "42P01"]);

const NO_SESSION = "שמירת הפריסה דורשת כניסה לחשבון";
const CHANGED_ELSEWHERE = "הפריסה השתנתה במקום אחר. הגרסה העדכנית נטענה";
const REFUSED = `השמירה נדחתה. ${NO_SESSION}`;
const INVALID = "הפריסה לא תקינה";

export interface Layout {
  objects: readonly MapObject[];
  source: "saved" | "default";
  /** Off with the default: an edit needs a saved row to compare versions against. */
  editable: boolean;
  version: number;
  error: string | null;
  /** Resolves with the same error the hook shows, or null when saved. Never rejects. */
  save: (next: readonly MapObject[], version: number) => Promise<string | null>;
}

type Shown = Pick<Layout, "objects" | "source" | "version">;

type Reading = { kind: "saved"; objects: MapObject[]; version: number } | { kind: "default" } | { kind: "failed"; message: string };

const DEFAULT_LAYOUT: Shown = { objects: DEFAULT_OBJECTS, source: "default", version: 0 };

function objectsOf(doc: unknown): MapObject[] | null {
  return typeof doc === "object" && doc !== null && "objects" in doc ? validateObjects(doc.objects) : null;
}

async function readLayout(): Promise<Reading> {
  const { data, error } = await supabase().from("warehouse_layout").select("doc, version").eq("id", ROW).maybeSingle();
  if (error) return NO_TABLE.has(error.code) ? { kind: "default" } : { kind: "failed", message: error.message };
  // Anon sees no row at all, so a person with no session lands here too. An invalid doc is never saved over.
  const objects = data && objectsOf(data.doc);
  return data && objects ? { kind: "saved", objects, version: data.version } : { kind: "default" };
}

export function useLayout(): Layout {
  const [shown, setShown] = useState<Shown>(DEFAULT_LAYOUT);
  const [error, setError] = useState<string | null>(null);
  const reads = useRef(0);

  const load = useCallback((): Promise<Reading> => {
    const ticket = ++reads.current;
    return readLayout().then((reading) => {
      if (ticket !== reads.current) return reading;
      if (reading.kind === "failed") {
        // The last good floor stays on screen.
        setError(reading.message);
        return reading;
      }
      setError(null);
      if (reading.kind === "default") setShown(DEFAULT_LAYOUT);
      else {
        const { objects, version } = reading;
        setShown((now) => (now.source === "saved" && now.version === version ? now : { objects, version, source: "saved" }));
      }
      return reading;
    });
  }, []);

  useEffect(() => {
    let active = true;
    let channel: RealtimeChannel | null = null;
    void load().then((reading) => {
      // No channel without a row: a binding on a table that isn't there only fails over and over.
      if (!active || reading.kind !== "saved") return;
      channel = supabase()
        .channel("warehouse-layout")
        .on("postgres_changes", { event: "*", schema: "public", table: "warehouse_layout" }, () => void load())
        .subscribe((status) => {
          // Covers anything saved between the read above and this join, and after a reconnect.
          if (status === "SUBSCRIBED") void load();
        });
    });
    return () => {
      active = false;
      if (channel) void supabase().removeChannel(channel);
    };
  }, [load]);

  const save = useCallback<Layout["save"]>(
    async (next, version) => {
      const fail = (message: string) => {
        setError(message);
        return message;
      };
      const objects = validateObjects(next);
      if (!objects) return fail(INVALID);
      const sb = supabase();
      const { data: session } = await sb.auth.getSession();
      if (!session.session) return fail(NO_SESSION);

      const { data, error: saveError } = await sb
        .from("warehouse_layout")
        .update({ doc: { objects: objects.map((object) => ({ ...object })) }, version: version + 1 })
        .eq("id", ROW)
        .eq("version", version)
        .select("version");
      if (saveError) return fail(saveError.message);
      if (data.length === 0) {
        // A stale version and a row policy's refusal look the same: no error and no rows.
        const reading = await load();
        return fail(reading.kind === "saved" && reading.version !== version ? CHANGED_ELSEWHERE : REFUSED);
      }
      // A read still on its way started before this save.
      reads.current += 1;
      setError(null);
      setShown({ objects, version: version + 1, source: "saved" });
      return null;
    },
    [load],
  );

  return useMemo(() => ({ ...shown, editable: shown.source === "saved", error, save }), [shown, error, save]);
}

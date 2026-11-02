"use client";

import { useEffect, useState } from "react";
import { DEFAULT_OBJECTS, validateObjects } from "@/lib/map3d/layout";
import type { MapObject } from "@/lib/map3d/types";
import { supabase } from "@/lib/supabase/client";

/** The saved floor, read once. A panel open over the 3D page can't mount useLayout: one page, one channel. */
export function useFloorObjects(): readonly MapObject[] {
  const [objects, setObjects] = useState(DEFAULT_OBJECTS);

  useEffect(() => {
    let current = true;
    void supabase()
      .from("warehouse_layout")
      .select("doc")
      .eq("id", "main")
      .maybeSingle()
      .then(({ data }) => {
        const doc = data?.doc;
        const saved = typeof doc === "object" && doc !== null && "objects" in doc ? validateObjects(doc.objects) : null;
        if (current && saved) setObjects(saved);
      });
    return () => {
      current = false;
    };
  }, []);

  return objects;
}

import { supabase } from "@/lib/supabase/client";

/** Storage bucket the worker app uploads fault photos to (public read). */
export const FAULT_PHOTOS_BUCKET = "fault-photos";

/** Public URL of a fault photo by its storage path. */
export function faultPhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase().storage.from(FAULT_PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl;
}

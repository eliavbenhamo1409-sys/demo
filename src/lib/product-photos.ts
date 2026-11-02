import { supabase } from "@/lib/supabase/client";

/** Storage bucket of the catalogue's product photos (public read, the signed-in admin manages it). */
export const PRODUCT_PHOTOS_BUCKET = "product-photos";

const MAX_SIDE = 1600;
const QUALITY = 0.85;

/** Public URL of a product photo by its storage path. A path from the root is a demo photo that ships with the app. */
export function productPhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("/")) return path;
  return supabase().storage.from(PRODUCT_PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** The photo at most MAX_SIDE long, as WebP; null when this browser can't decode it (HEIC on desktop). */
async function downsize(file: File): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    context?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    if (!context) return null;
    const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY));
    const webp = await encode("image/webp");
    if (webp?.type === "image/webp") return webp;
    // Safari can't encode WebP and hands back a PNG. JPEG keeps a photo small there, on white because it has no alpha.
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return await encode("image/jpeg");
  } catch {
    return null;
  }
}

/** Upload a product photo; resolves to the storage path, or throws. */
export async function uploadProductPhoto(file: File): Promise<string> {
  const image = (await downsize(file)) ?? file;
  // Some systems leave a HEIC's type blank; its name still says what it is.
  const ext = (image.type.split("/")[1] || file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  // A Blob uploads under its own type, whatever the options say, and the bucket accepts images only.
  const body = image.type ? image : image.slice(0, image.size, `image/${ext}`);
  // The name is never reused, so the file can stay cached.
  const { error } = await supabase().storage.from(PRODUCT_PHOTOS_BUCKET).upload(path, body, { cacheControl: "31536000", upsert: false });
  if (error) throw new Error("העלאת התמונה נכשלה");
  return path;
}

/** Deletes a product photo from the bucket, or throws. */
export async function removeProductPhoto(path: string): Promise<void> {
  if (path.startsWith("/")) return;
  const { error } = await supabase().storage.from(PRODUCT_PHOTOS_BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}

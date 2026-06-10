// src/core/assets.ts
import type { Id } from "./domain/domain";
import type { Asset } from "./domain/map";
import { supabase } from "./persistence/supabase/supabaseClient";

/** Storage bucket for map backgrounds and token portraits (see supabase/03_storage.sql). */
export const IMAGE_BUCKET = "campaign-images";

let counter = 0;
const assetId = (): Id => `asset-${Date.now().toString(36)}-${(counter++).toString(36)}`;

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(file);
  });

const imageSize = (url: string) =>
  new Promise<{ w: number; h: number }>((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("Could not decode image"));
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
  });

const extOf = (file: File) =>
  (file.name.split(".").pop() || file.type.split("/")[1] || "img").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Turn an uploaded image File into an Asset.
 *
 * - Cloud (Supabase configured): the bytes are uploaded to Storage and only a
 *   public URL is kept in `storageRef` (plus the object `storagePath` for later
 *   cleanup). This keeps records small instead of inlining megabytes of base64.
 * - Local / not configured (or if the upload fails because the bucket isn't set
 *   up yet): falls back to an inline data URL so the app keeps working offline.
 *
 * Rendering is identical either way — `storageRef` is always a usable <img src>.
 */
export async function fileToImageAsset(file: File, campaignId: Id, ownerId: Id): Promise<Asset> {
  if (!file.type.startsWith("image/")) throw new Error("Not an image file");
  const id = assetId();
  const now = Date.now();

  // Decode natural dimensions via a short-lived object URL (cheaper than a data URL).
  const objUrl = URL.createObjectURL(file);
  let size: { w: number; h: number };
  try { size = await imageSize(objUrl); } finally { URL.revokeObjectURL(objUrl); }

  let storageRef: string;
  let storagePath: string | undefined;

  if (supabase) {
    const path = `${campaignId}/${id}.${extOf(file)}`;
    const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, { contentType: file.type, upsert: true });
    if (error) {
      console.error(`[assets] Supabase Storage upload FAILED — falling back to an inline data URL (this is why the image shows on the map but is NOT in the bucket). Reason: ${error.message}. Fix: run supabase/03_storage.sql so the '${IMAGE_BUCKET}' bucket has member write policies.`);
      storageRef = await readDataUrl(file);
    } else {
      storageRef = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
      storagePath = path;
    }
  } else {
    storageRef = await readDataUrl(file);
  }

  return {
    collection: "assets", id, campaignId, ownerId,
    visibility: { kind: "party" }, createdAt: now, updatedAt: now, schemaVersion: 1,
    kind: "image", mime: file.type, storageRef, storagePath,
    width: size.w, height: size.h, source: "upload",
  };
}

/** Best-effort delete of the underlying Storage object. No-op for inline/local assets. */
export async function removeImage(asset: Pick<Asset, "storagePath"> | null | undefined): Promise<void> {
  if (supabase && asset?.storagePath) {
    await supabase.storage.from(IMAGE_BUCKET).remove([asset.storagePath]).catch(() => undefined);
  }
}

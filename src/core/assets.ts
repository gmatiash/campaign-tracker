// src/core/assets.ts
import type { Id } from "./domain/domain";
import type { Asset } from "./domain/map";

let counter = 0;
const assetId = (): Id => `asset-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/**
 * Read an uploaded image File into an Asset (stored as a data URL in storageRef).
 * Used for both map backgrounds and token portraits. When the backend moves to
 * Supabase, only this function changes — it will upload to Storage and put a URL
 * in storageRef instead of inlining the bytes.
 */
export function fileToImageAsset(file: File, campaignId: Id, ownerId: Id): Promise<Asset> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Not an image file"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode image"));
      img.onload = () => {
        const now = Date.now();
        resolve({
          collection: "assets", id: assetId(), campaignId, ownerId,
          visibility: { kind: "party" }, createdAt: now, updatedAt: now, schemaVersion: 1,
          kind: "image", mime: file.type, storageRef: dataUrl,
          width: img.naturalWidth, height: img.naturalHeight, source: "upload",
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

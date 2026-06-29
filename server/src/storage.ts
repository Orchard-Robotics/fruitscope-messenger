import { Storage } from "@google-cloud/storage";

import { media, usingGcsEmulator } from "./env";

/**
 * Object storage for uploaded media (profile pictures).
 *
 * The server is the ONLY writer: it uploads processed images here. Clients never
 * read through the backend — each user's `avatarUrl` points straight at the CDN
 * (prod) / emulator (local), so image bytes are served by GCS+CDN, never Node.
 *
 *  - prod:  real GCS via Application Default Credentials (the Cloud Run SA).
 *  - local: the fake-gcs-server emulator (no creds; bucket auto-created on boot).
 */
const storage = media.emulatorHost
  ? new Storage({ apiEndpoint: media.emulatorHost, projectId: "fruitscope-local" })
  : new Storage();

const bucket = storage.bucket(media.bucket);

/**
 * Ensure the media bucket exists. Only used against the emulator (local dev) —
 * in prod the bucket is created and IAM'd by Terraform, and the runtime SA isn't
 * granted bucket-create, so we never call this there.
 */
export async function ensureMediaBucket(): Promise<void> {
  if (!usingGcsEmulator) return;
  // The emulator container may still be coming up when the server boots; retry
  // a few times before giving up.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const [exists] = await bucket.exists();
      if (!exists) await storage.createBucket(media.bucket);
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** The public (CDN/emulator) URL for an object key. */
export function publicUrl(key: string): string {
  return `${media.publicBase}/${key}`;
}

/**
 * Upload an object and return its key. Cached immutably — callers use a unique
 * key per version (so a new upload is a new URL) and delete the old object.
 */
export async function uploadObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  await bucket.file(key).save(body, {
    contentType,
    metadata: { cacheControl: "public, max-age=31536000, immutable" },
    resumable: false,
  });
  return key;
}

/** Best-effort delete (ignore "not found" so callers don't have to guard). */
export async function deleteObject(key: string): Promise<void> {
  await bucket.file(key).delete({ ignoreNotFound: true });
}

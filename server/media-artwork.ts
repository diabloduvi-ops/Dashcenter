import { createHash } from "node:crypto";
import { matchesImageSignature } from "./upload-storage.js";

const ARTWORK_TTL_MS = 10 * 60 * 1_000;
const MAX_ARTWORK_ENTRIES = 1_024;
const MAX_ARTWORK_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
const ARTWORK_REFERENCE = /^[a-f0-9]{32}$/;
const ALLOWED_IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

interface ArtworkEntry {
  path: string;
  expiresAt: number;
}

export interface MediaArtwork {
  buffer: Buffer;
  contentType: string;
}

const artwork = new Map<string, ArtworkEntry>();

function registryKey(sourceKey: string, reference: string): string {
  return `${sourceKey}\u0000${reference}`;
}

function pruneArtwork(now = Date.now()): void {
  for (const [key, entry] of artwork) {
    if (entry.expiresAt <= now) artwork.delete(key);
  }
  while (artwork.size > MAX_ARTWORK_ENTRIES) {
    const oldest = artwork.keys().next().value as string | undefined;
    if (!oldest) break;
    artwork.delete(oldest);
  }
}

function safeRelativePath(value: string): string | undefined {
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.length > 2_048 || /[\u0000-\u001f\u007f]/.test(path)) {
    return undefined;
  }
  return path;
}

export function registerMediaArtwork(sourceKey: string, pathValue: string): string | undefined {
  const path = safeRelativePath(pathValue);
  if (!sourceKey || !path) return undefined;
  pruneArtwork();
  const reference = createHash("sha256").update(`${sourceKey}\u0000${path}`).digest("hex").slice(0, 32);
  const key = registryKey(sourceKey, reference);
  if (!artwork.has(key)) {
    while (artwork.size >= MAX_ARTWORK_ENTRIES) {
      const oldest = artwork.keys().next().value as string | undefined;
      if (!oldest) break;
      artwork.delete(oldest);
    }
  }
  artwork.delete(key);
  artwork.set(key, { path, expiresAt: Date.now() + ARTWORK_TTL_MS });
  return reference;
}

async function boundedImageBody(response: Response): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ARTWORK_BYTES) {
    throw new Error("Media artwork is larger than 4 MB.");
  }
  if (!response.body) throw new Error("Media artwork returned an empty response.");

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_ARTWORK_BYTES) {
      await reader.cancel();
      throw new Error("Media artwork is larger than 4 MB.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, received);
}

function normalizedBaseUrl(value: string): URL {
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("Media server URL is invalid.");
  }
  return url;
}

export async function fetchRegisteredMediaArtwork(
  sourceKey: string,
  reference: string,
  baseUrl: string,
  headers: Record<string, string>,
): Promise<MediaArtwork> {
  if (!ARTWORK_REFERENCE.test(reference)) throw new Error("Media artwork reference is invalid.");
  pruneArtwork();
  const entry = artwork.get(registryKey(sourceKey, reference));
  if (!entry) throw new Error("Media artwork is no longer available.");

  const base = normalizedBaseUrl(baseUrl);
  const target = new URL(entry.path, base);
  if (target.origin !== base.origin || target.username || target.password) {
    throw new Error("Media artwork target is invalid.");
  }

  let response: Response;
  try {
    response = await fetch(target, {
      method: "GET",
      headers: { ...headers, Accept: "image/webp,image/png,image/jpeg,image/gif" },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Could not reach the media server for artwork.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("Media artwork authentication failed.");
  }
  if (!response.ok) throw new Error(`Media artwork request failed with status ${response.status}.`);

  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) throw new Error("Media artwork did not return a supported image.");
  const buffer = await boundedImageBody(response);
  if (!matchesImageSignature(buffer, contentType)) throw new Error("Media artwork bytes do not match the declared image type.");
  return { buffer, contentType };
}

export function clearMediaArtworkForTests(): void {
  artwork.clear();
}

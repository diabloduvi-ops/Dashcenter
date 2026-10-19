import { fetchWithoutRedirect } from "./credentialed-fetch.js";
import { createHash } from "node:crypto";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CACHE_TTL_MS = 25_000;

export interface BazarrConfig { url: string }
export interface BazarrCredentials { apiKey: string }
export interface BazarrPayload { missingEpisodes: number; missingMovies: number; updatedAt: string }

const cache = new Map<string, { value: BazarrPayload; expiresAt: number }>();

function baseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Bazarr URL must use http:// or https://.");
  if (url.username || url.password) throw new Error("Do not include credentials in the Bazarr URL.");
  return url.toString().replace(/\/$/, "");
}

async function request(path: string, config: BazarrConfig, credentials: BazarrCredentials): Promise<unknown> {
  const apiKey = credentials.apiKey.trim();
  if (!apiKey) throw new Error("Bazarr API key is not configured.");
  const url = new URL(`${baseUrl(config.url)}/api/${path}/wanted`);
  url.searchParams.set("apikey", apiKey);
  let response: Response;
  try {
    response = await fetchWithoutRedirect(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new Error("Could not reach Bazarr.");
  }
  if (response.status === 401 || response.status === 403) throw new Error("Bazarr authentication failed. Check the API key.");
  if (!response.ok) throw new Error(`Bazarr request failed with status ${response.status}.`);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Bazarr returned too much data.");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Bazarr returned too much data.");
  try { return JSON.parse(text) as unknown; } catch { throw new Error("Bazarr returned an invalid response."); }
}

function total(value: unknown, label: string): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Bazarr returned an invalid ${label} response.`);
  const raw = (value as Record<string, unknown>).total;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) throw new Error(`Bazarr returned an invalid ${label} total.`);
  return Math.floor(raw);
}

async function load(config: BazarrConfig, credentials: BazarrCredentials): Promise<BazarrPayload> {
  const [episodes, movies] = await Promise.all([
    request("episodes", config, credentials),
    request("movies", config, credentials),
  ]);
  return { missingEpisodes: total(episodes, "episodes"), missingMovies: total(movies, "movies"), updatedAt: new Date().toISOString() };
}

function cacheKey(config: BazarrConfig, credentials: BazarrCredentials): string {
  return `${baseUrl(config.url)}\u0000${createHash("sha256").update(credentials.apiKey).digest("hex")}`;
}

export async function testBazarrConnection(config: BazarrConfig, credentials: BazarrCredentials) {
  return { ok: true, ...(await load(config, credentials)) };
}

export async function fetchBazarrPlugin(config: BazarrConfig, credentials: BazarrCredentials): Promise<BazarrPayload> {
  const key = cacheKey(config, credentials);
  const current = cache.get(key);
  if (current && current.expiresAt > Date.now()) return current.value;
  const value = await load(config, credentials);
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

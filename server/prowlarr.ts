import { createHash } from "node:crypto";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CACHE_TTL_MS = 25_000;

export interface ProwlarrConfig { url: string }
export interface ProwlarrCredentials { apiKey: string }
export interface ProwlarrPayload {
  indexers: number;
  queries: number;
  grabs: number;
  failedQueries: number;
  failedGrabs: number;
  updatedAt: string;
}

const cache = new Map<string, { value: ProwlarrPayload; expiresAt: number }>();

function baseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Prowlarr URL must use http:// or https://.");
  if (url.username || url.password) throw new Error("Do not include credentials in the Prowlarr URL.");
  return url.toString().replace(/\/$/, "");
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

async function request(config: ProwlarrConfig, credentials: ProwlarrCredentials): Promise<unknown> {
  const apiKey = credentials.apiKey.trim();
  if (!apiKey) throw new Error("Prowlarr API key is not configured.");
  const url = new URL(`${baseUrl(config.url)}/api/v1/indexerstats`);
  url.searchParams.set("apikey", apiKey);
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new Error("Could not reach Prowlarr.");
  }
  if (response.status === 401 || response.status === 403) throw new Error("Prowlarr authentication failed. Check the API key.");
  if (!response.ok) throw new Error(`Prowlarr request failed with status ${response.status}.`);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Prowlarr returned too much data.");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Prowlarr returned too much data.");
  try { return JSON.parse(text) as unknown; } catch { throw new Error("Prowlarr returned an invalid response."); }
}

async function load(config: ProwlarrConfig, credentials: ProwlarrCredentials): Promise<ProwlarrPayload> {
  const data = await request(config, credentials);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Prowlarr returned an invalid statistics response.");
  const indexers = Array.isArray((data as Record<string, unknown>).indexers)
    ? (data as { indexers: unknown[] }).indexers.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  return indexers.reduce<ProwlarrPayload>((result, indexer) => ({
    ...result,
    queries: result.queries + numberValue(indexer.numberOfQueries),
    grabs: result.grabs + numberValue(indexer.numberOfGrabs),
    failedQueries: result.failedQueries + numberValue(indexer.numberOfFailedQueries),
    failedGrabs: result.failedGrabs + numberValue(indexer.numberOfFailedGrabs),
  }), { indexers: indexers.length, queries: 0, grabs: 0, failedQueries: 0, failedGrabs: 0, updatedAt: new Date().toISOString() });
}

function cacheKey(config: ProwlarrConfig, credentials: ProwlarrCredentials): string {
  return `${baseUrl(config.url)}\u0000${createHash("sha256").update(credentials.apiKey).digest("hex")}`;
}

export async function testProwlarrConnection(config: ProwlarrConfig, credentials: ProwlarrCredentials) {
  return { ok: true, ...(await load(config, credentials)) };
}

export async function fetchProwlarrPlugin(config: ProwlarrConfig, credentials: ProwlarrCredentials): Promise<ProwlarrPayload> {
  const key = cacheKey(config, credentials);
  const current = cache.get(key);
  if (current && current.expiresAt > Date.now()) return current.value;
  const value = await load(config, credentials);
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

import { fetchWithoutRedirect } from "./credentialed-fetch.js";
import { createHash } from "node:crypto";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_LIBRARY_RESPONSE_BYTES = 8 * 1024 * 1024;
const PLUGIN_CACHE_TTL_MS = 25_000;

export interface LidarrConfig {
  url: string;
}

export interface LidarrCredentials {
  apiKey: string;
}

export interface LidarrPayload {
  provider: "lidarr";
  server: { name: string; version: string };
  queue: number;
  wanted: number;
  library: {
    artists: number;
    monitoredArtists: number;
    albums: number;
    tracks: number;
    trackFiles: number;
  };
  updatedAt: string;
}

const pluginCache = new Map<string, { value: LidarrPayload; expiresAt: number }>();

function baseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Lidarr URL must use http:// or https://.");
  }
  if (url.username || url.password) {
    throw new Error("Do not include credentials in the Lidarr URL.");
  }
  return url.toString().replace(/\/$/, "");
}

async function responseJson(response: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new Error("Lidarr returned too much data.");

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Lidarr returned an invalid response.");
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      await reader.cancel();
      throw new Error("Lidarr returned too much data.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("Lidarr returned an invalid response.");
  }
}

async function request(url: string, credentials: LidarrCredentials, maxBytes = MAX_RESPONSE_BYTES): Promise<unknown> {
  const apiKey = credentials.apiKey.trim();
  if (!apiKey) throw new Error("Lidarr API key is not configured.");
  let response: Response;
  try {
    response = await fetchWithoutRedirect(url, {
      method: "GET",
      headers: { Accept: "application/json", "X-Api-Key": apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Could not reach Lidarr.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("Lidarr authentication failed. Check the API key.");
  }
  if (!response.ok) throw new Error(`Lidarr request failed with status ${response.status}.`);
  return responseJson(response, maxBytes);
}

function objectValue(value: unknown, error: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(error);
  return value as Record<string, unknown>;
}

function records(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`Lidarr returned an invalid ${label} response.`);
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function pagedTotal(value: unknown, label: string): number {
  const object = objectValue(value, `Lidarr returned an invalid ${label} response.`);
  if (typeof object.totalRecords === "number") return count(object.totalRecords);
  if (typeof object.totalCount === "number") return count(object.totalCount);
  if (typeof object.count === "number") return count(object.count);
  return Array.isArray(object.records) ? object.records.length : 0;
}

async function loadLidarr(config: LidarrConfig, credentials: LidarrCredentials): Promise<LidarrPayload> {
  const url = baseUrl(config.url);
  const [systemData, artistData, queueData, wantedData] = await Promise.all([
    request(`${url}/api/v1/system/status`, credentials),
    request(`${url}/api/v1/artist`, credentials, MAX_LIBRARY_RESPONSE_BYTES),
    request(`${url}/api/v1/queue/status`, credentials),
    request(`${url}/api/v1/wanted/missing?page=1&pageSize=1`, credentials),
  ]);
  const system = objectValue(systemData, "Lidarr returned an invalid system response.");
  const artists = records(artistData, "artist library");

  let albums = 0;
  let tracks = 0;
  let trackFiles = 0;
  for (const artist of artists) {
    const statistics = artist.statistics && typeof artist.statistics === "object" && !Array.isArray(artist.statistics)
      ? artist.statistics as Record<string, unknown>
      : {};
    albums += count(statistics.albumCount);
    tracks += count(statistics.totalTrackCount ?? statistics.trackCount);
    trackFiles += count(statistics.trackFileCount);
  }

  return {
    provider: "lidarr",
    server: {
      name: typeof system.instanceName === "string" && system.instanceName.trim()
        ? system.instanceName
        : typeof system.appName === "string" && system.appName.trim() ? system.appName : "Lidarr",
      version: typeof system.version === "string" ? system.version : "",
    },
    queue: pagedTotal(queueData, "queue"),
    wanted: pagedTotal(wantedData, "wanted"),
    library: {
      artists: artists.length,
      monitoredArtists: artists.filter((artist) => artist.monitored === true).length,
      albums,
      tracks,
      trackFiles,
    },
    updatedAt: new Date().toISOString(),
  };
}

function cacheKey(config: LidarrConfig, credentials: LidarrCredentials): string {
  const tokenHash = createHash("sha256").update(credentials.apiKey).digest("hex");
  return `${baseUrl(config.url)}\u0000${tokenHash}`;
}

export async function testLidarrConnection(config: LidarrConfig, credentials: LidarrCredentials) {
  return { ok: true, ...(await loadLidarr(config, credentials)) };
}

export async function fetchLidarrPlugin(
  config: LidarrConfig,
  credentials: LidarrCredentials,
): Promise<LidarrPayload> {
  const key = cacheKey(config, credentials);
  const cached = pluginCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await loadLidarr(config, credentials);
  pluginCache.set(key, { value, expiresAt: Date.now() + PLUGIN_CACHE_TTL_MS });
  return value;
}

import { createHash } from "node:crypto";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PLUGIN_CACHE_TTL_MS = 25_000;

export type ArrProvider = "radarr" | "sonarr";

export interface ArrConfig {
  url: string;
}

export interface ArrCredentials {
  apiKey: string;
}

export interface ArrPayload {
  provider: ArrProvider;
  server: { name: string; version: string };
  queue: number;
  wanted: number;
  library: {
    items: number;
    monitored: number;
    files: number;
    episodes: number;
  };
  updatedAt: string;
}

const pluginCache = new Map<string, { value: ArrPayload; expiresAt: number }>();

function providerName(provider: ArrProvider): string {
  return provider === "radarr" ? "Radarr" : "Sonarr";
}

function baseUrl(value: string, provider: ArrProvider): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${providerName(provider)} URL must use http:// or https://.`);
  }
  if (url.username || url.password) {
    throw new Error(`Do not include credentials in the ${providerName(provider)} URL.`);
  }
  return url.toString().replace(/\/$/, "");
}

async function responseJson(response: Response, provider: ArrProvider): Promise<unknown> {
  const name = providerName(provider);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error(`${name} returned too much data.`);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error(`${name} returned too much data.`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${name} returned an invalid response.`);
  }
}

async function request(url: string, provider: ArrProvider, credentials: ArrCredentials): Promise<unknown> {
  const name = providerName(provider);
  const apiKey = credentials.apiKey.trim();
  if (!apiKey) throw new Error(`${name} API key is not configured.`);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", "X-Api-Key": apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error(`Could not reach ${name}.`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${name} authentication failed. Check the API key.`);
  }
  if (!response.ok) throw new Error(`${name} request failed with status ${response.status}.`);
  return responseJson(response, provider);
}

function objectValue(value: unknown, error: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(error);
  return value as Record<string, unknown>;
}

function records(value: unknown, provider: ArrProvider, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${providerName(provider)} returned an invalid ${label} response.`);
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function pagedTotal(value: unknown, provider: ArrProvider, label: string): number {
  const object = objectValue(value, `${providerName(provider)} returned an invalid ${label} response.`);
  if (typeof object.totalRecords === "number") return count(object.totalRecords);
  if (typeof object.totalCount === "number") return count(object.totalCount);
  if (typeof object.count === "number") return count(object.count);
  return Array.isArray(object.records) ? object.records.length : 0;
}

async function loadArr(provider: ArrProvider, config: ArrConfig, credentials: ArrCredentials): Promise<ArrPayload> {
  const name = providerName(provider);
  const url = baseUrl(config.url, provider);
  const libraryPath = provider === "radarr" ? "movie" : "series";
  const [systemData, libraryData, queueData, wantedData] = await Promise.all([
    request(`${url}/api/v3/system/status`, provider, credentials),
    request(`${url}/api/v3/${libraryPath}`, provider, credentials),
    request(`${url}/api/v3/queue/status`, provider, credentials),
    request(`${url}/api/v3/wanted/missing?page=1&pageSize=1`, provider, credentials),
  ]);
  const system = objectValue(systemData, `${name} returned an invalid system response.`);
  const library = records(libraryData, provider, "library");

  let monitored = 0;
  let files = 0;
  let episodes = 0;
  for (const item of library) {
    if (item.monitored === true) monitored += 1;
    if (provider === "radarr") {
      if (item.hasFile === true) files += 1;
      continue;
    }
    const statistics = item.statistics && typeof item.statistics === "object" && !Array.isArray(item.statistics)
      ? item.statistics as Record<string, unknown>
      : {};
    files += count(statistics.episodeFileCount);
    episodes += count(statistics.episodeCount);
  }

  return {
    provider,
    server: {
      name: typeof system.instanceName === "string" && system.instanceName.trim()
        ? system.instanceName
        : typeof system.appName === "string" && system.appName.trim() ? system.appName : name,
      version: typeof system.version === "string" ? system.version : "",
    },
    queue: pagedTotal(queueData, provider, "queue"),
    wanted: pagedTotal(wantedData, provider, "wanted"),
    library: { items: library.length, monitored, files, episodes },
    updatedAt: new Date().toISOString(),
  };
}

function cacheKey(provider: ArrProvider, config: ArrConfig, credentials: ArrCredentials): string {
  const tokenHash = createHash("sha256").update(credentials.apiKey).digest("hex");
  return `${provider}\u0000${baseUrl(config.url, provider)}\u0000${tokenHash}`;
}

export async function testArrConnection(provider: ArrProvider, config: ArrConfig, credentials: ArrCredentials) {
  return { ok: true, ...(await loadArr(provider, config, credentials)) };
}

export async function fetchArrPlugin(
  provider: ArrProvider,
  config: ArrConfig,
  credentials: ArrCredentials,
): Promise<ArrPayload> {
  const key = cacheKey(provider, config, credentials);
  const cached = pluginCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await loadArr(provider, config, credentials);
  pluginCache.set(key, { value, expiresAt: Date.now() + PLUGIN_CACHE_TTL_MS });
  return value;
}

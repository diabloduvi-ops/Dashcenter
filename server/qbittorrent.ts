import { fetchWithoutRedirect } from "./credentialed-fetch.js";
import { createHash } from "node:crypto";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CACHE_TTL_MS = 25_000;

export interface QBittorrentConfig { url: string }
export interface QBittorrentCredentials { username: string; password: string }
export interface QBittorrentPayload {
  version: string;
  connectionStatus: string;
  downloadSpeed: number;
  uploadSpeed: number;
  torrents: { total: number; active: number; downloading: number; seeding: number; paused: number; errored: number };
  updatedAt: string;
}

const cache = new Map<string, { value: QBittorrentPayload; expiresAt: number }>();

function baseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("qBittorrent URL must use http:// or https://.");
  if (url.username || url.password) throw new Error("Do not include credentials in the qBittorrent URL.");
  return url.toString().replace(/\/$/, "");
}

async function boundedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("qBittorrent returned too much data.");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("qBittorrent returned too much data.");
  return text;
}

function sessionCookie(response: Response): string | undefined {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [];
  const fallback = response.headers.get("set-cookie");
  if (values.length === 0 && fallback) values.push(fallback);

  for (const value of values) {
    const match = value.match(/(?:^|,\s*)((?:QBT_)?SID(?:_[A-Za-z0-9_-]+)?)=([^;,\s]+)/i);
    if (match) return `${match[1]}=${match[2]}`;
  }
  return undefined;
}

async function login(config: QBittorrentConfig, credentials: QBittorrentCredentials): Promise<string> {
  const username = credentials.username.trim();
  if (!username || !credentials.password) throw new Error("qBittorrent username and password are required.");
  const origin = baseUrl(config.url);
  let response: Response;
  try {
    response = await fetchWithoutRedirect(`${origin}/api/v2/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: `${origin}/` },
      body: new URLSearchParams({ username, password: credentials.password }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Could not reach qBittorrent.");
  }
  const body = await boundedText(response);
  const cookie = sessionCookie(response);
  const legacySuccess = response.status === 200 && body.trim() === "Ok.";
  const currentSuccess = response.status === 204 && body.trim() === "";
  if (!response.ok || (!legacySuccess && !currentSuccess) || !cookie) {
    throw new Error("qBittorrent authentication failed. Check the Web UI credentials and URL.");
  }
  return cookie;
}

async function get(path: string, config: QBittorrentConfig, cookie: string): Promise<string> {
  let response: Response;
  try {
    response = await fetchWithoutRedirect(`${baseUrl(config.url)}/api/v2/${path}`, {
      headers: { Accept: "application/json", Cookie: cookie, Referer: `${baseUrl(config.url)}/` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Could not reach qBittorrent.");
  }
  if (response.status === 401 || response.status === 403) throw new Error("qBittorrent authentication failed.");
  if (!response.ok) throw new Error(`qBittorrent request failed with status ${response.status}.`);
  return boundedText(response);
}

function jsonObject(text: string, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new Error(`qBittorrent returned invalid ${label} data.`); }
}

function jsonArray(text: string): Record<string, unknown>[] {
  try {
    const value = JSON.parse(text) as unknown;
    if (!Array.isArray(value)) throw new Error();
    return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  } catch { throw new Error("qBittorrent returned invalid torrent data."); }
}

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

async function load(config: QBittorrentConfig, credentials: QBittorrentCredentials): Promise<QBittorrentPayload> {
  const cookie = await login(config, credentials);
  const [versionText, transferText, torrentsText] = await Promise.all([
    get("app/version", config, cookie), get("transfer/info", config, cookie), get("torrents/info", config, cookie),
  ]);
  const transfer = jsonObject(transferText, "transfer");
  const torrents = jsonArray(torrentsText);
  const states = torrents.map((torrent) => String(torrent.state ?? ""));
  const downloadingStates = new Set(["downloading", "forcedDL", "metaDL", "forcedMetaDL", "checkingDL", "stalledDL", "queuedDL"]);
  const seedingStates = new Set(["uploading", "forcedUP", "checkingUP", "stalledUP", "queuedUP"]);
  return {
    version: versionText.trim(),
    connectionStatus: String(transfer.connection_status ?? "unknown"),
    downloadSpeed: safeNumber(transfer.dl_info_speed),
    uploadSpeed: safeNumber(transfer.up_info_speed),
    torrents: {
      total: torrents.length,
      active: torrents.filter((torrent) => safeNumber(torrent.dlspeed) > 0 || safeNumber(torrent.upspeed) > 0).length,
      downloading: states.filter((state) => downloadingStates.has(state)).length,
      seeding: states.filter((state) => seedingStates.has(state)).length,
      paused: states.filter((state) => /paused|stopped/i.test(state)).length,
      errored: states.filter((state) => /error|missingFiles|unknown/i.test(state)).length,
    },
    updatedAt: new Date().toISOString(),
  };
}

function cacheKey(config: QBittorrentConfig, credentials: QBittorrentCredentials): string {
  const secret = createHash("sha256").update(`${credentials.username}\u0000${credentials.password}`).digest("hex");
  return `${baseUrl(config.url)}\u0000${secret}`;
}

export async function testQBittorrentConnection(config: QBittorrentConfig, credentials: QBittorrentCredentials) {
  return { ok: true, ...(await load(config, credentials)) };
}

export async function fetchQBittorrentPlugin(config: QBittorrentConfig, credentials: QBittorrentCredentials): Promise<QBittorrentPayload> {
  const key = cacheKey(config, credentials);
  const current = cache.get(key);
  if (current && current.expiresAt > Date.now()) return current.value;
  const value = await load(config, credentials);
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

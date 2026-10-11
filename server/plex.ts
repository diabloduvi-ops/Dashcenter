import { createHash } from "node:crypto";
import type { MediaActivity, MediaActivitySession, MediaPlayMethod } from "../shared/media-activity.js";
import { fetchRegisteredMediaArtwork, registerMediaArtwork, type MediaArtwork } from "./media-artwork.js";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CACHE_TTL_MS = 25_000;
const MAX_LIBRARIES = 50;
const MAX_ACTIVITY_SESSIONS = 12;

export interface PlexConfig { url: string }
export interface PlexCredentials { token: string }
export interface PlexPayload {
  server: { name: string; version: string; platform: string };
  sessions: { total: number; playing: number; paused: number; transcoding: number };
  library: { movies: number; shows: number; albums: number };
  activity: MediaActivity;
  updatedAt: string;
}

const cache = new Map<string, { value: PlexPayload; expiresAt: number }>();

function baseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Plex URL must use http:// or https://.");
  }
  if (url.username || url.password) throw new Error("Do not include credentials in the Plex URL.");
  return url.toString().replace(/\/$/, "");
}

async function responseJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Plex returned too much data.");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Plex returned too much data.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Plex returned an invalid response.");
  }
}

async function request(
  path: string,
  config: PlexConfig,
  credentials: PlexCredentials,
  containerSize = 100,
): Promise<unknown> {
  const token = credentials.token.trim();
  if (!token) throw new Error("Plex token is not configured.");
  let response: Response;
  try {
    response = await fetch(`${baseUrl(config.url)}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Plex-Token": token,
        "X-Plex-Client-Identifier": "dashcenter-server",
        "X-Plex-Product": "Dashcenter",
        "X-Plex-Container-Start": "0",
        "X-Plex-Container-Size": String(containerSize),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Could not reach Plex.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("Plex authentication failed. Check the token and server access.");
  }
  if (!response.ok) throw new Error(`Plex request failed with status ${response.status}.`);
  return responseJson(response);
}

function objectValue(value: unknown, error: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(error);
  return value as Record<string, unknown>;
}

function records(value: unknown): Record<string, unknown>[] {
  const values = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  return values.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function boundedString(value: unknown, maximum = 160): string {
  return stringValue(value).trim().slice(0, maximum);
}

function countValue(value: unknown): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function optionalCount(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : undefined;
}

function mediaContainer(value: unknown, label: string): Record<string, unknown> {
  const root = objectValue(value, `Plex returned an invalid ${label} response.`);
  return objectValue(root.MediaContainer, `Plex returned an invalid ${label} response.`);
}

function playerState(session: Record<string, unknown>): string {
  return stringValue(records(session.Player)[0]?.state).toLocaleLowerCase();
}

function isTranscoding(session: Record<string, unknown>): boolean {
  return records(session.TranscodeSession).length > 0;
}

function sessionPlayMethod(session: Record<string, unknown>): MediaPlayMethod {
  if (isTranscoding(session)) return "transcode";
  const media = records(session.Media)[0];
  const decisions = [boundedString(media?.videoDecision, 32), boundedString(media?.audioDecision, 32)]
    .map((decision) => decision.toLocaleLowerCase().replace(/[\s_-]/g, ""))
    .filter(Boolean);
  if (decisions.includes("transcode")) return "transcode";
  if (decisions.includes("directstream")) return "direct-stream";
  if (decisions.includes("directplay")) return "direct-play";
  return "unknown";
}

function plexQuality(session: Record<string, unknown>): string | undefined {
  const media = records(session.Media)[0];
  const resolution = boundedString(media?.videoResolution, 24);
  if (resolution) {
    if (resolution.toLocaleLowerCase() === "4k") return "4K";
    if (/^\d{3,4}$/.test(resolution)) return `${resolution}p`;
    return resolution.toLocaleLowerCase().endsWith("p") ? resolution : resolution.toLocaleUpperCase();
  }
  const height = optionalCount(media?.height);
  if (!height) return undefined;
  if (height >= 2160) return "4K";
  if (height >= 1440) return "1440p";
  if (height >= 1080) return "1080p";
  if (height >= 720) return "720p";
  return `${height}p`;
}

function activitySession(session: Record<string, unknown>, sourceKey: string, index: number): MediaActivitySession {
  const player = records(session.Player)[0] ?? {};
  const user = records(session.User)[0] ?? {};
  const positionSeconds = Math.floor(countValue(session.viewOffset) / 1_000);
  const durationSeconds = Math.floor(countValue(session.duration) / 1_000);
  const thumb = boundedString(session.thumb, 2_048) || boundedString(session.grandparentThumb, 2_048);
  const rawIdentity = [session.ratingKey, records(session.Session)[0]?.id, player.machineIdentifier, index]
    .map((value) => boundedString(value, 160)).join("\u0000");
  return {
    id: createHash("sha256").update(`${sourceKey}\u0000${rawIdentity}`).digest("hex").slice(0, 24),
    title: boundedString(session.title) || "Untitled media",
    ...(boundedString(session.grandparentTitle) ? { seriesTitle: boundedString(session.grandparentTitle) } : {}),
    ...(optionalCount(session.parentIndex) !== undefined ? { seasonNumber: optionalCount(session.parentIndex) } : {}),
    ...(optionalCount(session.index) !== undefined ? { episodeNumber: optionalCount(session.index) } : {}),
    ...(boundedString(player.product) ? { client: boundedString(player.product) } : {}),
    ...(boundedString(player.title) || boundedString(player.device) ? { device: boundedString(player.title) || boundedString(player.device) } : {}),
    ...(boundedString(user.title) ? { username: boundedString(user.title) } : {}),
    state: playerState(session) === "paused" ? "paused" : "playing",
    playMethod: sessionPlayMethod(session),
    progressPercent: durationSeconds > 0 ? Math.min(100, Math.round(positionSeconds / durationSeconds * 1_000) / 10) : 0,
    positionSeconds,
    durationSeconds,
    ...(plexQuality(session) ? { quality: plexQuality(session) } : {}),
    ...(thumb ? { artworkId: registerMediaArtwork(sourceKey, thumb) } : {}),
  };
}

async function libraryCounts(
  sections: Record<string, unknown>[],
  config: PlexConfig,
  credentials: PlexCredentials,
): Promise<PlexPayload["library"]> {
  const supported = sections.filter((section) => ["movie", "show", "artist"].includes(stringValue(section.type))).slice(0, MAX_LIBRARIES);
  const counts = await Promise.all(supported.map(async (section) => {
    const type = stringValue(section.type);
    const key = stringValue(section.key);
    if (!key) return { type, count: 0 };
    const suffix = type === "artist" ? "albums" : "all";
    const data = await request(`/library/sections/${encodeURIComponent(key)}/${suffix}`, config, credentials, 1);
    const container = mediaContainer(data, "library count");
    return { type, count: countValue(container.totalSize ?? container.size) };
  }));
  return counts.reduce<PlexPayload["library"]>((result, item) => {
    if (item.type === "movie") result.movies += item.count;
    if (item.type === "show") result.shows += item.count;
    if (item.type === "artist") result.albums += item.count;
    return result;
  }, { movies: 0, shows: 0, albums: 0 });
}

async function load(config: PlexConfig, credentials: PlexCredentials): Promise<PlexPayload> {
  const sourceKey = cacheKey(config, credentials);
  const [rootData, sessionData, sectionData] = await Promise.all([
    request("/", config, credentials, 1),
    request("/status/sessions", config, credentials, 100),
    request("/library/sections", config, credentials, MAX_LIBRARIES),
  ]);
  const root = mediaContainer(rootData, "server");
  const sessionContainer = mediaContainer(sessionData, "sessions");
  const sectionContainer = mediaContainer(sectionData, "library sections");
  const sessions = records(sessionContainer.Metadata);
  const activitySessions = sessions.map((session, index) => activitySession(session, sourceKey, index));
  const library = await libraryCounts(records(sectionContainer.Directory), config, credentials);

  return {
    server: {
      name: stringValue(root.friendlyName) || "Plex",
      version: stringValue(root.version),
      platform: stringValue(root.platform),
    },
    sessions: {
      total: countValue(sessionContainer.size) || sessions.length,
      playing: sessions.filter((session) => playerState(session) === "playing").length,
      paused: sessions.filter((session) => playerState(session) === "paused").length,
      transcoding: sessions.filter(isTranscoding).length,
    },
    library,
    activity: {
      active: activitySessions.length,
      sessions: activitySessions.slice(0, MAX_ACTIVITY_SESSIONS),
      truncated: activitySessions.length > MAX_ACTIVITY_SESSIONS,
    },
    updatedAt: new Date().toISOString(),
  };
}

function cacheKey(config: PlexConfig, credentials: PlexCredentials): string {
  const tokenHash = createHash("sha256").update(credentials.token).digest("hex");
  return `${baseUrl(config.url)}\u0000${tokenHash}`;
}

export async function testPlexConnection(config: PlexConfig, credentials: PlexCredentials) {
  return { ok: true, ...(await load(config, credentials)) };
}

export async function fetchPlexPlugin(config: PlexConfig, credentials: PlexCredentials): Promise<PlexPayload> {
  const key = cacheKey(config, credentials);
  const current = cache.get(key);
  if (current && current.expiresAt > Date.now()) return current.value;
  const value = await load(config, credentials);
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function fetchPlexArtwork(
  config: PlexConfig,
  credentials: PlexCredentials,
  artworkId: string,
): Promise<MediaArtwork> {
  const token = credentials.token.trim();
  if (!token) throw new Error("Plex token is not configured.");
  return fetchRegisteredMediaArtwork(cacheKey(config, credentials), artworkId, baseUrl(config.url), {
    "X-Plex-Token": token,
    "X-Plex-Client-Identifier": "dashcenter-server",
    "X-Plex-Product": "Dashcenter",
  });
}

import { fetchWithoutRedirect } from "./credentialed-fetch.js";
import { createHash } from "node:crypto";
import type { MediaActivity, MediaActivitySession, MediaPlayMethod } from "../shared/media-activity.js";
import { fetchRegisteredMediaArtwork, registerMediaArtwork, type MediaArtwork } from "./media-artwork.js";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PLUGIN_CACHE_TTL_MS = 25_000;
const MAX_ACTIVITY_SESSIONS = 12;

export interface JellyfinConfig {
  url: string;
}

export interface JellyfinCredentials {
  apiKey: string;
}

export interface JellyfinPayload {
  server: {
    name: string;
    version: string;
    operatingSystem: string;
    pendingRestart: boolean;
  };
  sessions: {
    connected: number;
    playing: number;
    paused: number;
    transcoding: number;
  };
  library: {
    movies: number;
    series: number;
    episodes: number;
    songs: number;
  };
  activity: MediaActivity;
  updatedAt: string;
}

const pluginCache = new Map<string, { value: JellyfinPayload; expiresAt: number }>();

function baseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Jellyfin URL must use http:// or https://.");
  }
  if (url.username || url.password) throw new Error("Do not include credentials in the Jellyfin URL.");
  return url.toString().replace(/\/$/, "");
}

async function responseJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Jellyfin returned too much data.");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Jellyfin returned too much data.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Jellyfin returned an invalid response.");
  }
}

async function request(url: string, credentials: JellyfinCredentials): Promise<unknown> {
  const apiKey = credentials.apiKey.trim();
  if (!apiKey) throw new Error("Jellyfin API key is not configured.");
  let response: Response;
  try {
    response = await fetchWithoutRedirect(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `MediaBrowser Token="${apiKey}"`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Could not reach Jellyfin.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("Jellyfin authentication failed. Check the API key and its permissions.");
  }
  if (!response.ok) throw new Error(`Jellyfin request failed with status ${response.status}.`);
  return responseJson(response);
}

function objectValue(value: unknown, error: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(error);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function boundedString(value: unknown, maximum = 160): string {
  return stringValue(value).trim().slice(0, maximum);
}

function countValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function optionalCount(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function jellyfinSeconds(value: unknown): number {
  const ticks = optionalCount(value) ?? 0;
  return Math.max(0, Math.floor(ticks / 10_000_000));
}

function sessionPlayMethod(session: Record<string, unknown>, playState: Record<string, unknown>): MediaPlayMethod {
  if (recordValue(session.TranscodingInfo)) return "transcode";
  const value = boundedString(playState.PlayMethod, 32).toLocaleLowerCase().replace(/[\s_-]/g, "");
  if (value === "directplay") return "direct-play";
  if (value === "directstream") return "direct-stream";
  return "unknown";
}

function jellyfinQuality(session: Record<string, unknown>, item: Record<string, unknown>): string | undefined {
  const transcoding = recordValue(session.TranscodingInfo);
  const streams = Array.isArray(item.MediaStreams)
    ? item.MediaStreams.filter((stream): stream is Record<string, unknown> => Boolean(recordValue(stream)))
    : [];
  const video = streams.find((stream) => boundedString(stream.Type, 16).toLocaleLowerCase() === "video");
  const height = optionalCount(transcoding?.Height) ?? optionalCount(item.Height) ?? optionalCount(video?.Height);
  if (!height) return undefined;
  if (height >= 2160) return "4K";
  if (height >= 1440) return "1440p";
  if (height >= 1080) return "1080p";
  if (height >= 720) return "720p";
  return `${height}p`;
}

function jellyfinArtworkPath(item: Record<string, unknown>): string | undefined {
  const imageTags = recordValue(item.ImageTags);
  const directTag = boundedString(item.PrimaryImageTag, 256) || boundedString(imageTags?.Primary, 256);
  const directId = boundedString(item.PrimaryImageItemId, 128) || boundedString(item.Id, 128);
  if (directTag && directId) {
    return `/Items/${encodeURIComponent(directId)}/Images/Primary?tag=${encodeURIComponent(directTag)}&maxWidth=640&quality=85`;
  }
  const seriesTag = boundedString(item.SeriesPrimaryImageTag, 256);
  const seriesId = boundedString(item.SeriesId, 128);
  return seriesTag && seriesId
    ? `/Items/${encodeURIComponent(seriesId)}/Images/Primary?tag=${encodeURIComponent(seriesTag)}&maxWidth=640&quality=85`
    : undefined;
}

function activitySession(
  session: Record<string, unknown>,
  sourceKey: string,
  index: number,
): MediaActivitySession | undefined {
  const item = recordValue(session.NowPlayingItem);
  if (!item) return undefined;
  const playState = recordValue(session.PlayState) ?? {};
  const positionSeconds = jellyfinSeconds(playState.PositionTicks);
  const durationSeconds = jellyfinSeconds(item.RunTimeTicks);
  const artworkPath = jellyfinArtworkPath(item);
  const rawIdentity = [session.Id, item.Id, session.DeviceId, index].map((value) => boundedString(value, 160)).join("\u0000");
  const id = createHash("sha256").update(`${sourceKey}\u0000${rawIdentity}`).digest("hex").slice(0, 24);
  return {
    id,
    title: boundedString(item.Name) || "Untitled media",
    ...(boundedString(item.SeriesName) ? { seriesTitle: boundedString(item.SeriesName) } : {}),
    ...(optionalCount(item.ParentIndexNumber) !== undefined ? { seasonNumber: optionalCount(item.ParentIndexNumber) } : {}),
    ...(optionalCount(item.IndexNumber) !== undefined ? { episodeNumber: optionalCount(item.IndexNumber) } : {}),
    ...(boundedString(session.Client) ? { client: boundedString(session.Client) } : {}),
    ...(boundedString(session.DeviceName) ? { device: boundedString(session.DeviceName) } : {}),
    ...(boundedString(session.UserName) ? { username: boundedString(session.UserName) } : {}),
    state: playState.IsPaused === true ? "paused" : "playing",
    playMethod: sessionPlayMethod(session, playState),
    progressPercent: durationSeconds > 0 ? Math.min(100, Math.round(positionSeconds / durationSeconds * 1_000) / 10) : 0,
    positionSeconds,
    durationSeconds,
    ...(jellyfinQuality(session, item) ? { quality: jellyfinQuality(session, item) } : {}),
    ...(artworkPath ? { artworkId: registerMediaArtwork(sourceKey, artworkPath) } : {}),
  };
}

function sessionIsPlaying(session: Record<string, unknown>): boolean {
  if (!session.NowPlayingItem || typeof session.NowPlayingItem !== "object") return false;
  const playState = session.PlayState && typeof session.PlayState === "object"
    ? session.PlayState as Record<string, unknown>
    : undefined;
  return playState?.IsPaused !== true;
}

function sessionIsPaused(session: Record<string, unknown>): boolean {
  if (!session.NowPlayingItem || typeof session.NowPlayingItem !== "object") return false;
  const playState = session.PlayState && typeof session.PlayState === "object"
    ? session.PlayState as Record<string, unknown>
    : undefined;
  return playState?.IsPaused === true;
}

async function loadJellyfin(config: JellyfinConfig, credentials: JellyfinCredentials): Promise<JellyfinPayload> {
  const jellyfinUrl = baseUrl(config.url);
  const sourceKey = cacheKey(config, credentials);
  const [systemData, countData, sessionData] = await Promise.all([
    request(`${jellyfinUrl}/System/Info`, credentials),
    request(`${jellyfinUrl}/Items/Counts`, credentials),
    request(`${jellyfinUrl}/Sessions`, credentials),
  ]);
  const system = objectValue(systemData, "Jellyfin returned an invalid system response.");
  const counts = objectValue(countData, "Jellyfin returned an invalid library response.");
  if (!Array.isArray(sessionData)) throw new Error("Jellyfin returned an invalid sessions response.");
  const sessions = sessionData.filter((item): item is Record<string, unknown> => (
    Boolean(item) && typeof item === "object" && !Array.isArray(item)
  ));
  const activeSessions = sessions.flatMap((session, index) => {
    const activity = activitySession(session, sourceKey, index);
    return activity ? [activity] : [];
  });

  return {
    server: {
      name: stringValue(system.ServerName) || "Jellyfin",
      version: stringValue(system.Version),
      operatingSystem: stringValue(system.OperatingSystem),
      pendingRestart: system.HasPendingRestart === true,
    },
    sessions: {
      connected: sessions.length,
      playing: sessions.filter(sessionIsPlaying).length,
      paused: sessions.filter(sessionIsPaused).length,
      transcoding: sessions.filter((session) => (
        Boolean(session.TranscodingInfo) && typeof session.TranscodingInfo === "object"
      )).length,
    },
    library: {
      movies: countValue(counts.MovieCount),
      series: countValue(counts.SeriesCount),
      episodes: countValue(counts.EpisodeCount),
      songs: countValue(counts.SongCount),
    },
    activity: {
      active: activeSessions.length,
      sessions: activeSessions.slice(0, MAX_ACTIVITY_SESSIONS),
      truncated: activeSessions.length > MAX_ACTIVITY_SESSIONS,
    },
    updatedAt: new Date().toISOString(),
  };
}

function cacheKey(config: JellyfinConfig, credentials: JellyfinCredentials): string {
  const tokenHash = createHash("sha256").update(credentials.apiKey).digest("hex");
  return `${baseUrl(config.url)}\u0000${tokenHash}`;
}

export async function testJellyfinConnection(config: JellyfinConfig, credentials: JellyfinCredentials) {
  return { ok: true, ...(await loadJellyfin(config, credentials)) };
}

export async function fetchJellyfinPlugin(
  config: JellyfinConfig,
  credentials: JellyfinCredentials,
): Promise<JellyfinPayload> {
  const key = cacheKey(config, credentials);
  const cached = pluginCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await loadJellyfin(config, credentials);
  pluginCache.set(key, { value, expiresAt: Date.now() + PLUGIN_CACHE_TTL_MS });
  return value;
}

export async function fetchJellyfinArtwork(
  config: JellyfinConfig,
  credentials: JellyfinCredentials,
  artworkId: string,
): Promise<MediaArtwork> {
  const apiKey = credentials.apiKey.trim();
  if (!apiKey) throw new Error("Jellyfin API key is not configured.");
  return fetchRegisteredMediaArtwork(cacheKey(config, credentials), artworkId, baseUrl(config.url), {
    Authorization: `MediaBrowser Token="${apiKey}"`,
  });
}

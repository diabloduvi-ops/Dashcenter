import { createHash } from "node:crypto";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CACHE_TTL_MS = 25_000;

export interface NginxProxyManagerConfig { url: string }
export interface NginxProxyManagerCredentials { identity: string; password: string }
export interface NginxProxyManagerPayload {
  proxyHosts: { total: number; enabled: number; online: number; offline: number; withSsl: number };
  redirectionHosts: { total: number; enabled: number; online: number };
  deadHosts: { total: number; enabled: number; online: number };
  streams: { total: number; enabled: number; online: number };
  updatedAt: string;
}

type NpmItem = Record<string, unknown>;

const cache = new Map<string, { value: NginxProxyManagerPayload; expiresAt: number }>();

function apiUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Nginx Proxy Manager URL must use http:// or https://.");
  }
  if (url.username || url.password) throw new Error("Do not include credentials in the Nginx Proxy Manager URL.");
  const normalized = url.toString().replace(/\/$/, "");
  return normalized.endsWith("/api") ? normalized : `${normalized}/api`;
}

async function responseJson(response: Response, label: string): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Nginx Proxy Manager returned too much data.");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Nginx Proxy Manager returned too much data.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Nginx Proxy Manager returned invalid ${label} data.`);
  }
}

async function login(config: NginxProxyManagerConfig, credentials: NginxProxyManagerCredentials): Promise<string> {
  const identity = credentials.identity.trim();
  if (!identity || !credentials.password) throw new Error("Nginx Proxy Manager identity and password are required.");
  let response: Response;
  try {
    response = await fetch(`${apiUrl(config.url)}/tokens`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ identity, secret: credentials.password }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Could not reach Nginx Proxy Manager.");
  }
  const data = await responseJson(response, "authentication");
  if (response.status === 401 || response.status === 403 || !response.ok) {
    throw new Error("Nginx Proxy Manager authentication failed. Check the identity, password and URL.");
  }
  const token = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>).token : undefined;
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Nginx Proxy Manager requires an authentication token. Complete or disable two-factor authentication for this integration account.");
  }
  return token;
}

async function getItems(path: string, config: NginxProxyManagerConfig, token: string, label: string): Promise<NpmItem[]> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl(config.url)}/${path}`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Could not reach Nginx Proxy Manager.");
  }
  const data = await responseJson(response, label);
  if (response.status === 401 || response.status === 403) throw new Error("Nginx Proxy Manager authentication failed.");
  if (!response.ok) throw new Error(`Nginx Proxy Manager request failed with status ${response.status}.`);
  if (!Array.isArray(data)) throw new Error(`Nginx Proxy Manager returned invalid ${label} data.`);
  return data.filter((item): item is NpmItem => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function enabled(item: NpmItem): boolean {
  return item.enabled === true || item.enabled === 1;
}

function online(item: NpmItem): boolean {
  const meta = item.meta;
  return enabled(item) && Boolean(meta && typeof meta === "object" && !Array.isArray(meta) && (meta as NpmItem).nginx_online === true);
}

function offline(item: NpmItem): boolean {
  if (!enabled(item)) return false;
  const meta = item.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  const values = meta as NpmItem;
  return values.nginx_online === false || (typeof values.nginx_err === "string" && values.nginx_err.trim().length > 0);
}

function summary(items: NpmItem[]) {
  return {
    total: items.length,
    enabled: items.filter(enabled).length,
    online: items.filter(online).length,
  };
}

async function load(config: NginxProxyManagerConfig, credentials: NginxProxyManagerCredentials): Promise<NginxProxyManagerPayload> {
  const token = await login(config, credentials);
  const [proxyHosts, redirectionHosts, deadHosts, streams] = await Promise.all([
    getItems("nginx/proxy-hosts", config, token, "proxy hosts"),
    getItems("nginx/redirection-hosts", config, token, "redirection hosts"),
    getItems("nginx/dead-hosts", config, token, "404 hosts"),
    getItems("nginx/streams", config, token, "streams"),
  ]);
  return {
    proxyHosts: {
      ...summary(proxyHosts),
      offline: proxyHosts.filter(offline).length,
      withSsl: proxyHosts.filter((item) => enabled(item) && typeof item.certificate_id === "number" && item.certificate_id > 0).length,
    },
    redirectionHosts: summary(redirectionHosts),
    deadHosts: summary(deadHosts),
    streams: summary(streams),
    updatedAt: new Date().toISOString(),
  };
}

function cacheKey(config: NginxProxyManagerConfig, credentials: NginxProxyManagerCredentials): string {
  const secret = createHash("sha256").update(`${credentials.identity}\u0000${credentials.password}`).digest("hex");
  return `${apiUrl(config.url)}\u0000${secret}`;
}

export async function testNginxProxyManagerConnection(config: NginxProxyManagerConfig, credentials: NginxProxyManagerCredentials) {
  return { ok: true, ...(await load(config, credentials)) };
}

export async function fetchNginxProxyManagerPlugin(config: NginxProxyManagerConfig, credentials: NginxProxyManagerCredentials): Promise<NginxProxyManagerPayload> {
  const key = cacheKey(config, credentials);
  const current = cache.get(key);
  if (current && current.expiresAt > Date.now()) return current.value;
  const value = await load(config, credentials);
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

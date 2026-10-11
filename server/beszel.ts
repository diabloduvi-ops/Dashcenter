const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TOKEN_TTL_MS = 20 * 60 * 1000;
const WIDGET_CACHE_TTL_MS = 25_000;

export interface BeszelConfig {
  url: string;
  version: 1 | 2;
  systemId?: string;
}

export interface BeszelCredentials {
  username: string;
  password: string;
}

interface BeszelSystem {
  id: string;
  name: string;
  status: "up" | "down" | "paused" | "pending";
  updated?: string;
  info?: {
    cpu?: number;
    mp?: number;
    dp?: number;
    bb?: number;
  };
}

interface SystemsResponse {
  items: BeszelSystem[];
  totalItems?: number;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const widgetCache = new Map<string, { value: unknown; expiresAt: number }>();

function baseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Beszel URL must use http:// or https://.");
  if (url.username || url.password) throw new Error("Do not include credentials in the Beszel URL.");
  return url.toString().replace(/\/$/, "");
}

async function responseJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Beszel returned too much data.");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Beszel returned too much data.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Beszel returned an invalid response.");
  }
}

async function request(url: string, init: RequestInit): Promise<{ response: Response; data: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new Error("Could not reach Beszel.");
  }
  const data = await responseJson(response);
  return { response, data };
}

function cacheKey(config: BeszelConfig, credentials: BeszelCredentials): string {
  return `${baseUrl(config.url)}\u0000${config.version}\u0000${credentials.username}`;
}

async function login(config: BeszelConfig, credentials: BeszelCredentials): Promise<string> {
  if (!credentials.username.trim() || !credentials.password) throw new Error("Beszel credentials are not configured.");
  const endpoint = config.version === 1
    ? "admins/auth-with-password"
    : "collections/_superusers/auth-with-password";
  const { response, data } = await request(`${baseUrl(config.url)}/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: credentials.username.trim(), password: credentials.password }),
  });
  const token = typeof data === "object" && data && "token" in data ? String(data.token ?? "") : "";
  if (!response.ok || !token) throw new Error("Beszel authentication failed. Check the superuser account and selected version.");
  tokenCache.set(cacheKey(config, credentials), { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

async function systems(config: BeszelConfig, credentials: BeszelCredentials, forceLogin = false): Promise<SystemsResponse> {
  const key = cacheKey(config, credentials);
  const cached = tokenCache.get(key);
  let token = !forceLogin && cached && cached.expiresAt > Date.now() ? cached.token : await login(config, credentials);
  const load = () => request(
    `${baseUrl(config.url)}/api/collections/systems/records?page=1&perPage=500&sort=%2Bcreated`,
    { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  );
  let result = await load();
  if (result.response.status === 400 || result.response.status === 401 || result.response.status === 403) {
    tokenCache.delete(key);
    token = await login(config, credentials);
    result = await load();
  }
  if (!result.response.ok) throw new Error("Beszel could not return system data.");
  if (!result.data || typeof result.data !== "object" || !("items" in result.data) || !Array.isArray(result.data.items)) {
    throw new Error("Beszel returned an invalid systems response.");
  }
  return result.data as SystemsResponse;
}

export async function testBeszelConnection(config: BeszelConfig, credentials: BeszelCredentials) {
  const data = await systems(config, credentials, true);
  return {
    ok: true,
    systems: data.items.map((system) => ({ id: system.id, name: system.name, status: system.status })),
    total: data.totalItems ?? data.items.length,
    up: data.items.filter((system) => system.status === "up").length,
  };
}

export async function fetchBeszelWidget(config: BeszelConfig, credentials: BeszelCredentials) {
  const key = `${cacheKey(config, credentials)}\u0000${config.systemId?.trim() ?? ""}`;
  const cached = widgetCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as Awaited<ReturnType<typeof createWidgetPayload>>;
  const data = await systems(config, credentials);
  const value = createWidgetPayload(config, data);
  widgetCache.set(key, { value, expiresAt: Date.now() + WIDGET_CACHE_TTL_MS });
  return value;
}

function createWidgetPayload(config: BeszelConfig, data: SystemsResponse) {
  const selected = config.systemId?.trim()
    ? data.items.find((system) => system.id === config.systemId || system.name === config.systemId)
    : undefined;
  if (config.systemId?.trim() && !selected) throw new Error("The selected Beszel system was not found.");
  if (!selected) {
    return {
      mode: "overview" as const,
      systems: data.totalItems ?? data.items.length,
      up: data.items.filter((system) => system.status === "up").length,
      updatedAt: new Date().toISOString(),
    };
  }
  return {
    mode: "system" as const,
    system: {
      id: selected.id,
      name: selected.name,
      status: selected.status,
      updated: selected.updated ?? "",
      cpu: Number(selected.info?.cpu ?? 0),
      memory: Number(selected.info?.mp ?? 0),
      disk: Number(selected.info?.dp ?? 0),
      network: Number(selected.info?.bb ?? 0),
    },
    updatedAt: new Date().toISOString(),
  };
}

import { fetchWithoutRedirect } from "./credentialed-fetch.js";
import { createHash } from "node:crypto";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PLUGIN_CACHE_TTL_MS = 25_000;

export interface PortainerConfig {
  url: string;
  endpointId?: string;
}

export interface PortainerCredentials {
  apiKey: string;
}

interface PortainerEndpoint {
  Id: number;
  Name: string;
  Status?: number;
}

interface DockerContainer {
  State?: string;
  Status?: string;
}

interface PortainerStack {
  EndpointId?: number;
}

interface ContainerMetrics {
  total: number;
  running: number;
  healthy: number;
  stopped: number;
}

const pluginCache = new Map<string, { value: PortainerPayload; expiresAt: number }>();

function baseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Portainer URL must use http:// or https://.");
  }
  if (url.username || url.password) throw new Error("Do not include credentials in the Portainer URL.");
  return url.toString().replace(/\/$/, "");
}

async function responseJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Portainer returned too much data.");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Portainer returned too much data.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Portainer returned an invalid response.");
  }
}

async function request(url: string, credentials: PortainerCredentials): Promise<unknown> {
  const apiKey = credentials.apiKey.trim();
  if (!apiKey) throw new Error("Portainer access token is not configured.");
  let response: Response;
  try {
    response = await fetchWithoutRedirect(url, {
      method: "GET",
      headers: { Accept: "application/json", "X-API-Key": apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Could not reach Portainer.");
  }
  const data = await responseJson(response);
  if (response.status === 401 || response.status === 403) {
    throw new Error("Portainer authentication failed. Check the access token and its permissions.");
  }
  if (!response.ok) throw new Error(`Portainer request failed with status ${response.status}.`);
  return data;
}

function endpointStatus(endpoint: PortainerEndpoint): "up" | "down" | "unknown" {
  if (endpoint.Status === 1) return "up";
  if (endpoint.Status === 2) return "down";
  return "unknown";
}

async function endpoints(config: PortainerConfig, credentials: PortainerCredentials): Promise<PortainerEndpoint[]> {
  const data = await request(`${baseUrl(config.url)}/api/endpoints`, credentials);
  if (!Array.isArray(data)) throw new Error("Portainer returned an invalid environments response.");
  return data.filter((item): item is PortainerEndpoint => (
    typeof item === "object" && item !== null && Number.isInteger((item as PortainerEndpoint).Id)
  ));
}

export async function testPortainerConnection(config: PortainerConfig, credentials: PortainerCredentials) {
  const items = await endpoints(config, credentials);
  return {
    ok: true,
    endpoints: items.map((endpoint) => ({
      id: String(endpoint.Id),
      name: endpoint.Name || `Environment ${endpoint.Id}`,
      status: endpointStatus(endpoint),
    })),
    total: items.length,
    online: items.filter((endpoint) => endpoint.Status === 1).length,
  };
}

export type PortainerPayload =
  | {
      mode: "overview";
      endpoints: number;
      online: number;
      inspected: number;
      containers: ContainerMetrics;
      stacks: number;
      updatedAt: string;
    }
  | {
      mode: "endpoint";
      endpoint: { id: string; name: string; status: "up" | "down" | "unknown" };
      containers: { total: number; running: number; healthy: number; stopped: number };
      stacks: number;
      updatedAt: string;
    };

function summarizeContainers(containers: DockerContainer[]): ContainerMetrics {
  const running = containers.filter((container) => container.State === "running").length;
  return {
    total: containers.length,
    running,
    healthy: containers.filter((container) => /\(healthy\)/i.test(container.Status ?? "")).length,
    stopped: containers.length - running,
  };
}

function cacheKey(config: PortainerConfig, credentials: PortainerCredentials): string {
  const tokenHash = createHash("sha256").update(credentials.apiKey).digest("hex");
  return `${baseUrl(config.url)}\u0000${config.endpointId?.trim() ?? ""}\u0000${tokenHash}`;
}

export async function fetchPortainerPlugin(
  config: PortainerConfig,
  credentials: PortainerCredentials,
): Promise<PortainerPayload> {
  const key = cacheKey(config, credentials);
  const cached = pluginCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const availableEndpoints = await endpoints(config, credentials);
  const selectedId = config.endpointId?.trim() ?? "";
  const portainerUrl = baseUrl(config.url);
  let value: PortainerPayload;
  if (!selectedId) {
    const onlineEndpoints = availableEndpoints.filter((endpoint) => endpoint.Status === 1);
    const [stackResult, ...containerResults] = await Promise.allSettled([
      request(`${portainerUrl}/api/stacks`, credentials),
      ...onlineEndpoints.map((endpoint) => request(
        `${portainerUrl}/api/endpoints/${encodeURIComponent(String(endpoint.Id))}/docker/containers/json?all=true`,
        credentials,
      )),
    ]);
    const inspectedContainers = containerResults.flatMap((result) => (
      result.status === "fulfilled" && Array.isArray(result.value)
        ? result.value as DockerContainer[]
        : []
    ));
    const inspected = containerResults.filter((result) => (
      result.status === "fulfilled" && Array.isArray(result.value)
    )).length;
    const stackData = stackResult?.status === "fulfilled" && Array.isArray(stackResult.value)
      ? stackResult.value as PortainerStack[]
      : [];
    const visibleEndpointIds = new Set(availableEndpoints.map((endpoint) => endpoint.Id));
    value = {
      mode: "overview",
      endpoints: availableEndpoints.length,
      online: onlineEndpoints.length,
      inspected,
      containers: summarizeContainers(inspectedContainers),
      stacks: stackData.filter((stack) => (
        stack.EndpointId === undefined || visibleEndpointIds.has(stack.EndpointId)
      )).length,
      updatedAt: new Date().toISOString(),
    };
  } else {
    const selected = availableEndpoints.find((endpoint) => String(endpoint.Id) === selectedId);
    if (!selected) throw new Error("The selected Portainer environment was not found.");
    const encodedId = encodeURIComponent(String(selected.Id));
    const [containerData, stackData] = await Promise.all([
      request(`${portainerUrl}/api/endpoints/${encodedId}/docker/containers/json?all=true`, credentials),
      request(`${portainerUrl}/api/stacks?endpointId=${encodedId}`, credentials),
    ]);
    if (!Array.isArray(containerData)) throw new Error("Portainer returned an invalid containers response.");
    if (!Array.isArray(stackData)) throw new Error("Portainer returned an invalid stacks response.");
    const containers = containerData as DockerContainer[];
    const stacks = (stackData as PortainerStack[]).filter((stack) => (
      stack.EndpointId === undefined || String(stack.EndpointId) === selectedId
    ));
    value = {
      mode: "endpoint",
      endpoint: {
        id: selectedId,
        name: selected.Name || `Environment ${selected.Id}`,
        status: endpointStatus(selected),
      },
      containers: summarizeContainers(containers),
      stacks: stacks.length,
      updatedAt: new Date().toISOString(),
    };
  }
  pluginCache.set(key, { value, expiresAt: Date.now() + PLUGIN_CACHE_TTL_MS });
  return value;
}

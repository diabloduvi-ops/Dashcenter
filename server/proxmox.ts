import { createHash } from "node:crypto";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CACHE_TTL_MS = 25_000;

export interface ProxmoxConfig {
  url: string;
  node?: string;
}

export interface ProxmoxCredentials {
  tokenId: string;
  tokenSecret: string;
}

export interface ProxmoxPayload {
  cluster: { name: string; version: string };
  scope: { node: string };
  nodes: { total: number; online: number; offline: number };
  guests: { total: number; running: number; stopped: number; virtualMachines: number; containers: number };
  resources: {
    cpuUsedPercent: number;
    memoryUsed: number;
    memoryTotal: number;
    memoryUsedPercent: number;
    storageUsed: number;
    storageTotal: number;
    storageUsedPercent: number;
  };
  updatedAt: string;
}

export interface ProxmoxConnectionResult extends ProxmoxPayload {
  ok: true;
  availableNodes: Array<{ id: string; name: string; status: string }>;
}

type ProxmoxRecord = Record<string, unknown>;

const cache = new Map<string, { value: ProxmoxPayload; expiresAt: number }>();

function apiUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Proxmox URL must use http:// or https://.");
  }
  if (url.username || url.password) throw new Error("Do not include credentials in the Proxmox URL.");
  const normalized = url.toString().replace(/\/$/, "");
  if (/\/api2\/json$/i.test(normalized)) return normalized;
  return `${normalized}/api2/json`;
}

async function responseJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Proxmox returned too much data.");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Proxmox returned too much data.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Proxmox returned an invalid response.");
  }
}

function dataValue(value: unknown, label: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("data" in value)) {
    throw new Error(`Proxmox returned invalid ${label} data.`);
  }
  return (value as ProxmoxRecord).data;
}

async function request(path: string, config: ProxmoxConfig, credentials: ProxmoxCredentials): Promise<unknown> {
  const tokenId = credentials.tokenId.trim();
  const tokenSecret = credentials.tokenSecret.trim();
  if (!tokenId || !tokenSecret) throw new Error("Proxmox API token ID and secret are required.");
  let response: Response;
  try {
    response = await fetch(`${apiUrl(config.url)}/${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Could not reach Proxmox. Check the URL, TLS certificate and network access.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("Proxmox authentication failed. Check the API token and PVEAuditor permissions.");
  }
  if (!response.ok) throw new Error(`Proxmox request failed with status ${response.status}.`);
  return dataValue(await responseJson(response), path === "version" ? "version" : "resource");
}

function records(value: unknown): ProxmoxRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ProxmoxRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function objectValue(value: unknown): ProxmoxRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ProxmoxRecord : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || (typeof value === "string" && ["1", "true", "yes"].includes(value.toLowerCase()));
}

function percent(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round(Math.max(0, Math.min(100, (used / total) * 100)) * 10) / 10;
}

function resourceNode(resource: ProxmoxRecord): string {
  return stringValue(resource.node || (resource.type === "node" ? resource.name : ""));
}

function storageRecords(resources: ProxmoxRecord[], node: string): ProxmoxRecord[] {
  const storage = resources.filter((resource) => resource.type === "storage" && (!node || resourceNode(resource) === node));
  const unique = new Map<string, ProxmoxRecord>();
  for (const item of storage) {
    const storageId = stringValue(item.storage || item.id);
    const key = booleanValue(item.shared) ? `shared:${storageId}` : `${resourceNode(item)}:${storageId}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

function summarize(
  versionData: unknown,
  statusData: unknown,
  resourceData: unknown,
  config: ProxmoxConfig,
): { payload: ProxmoxPayload; availableNodes: ProxmoxConnectionResult["availableNodes"] } {
  const version = objectValue(versionData);
  const status = records(statusData);
  const resources = records(resourceData);
  const allNodes = resources.filter((resource) => resource.type === "node");
  if (allNodes.length === 0) {
    throw new Error("Proxmox returned no visible nodes. Grant the API token PVEAuditor access to at least one node.");
  }
  const selectedNode = config.node?.trim() ?? "";
  if (selectedNode && !allNodes.some((node) => resourceNode(node) === selectedNode)) {
    throw new Error(`Proxmox node “${selectedNode}” is not available to this API token.`);
  }
  const nodes = selectedNode ? allNodes.filter((node) => resourceNode(node) === selectedNode) : allNodes;
  const guests = resources.filter((resource) => (
    (resource.type === "qemu" || resource.type === "lxc") && (!selectedNode || resourceNode(resource) === selectedNode)
  ));
  const storage = storageRecords(resources, selectedNode);
  const cpuTotal = nodes.reduce((total, node) => total + numberValue(node.maxcpu), 0);
  const cpuUsed = nodes.reduce((total, node) => total + numberValue(node.cpu) * numberValue(node.maxcpu), 0);
  const memoryUsed = nodes.reduce((total, node) => total + numberValue(node.mem), 0);
  const memoryTotal = nodes.reduce((total, node) => total + numberValue(node.maxmem), 0);
  const storageUsed = storage.reduce((total, item) => total + numberValue(item.disk), 0);
  const storageTotal = storage.reduce((total, item) => total + numberValue(item.maxdisk), 0);
  const clusterRecord = status.find((item) => item.type === "cluster");
  const payload: ProxmoxPayload = {
    cluster: {
      name: stringValue(clusterRecord?.name) || (selectedNode || "Proxmox"),
      version: stringValue(version.version || version.release),
    },
    scope: { node: selectedNode },
    nodes: {
      total: nodes.length,
      online: nodes.filter((node) => stringValue(node.status).toLowerCase() === "online").length,
      offline: nodes.filter((node) => stringValue(node.status).toLowerCase() !== "online").length,
    },
    guests: {
      total: guests.length,
      running: guests.filter((guest) => stringValue(guest.status).toLowerCase() === "running").length,
      stopped: guests.filter((guest) => stringValue(guest.status).toLowerCase() !== "running").length,
      virtualMachines: guests.filter((guest) => guest.type === "qemu").length,
      containers: guests.filter((guest) => guest.type === "lxc").length,
    },
    resources: {
      cpuUsedPercent: percent(cpuUsed, cpuTotal),
      memoryUsed,
      memoryTotal,
      memoryUsedPercent: percent(memoryUsed, memoryTotal),
      storageUsed,
      storageTotal,
      storageUsedPercent: percent(storageUsed, storageTotal),
    },
    updatedAt: new Date().toISOString(),
  };
  const availableNodes = allNodes.map((node) => ({
    id: resourceNode(node),
    name: resourceNode(node),
    status: stringValue(node.status).toLowerCase() || "unknown",
  })).filter((node) => node.id).sort((a, b) => a.name.localeCompare(b.name));
  return { payload, availableNodes };
}

async function load(config: ProxmoxConfig, credentials: ProxmoxCredentials) {
  const [version, status, resources] = await Promise.all([
    request("version", config, credentials),
    request("cluster/status", config, credentials),
    request("cluster/resources", config, credentials),
  ]);
  return summarize(version, status, resources, config);
}

function cacheKey(config: ProxmoxConfig, credentials: ProxmoxCredentials): string {
  const secretHash = createHash("sha256")
    .update(`${credentials.tokenId}\u0000${credentials.tokenSecret}`)
    .digest("hex");
  return `${apiUrl(config.url)}\u0000${config.node?.trim() ?? ""}\u0000${secretHash}`;
}

export async function testProxmoxConnection(
  config: ProxmoxConfig,
  credentials: ProxmoxCredentials,
): Promise<ProxmoxConnectionResult> {
  const { payload, availableNodes } = await load(config, credentials);
  return { ok: true, ...payload, availableNodes };
}

export async function fetchProxmoxPlugin(
  config: ProxmoxConfig,
  credentials: ProxmoxCredentials,
): Promise<ProxmoxPayload> {
  const key = cacheKey(config, credentials);
  const current = cache.get(key);
  if (current && current.expiresAt > Date.now()) return current.value;
  const { payload } = await load(config, credentials);
  cache.set(key, { value: payload, expiresAt: Date.now() + CACHE_TTL_MS });
  return payload;
}

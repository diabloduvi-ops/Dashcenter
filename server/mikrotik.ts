import { createHash } from "node:crypto";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CACHE_TTL_MS = 25_000;
const MAX_TRAFFIC_SAMPLES = 120;
const MAX_TRAFFIC_SOURCES = 256;
const MAX_SAMPLE_GAP_MS = 5 * 60 * 1_000;

export interface MikrotikConfig { url: string; interfaceName?: string }
export interface MikrotikCredentials { username: string; password: string }
export interface MikrotikInterfaceOption {
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
}
export interface MikrotikTrafficSample {
  at: string;
  downloadBitsPerSecond: number;
  uploadBitsPerSecond: number;
}
export interface MikrotikTraffic {
  interfaceName: string;
  interfaceType: string;
  running: boolean;
  status: "unconfigured" | "warming-up" | "ready" | "unavailable";
  downloadBitsPerSecond: number | null;
  uploadBitsPerSecond: number | null;
  samples: MikrotikTrafficSample[];
  maxSamples: number;
  sampleIntervalSeconds: number;
}
export interface MikrotikPayload {
  router: {
    name: string;
    boardName: string;
    platform: string;
    version: string;
    architecture: string;
  };
  system: {
    uptime: string;
    cpuLoad: number;
    cpuCount: number;
    memoryUsed: number;
    memoryTotal: number;
    memoryUsedPercent: number;
    storageUsed: number;
    storageTotal: number;
    storageUsedPercent: number;
  };
  dhcp: { leases: number; active: number };
  interfaces: { total: number; running: number; disabled: number };
  traffic: MikrotikTraffic;
  updatedAt: string;
}

interface InterfaceRecord extends MikrotikInterfaceOption {
  rxBytes?: bigint;
  txBytes?: bigint;
}

interface TrafficSeries {
  previous?: { at: number; rxBytes: bigint; txBytes: bigint };
  samples: MikrotikTrafficSample[];
  touchedAt: number;
}

const cache = new Map<string, { value: MikrotikPayload; expiresAt: number }>();
const pendingLoads = new Map<string, Promise<MikrotikPayload>>();
const trafficSeries = new Map<string, TrafficSeries>();

function restUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("MikroTik URL must use http:// or https://.");
  }
  if (url.username || url.password) throw new Error("Do not include credentials in the MikroTik URL.");
  const normalized = url.toString().replace(/\/$/, "");
  return /\/rest$/i.test(normalized) ? normalized : `${normalized}/rest`;
}

async function responseJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("MikroTik returned too much data.");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("MikroTik returned too much data.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("MikroTik returned an invalid response.");
  }
}

async function request(path: string, config: MikrotikConfig, credentials: MikrotikCredentials): Promise<unknown> {
  const username = credentials.username.trim();
  if (!username || !credentials.password) throw new Error("MikroTik username and password are not configured.");
  let response: Response;
  try {
    response = await fetch(`${restUrl(config.url)}/${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${username}:${credentials.password}`).toString("base64")}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Could not reach MikroTik. Check the URL, certificate and network access.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("MikroTik authentication failed. Check the read-only user and password.");
  }
  if (!response.ok) throw new Error(`MikroTik request failed with status ${response.status}.`);
  return responseJson(response);
}

function records(value: unknown): Record<string, unknown>[] {
  const values = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  return values.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function firstRecord(value: unknown, label: string): Record<string, unknown> {
  const record = records(value)[0];
  if (!record) throw new Error(`MikroTik returned an invalid ${label} response.`);
  return record;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function counterValue(value: unknown): bigint | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function booleanValue(value: unknown): boolean {
  return value === true || (typeof value === "string" && value.toLocaleLowerCase() === "true");
}

function usedPercent(total: number, free: number): number {
  if (total <= 0) return 0;
  return Math.round(Math.max(0, Math.min(100, ((total - free) / total) * 100)) * 10) / 10;
}

function interfaceRecords(value: unknown): InterfaceRecord[] {
  return records(value).flatMap((item) => {
    const name = stringValue(item.name).trim();
    if (!name) return [];
    return [{
      name,
      type: stringValue(item.type),
      running: booleanValue(item.running),
      disabled: booleanValue(item.disabled),
      rxBytes: counterValue(item["rx-byte"]),
      txBytes: counterValue(item["tx-byte"]),
    }];
  });
}

function sourceKey(config: MikrotikConfig, credentials: MikrotikCredentials): string {
  const credentialsHash = createHash("sha256")
    .update(`${credentials.username}\u0000${credentials.password}`)
    .digest("hex");
  return `${restUrl(config.url)}\u0000${credentialsHash}\u0000${config.interfaceName?.trim() ?? ""}`;
}

function pruneTrafficSeries(): void {
  if (trafficSeries.size <= MAX_TRAFFIC_SOURCES) return;
  const oldest = [...trafficSeries.entries()].sort((left, right) => left[1].touchedAt - right[1].touchedAt);
  for (const [key] of oldest.slice(0, trafficSeries.size - MAX_TRAFFIC_SOURCES)) trafficSeries.delete(key);
}

function trafficPayload(
  config: MikrotikConfig,
  credentials: MikrotikCredentials,
  interfaces: InterfaceRecord[],
  now: number,
  collect: boolean,
): MikrotikTraffic {
  const interfaceName = config.interfaceName?.trim() ?? "";
  const base = {
    interfaceName,
    interfaceType: "",
    running: false,
    downloadBitsPerSecond: null,
    uploadBitsPerSecond: null,
    samples: [] as MikrotikTrafficSample[],
    maxSamples: MAX_TRAFFIC_SAMPLES,
    sampleIntervalSeconds: Math.round(CACHE_TTL_MS / 1_000),
  };
  if (!interfaceName) return { ...base, status: "unconfigured" };

  const selected = interfaces.find((item) => item.name === interfaceName);
  if (!selected || selected.disabled || selected.rxBytes === undefined || selected.txBytes === undefined) {
    return {
      ...base,
      interfaceType: selected?.type ?? "",
      running: Boolean(selected?.running && !selected.disabled),
      status: "unavailable",
    };
  }

  const key = sourceKey(config, credentials);
  const series = trafficSeries.get(key) ?? { samples: [], touchedAt: now };
  series.touchedAt = now;
  let status: MikrotikTraffic["status"] = series.samples.length ? "ready" : "warming-up";

  if (collect) {
    const previous = series.previous;
    const elapsed = previous ? now - previous.at : 0;
    const countersReset = Boolean(previous && (selected.rxBytes < previous.rxBytes || selected.txBytes < previous.txBytes));
    if (previous && elapsed >= 1_000 && elapsed <= MAX_SAMPLE_GAP_MS && !countersReset) {
      const downloadBitsPerSecond = Number((selected.rxBytes - previous.rxBytes) * 8_000n / BigInt(elapsed));
      const uploadBitsPerSecond = Number((selected.txBytes - previous.txBytes) * 8_000n / BigInt(elapsed));
      series.samples.push({
        at: new Date(now).toISOString(),
        downloadBitsPerSecond,
        uploadBitsPerSecond,
      });
      if (series.samples.length > MAX_TRAFFIC_SAMPLES) {
        series.samples.splice(0, series.samples.length - MAX_TRAFFIC_SAMPLES);
      }
      status = "ready";
    } else if (countersReset || elapsed > MAX_SAMPLE_GAP_MS) {
      series.samples = [];
      status = "warming-up";
    }
    series.previous = { at: now, rxBytes: selected.rxBytes, txBytes: selected.txBytes };
    trafficSeries.set(key, series);
    pruneTrafficSeries();
  }

  const latest = series.samples.at(-1);
  return {
    ...base,
    interfaceType: selected.type,
    running: selected.running && !selected.disabled,
    status,
    downloadBitsPerSecond: latest?.downloadBitsPerSecond ?? null,
    uploadBitsPerSecond: latest?.uploadBitsPerSecond ?? null,
    samples: [...series.samples],
  };
}

async function load(
  config: MikrotikConfig,
  credentials: MikrotikCredentials,
  collectTraffic: boolean,
): Promise<{ payload: MikrotikPayload; interfaceOptions: MikrotikInterfaceOption[] }> {
  const [resourceData, identityData, leaseData, interfaceData] = await Promise.all([
    request("system/resource?.proplist=architecture-name,board-name,cpu-count,cpu-load,free-hdd-space,free-memory,platform,total-hdd-space,total-memory,uptime,version", config, credentials),
    request("system/identity?.proplist=name", config, credentials),
    request("ip/dhcp-server/lease?.proplist=address,active-address,status,disabled", config, credentials),
    request("interface?.proplist=name,type,running,disabled,rx-byte,tx-byte", config, credentials),
  ]);
  const resource = firstRecord(resourceData, "system resource");
  const identity = firstRecord(identityData, "system identity");
  const leases = records(leaseData);
  const interfaces = interfaceRecords(interfaceData);
  const memoryTotal = numberValue(resource["total-memory"]);
  const memoryFree = numberValue(resource["free-memory"]);
  const storageTotal = numberValue(resource["total-hdd-space"]);
  const storageFree = numberValue(resource["free-hdd-space"]);
  const now = Date.now();

  return {
    interfaceOptions: interfaces.map(({ name, type, running, disabled }) => ({ name, type, running, disabled })),
    payload: {
      router: {
        name: stringValue(identity.name) || "MikroTik",
        boardName: stringValue(resource["board-name"]),
        platform: stringValue(resource.platform) || "MikroTik",
        version: stringValue(resource.version),
        architecture: stringValue(resource["architecture-name"]),
      },
      system: {
        uptime: stringValue(resource.uptime),
        cpuLoad: numberValue(resource["cpu-load"]),
        cpuCount: Math.floor(numberValue(resource["cpu-count"])),
        memoryUsed: Math.max(0, memoryTotal - memoryFree),
        memoryTotal,
        memoryUsedPercent: usedPercent(memoryTotal, memoryFree),
        storageUsed: Math.max(0, storageTotal - storageFree),
        storageTotal,
        storageUsedPercent: usedPercent(storageTotal, storageFree),
      },
      dhcp: {
        leases: leases.length,
        active: leases.filter((lease) => (
          !booleanValue(lease.disabled) && (
            stringValue(lease.status).toLocaleLowerCase() === "bound" || Boolean(stringValue(lease["active-address"]))
          )
        )).length,
      },
      interfaces: {
        total: interfaces.length,
        running: interfaces.filter((item) => item.running && !item.disabled).length,
        disabled: interfaces.filter((item) => item.disabled).length,
      },
      traffic: trafficPayload(config, credentials, interfaces, now, collectTraffic),
      updatedAt: new Date(now).toISOString(),
    },
  };
}

export async function testMikrotikConnection(config: MikrotikConfig, credentials: MikrotikCredentials) {
  const { payload, interfaceOptions } = await load(config, credentials, false);
  return { ok: true, ...payload, interfaceOptions };
}

export async function fetchMikrotikPlugin(config: MikrotikConfig, credentials: MikrotikCredentials): Promise<MikrotikPayload> {
  const key = sourceKey(config, credentials);
  const current = cache.get(key);
  if (current && current.expiresAt > Date.now()) return current.value;
  const pending = pendingLoads.get(key);
  if (pending) return pending;
  const next = load(config, credentials, true).then(({ payload }) => {
    cache.set(key, { value: payload, expiresAt: Date.now() + CACHE_TTL_MS });
    return payload;
  }).finally(() => {
    pendingLoads.delete(key);
  });
  pendingLoads.set(key, next);
  return next;
}

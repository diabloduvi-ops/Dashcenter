import { statfs } from "node:fs/promises";
import os from "node:os";
import type { DockerConnection } from "../shared/types.js";
import { listDockerContainers } from "./docker.js";

const CACHE_TTL_MS = 2_000;
const CONTAINER_CACHE_TTL_MS = 10_000;
export const SYSTEM_HISTORY_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const SYSTEM_HISTORY_SAMPLE_INTERVAL_MS = 5 * 60 * 1_000;
export const SYSTEM_HISTORY_MAX_SAMPLES = Math.ceil(
  SYSTEM_HISTORY_RETENTION_MS / SYSTEM_HISTORY_SAMPLE_INTERVAL_MS,
);

export interface CpuCounters {
  idle: number;
  total: number;
}

export interface SystemResourceHistorySample {
  sampledAt: string;
  cpuUsedPercent: number;
  memoryUsedPercent: number;
}

export interface SystemResourceContainerSummary {
  total: number;
  running: number;
  stopped: number;
  healthy: number;
  unhealthy: number;
}

export interface SystemResourcesPayload {
  cpu: { usedPercent: number; cores: number };
  memory: { usedBytes: number; totalBytes: number; usedPercent: number };
  disk: { usedBytes: number; totalBytes: number; usedPercent: number };
  loadAverage: { oneMinute: number; fiveMinutes: number; fifteenMinutes: number } | null;
  uptimeSeconds: number;
  updatedAt: string;
  history?: {
    scope: "process";
    retentionSeconds: number;
    sampleIntervalSeconds: number;
    samples: SystemResourceHistorySample[];
  };
  containers?: SystemResourceContainerSummary;
}

interface FetchSystemResourcesOptions {
  includeHistory?: boolean;
  dockerConnection?: DockerConnection;
}

type BaseSystemResourcesPayload = Omit<SystemResourcesPayload, "history" | "containers">;

const cache = new Map<string, { value: BaseSystemResourcesPayload; expiresAt: number }>();
const history = new Map<string, SystemResourceHistorySample[]>();
const containerCache = new Map<string, { value?: SystemResourceContainerSummary; expiresAt: number }>();

function boundedPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

function boundedLoad(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100) / 100;
}

function systemCpus() {
  try {
    return os.cpus();
  } catch {
    return [];
  }
}

function systemNumber(read: () => number): number {
  try {
    const value = read();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function systemLoadAverage(): SystemResourcesPayload["loadAverage"] {
  try {
    const values = os.loadavg();
    if (values.length < 3 || values.some((value) => !Number.isFinite(value) || value < 0)) return null;
    return {
      oneMinute: boundedLoad(values[0]),
      fiveMinutes: boundedLoad(values[1]),
      fifteenMinutes: boundedLoad(values[2]),
    };
  } catch {
    return null;
  }
}

function cpuCounters(cpus = systemCpus()): CpuCounters {
  return cpus.reduce<CpuCounters>((summary, cpu) => {
    const times = Object.values(cpu.times);
    summary.idle += cpu.times.idle;
    summary.total += times.reduce((sum, value) => sum + value, 0);
    return summary;
  }, { idle: 0, total: 0 });
}

export function calculateCpuUsedPercent(previous: CpuCounters, current: CpuCounters): number {
  const total = current.total - previous.total;
  const idle = current.idle - previous.idle;
  if (total <= 0) return 0;
  return boundedPercent((1 - idle / total) * 100);
}

let previousCpuCounters = cpuCounters();

async function diskUsage(dataDirectory: string) {
  let statistics;
  try {
    statistics = await statfs(dataDirectory);
  } catch {
    try {
      statistics = await statfs("/");
    } catch {
      return { usedBytes: 0, totalBytes: 0, usedPercent: 0 };
    }
  }
  const totalBytes = statistics.blocks * statistics.bsize;
  const freeBytes = statistics.bfree * statistics.bsize;
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  return {
    usedBytes,
    totalBytes,
    usedPercent: totalBytes > 0 ? boundedPercent(usedBytes / totalBytes * 100) : 0,
  };
}

export function appendSystemResourceHistory(
  current: readonly SystemResourceHistorySample[],
  sample: SystemResourceHistorySample,
  now = Date.parse(sample.sampledAt),
): SystemResourceHistorySample[] {
  const safeNow = Number.isFinite(now) ? now : Date.now();
  const cutoff = safeNow - SYSTEM_HISTORY_RETENTION_MS;
  const retained = current.filter((item) => {
    const timestamp = Date.parse(item.sampledAt);
    return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= safeNow;
  });
  const last = retained.at(-1);
  const lastTimestamp = last ? Date.parse(last.sampledAt) : Number.NaN;
  if (last && Number.isFinite(lastTimestamp) && safeNow - lastTimestamp < SYSTEM_HISTORY_SAMPLE_INTERVAL_MS) {
    retained[retained.length - 1] = sample;
  } else {
    retained.push(sample);
  }
  return retained.slice(-SYSTEM_HISTORY_MAX_SAMPLES);
}

export function selectSystemResourceDockerConnection(
  connections: readonly DockerConnection[],
  requestedId?: string,
): DockerConnection | undefined {
  const enabled = connections.filter((connection) => connection.enabled);
  if (requestedId) return enabled.find((connection) => connection.id === requestedId);
  return enabled.length === 1 ? enabled[0] : undefined;
}

async function fetchBaseSystemResources(dataDirectory: string): Promise<BaseSystemResourcesPayload> {
  const cached = cache.get(dataDirectory);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const cpus = systemCpus();
  const currentCpuCounters = cpuCounters(cpus);
  const cpuUsedPercent = calculateCpuUsedPercent(previousCpuCounters, currentCpuCounters);
  previousCpuCounters = currentCpuCounters;

  const totalMemory = Math.max(0, systemNumber(() => os.totalmem()));
  const freeMemory = Math.min(totalMemory, Math.max(0, systemNumber(() => os.freemem())));
  const usedMemory = Math.max(0, totalMemory - freeMemory);
  const updatedAt = new Date().toISOString();
  const value: BaseSystemResourcesPayload = {
    cpu: { usedPercent: cpuUsedPercent, cores: cpus.length },
    memory: {
      usedBytes: usedMemory,
      totalBytes: totalMemory,
      usedPercent: totalMemory > 0 ? boundedPercent(usedMemory / totalMemory * 100) : 0,
    },
    disk: await diskUsage(dataDirectory),
    loadAverage: systemLoadAverage(),
    uptimeSeconds: Math.max(0, Math.floor(systemNumber(() => os.uptime()))),
    updatedAt,
  };
  history.set(dataDirectory, appendSystemResourceHistory(history.get(dataDirectory) ?? [], {
    sampledAt: updatedAt,
    cpuUsedPercent: value.cpu.usedPercent,
    memoryUsedPercent: value.memory.usedPercent,
  }));
  cache.set(dataDirectory, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

async function fetchContainerSummary(connection: DockerConnection): Promise<SystemResourceContainerSummary | undefined> {
  const key = `${connection.id}\u0000${connection.type}\u0000${connection.endpoint}`;
  const cached = containerCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const containers = await listDockerContainers(connection);
    const value = {
      total: containers.length,
      running: containers.filter((container) => container.state === "running").length,
      stopped: containers.filter((container) => container.state !== "running").length,
      healthy: containers.filter((container) => container.health === "healthy").length,
      unhealthy: containers.filter((container) => container.health === "unhealthy").length,
    };
    containerCache.set(key, { value, expiresAt: Date.now() + CONTAINER_CACHE_TTL_MS });
    return value;
  } catch {
    containerCache.set(key, { expiresAt: Date.now() + CONTAINER_CACHE_TTL_MS });
    return undefined;
  }
}

export async function fetchSystemResources(
  dataDirectory: string,
  options: FetchSystemResourcesOptions = {},
): Promise<SystemResourcesPayload> {
  const value: SystemResourcesPayload = { ...(await fetchBaseSystemResources(dataDirectory)) };
  if (options.includeHistory) {
    value.history = {
      scope: "process",
      retentionSeconds: SYSTEM_HISTORY_RETENTION_MS / 1_000,
      sampleIntervalSeconds: SYSTEM_HISTORY_SAMPLE_INTERVAL_MS / 1_000,
      samples: [...(history.get(dataDirectory) ?? [])],
    };
  }
  if (options.dockerConnection) {
    const containers = await fetchContainerSummary(options.dockerConnection);
    if (containers) value.containers = containers;
  }
  return value;
}

export function clearSystemResourceCachesForTests(): void {
  cache.clear();
  history.clear();
  containerCache.clear();
  previousCpuCounters = cpuCounters();
}

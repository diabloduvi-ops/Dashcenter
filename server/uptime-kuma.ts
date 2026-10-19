import { fetchWithoutRedirect } from "./credentialed-fetch.js";
import { createHash } from "node:crypto";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const CACHE_TTL_MS = 25_000;

export interface UptimeKumaConfig {
  url: string;
  monitorId?: string;
}

export interface UptimeKumaCredentials {
  apiKey: string;
}

export type UptimeKumaMonitorStatus = "up" | "down" | "pending" | "maintenance" | "unknown";

export interface UptimeKumaMonitor {
  id: string;
  name: string;
  type: string;
  status: UptimeKumaMonitorStatus;
  responseTime: number | null;
  certificateDaysRemaining: number | null;
}

export interface UptimeKumaPayload {
  scope: { monitorId: string };
  monitors: { total: number; up: number; down: number; pending: number; maintenance: number; unknown: number };
  monitor?: UptimeKumaMonitor;
  updatedAt: string;
}

export interface UptimeKumaConnectionResult extends UptimeKumaPayload {
  ok: true;
  availableMonitors: UptimeKumaMonitor[];
}

interface MetricSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

const cache = new Map<string, { value: UptimeKumaPayload; expiresAt: number }>();

function metricsUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Uptime Kuma URL must use http:// or https://.");
  }
  if (url.username || url.password) throw new Error("Do not include credentials in the Uptime Kuma URL.");
  url.hash = "";
  url.search = "";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/metrics`.replace(/\/metrics\/metrics$/i, "/metrics");
  return url.toString();
}

function parseLabels(source: string): Record<string, string> | null {
  const labels: Record<string, string> = {};
  let index = 0;
  while (index < source.length) {
    while (source[index] === " " || source[index] === ",") index += 1;
    const keyMatch = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(source.slice(index));
    if (!keyMatch) return null;
    const key = keyMatch[0];
    index += key.length;
    while (source[index] === " ") index += 1;
    if (source[index] !== "=") return null;
    index += 1;
    while (source[index] === " ") index += 1;
    if (source[index] !== '"') return null;
    index += 1;
    let value = "";
    let closed = false;
    while (index < source.length) {
      const character = source[index];
      index += 1;
      if (character === '"') {
        closed = true;
        break;
      }
      if (character !== "\\") {
        value += character;
        continue;
      }
      if (index >= source.length) return null;
      const escaped = source[index];
      index += 1;
      value += escaped === "n" ? "\n" : escaped;
    }
    if (!closed) return null;
    labels[key] = value;
    while (source[index] === " ") index += 1;
    if (index < source.length && source[index] !== ",") return null;
  }
  return labels;
}

function parseMetrics(text: string): MetricSample[] {
  const samples: MetricSample[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+([^\s]+)(?:\s+\d+)?$/.exec(line);
    if (!match) continue;
    const labels = match[2] ? parseLabels(match[2]) : {};
    const value = Number(match[3]);
    if (!labels || !Number.isFinite(value)) continue;
    samples.push({ name: match[1], labels, value });
  }
  return samples;
}

function monitorIdentity(labels: Record<string, string>): string {
  return ["monitor_name", "monitor_type", "monitor_url", "monitor_hostname", "monitor_port"]
    .map((key) => labels[key] ?? "")
    .join("\u0000");
}

function monitorId(labels: Record<string, string>): string {
  return createHash("sha256").update(monitorIdentity(labels)).digest("hex").slice(0, 24);
}

function monitorStatus(value: number): UptimeKumaMonitorStatus {
  if (value === 1) return "up";
  if (value === 0) return "down";
  if (value === 2) return "pending";
  if (value === 3) return "maintenance";
  return "unknown";
}

function rounded(value: number): number {
  return Math.round(Math.max(0, value) * 10) / 10;
}

function summarize(samples: MetricSample[], config: UptimeKumaConfig) {
  const statusSamples = samples.filter((sample) => sample.name === "monitor_status" && sample.labels.monitor_name);
  if (statusSamples.length === 0) {
    throw new Error("Uptime Kuma returned no monitor_status metrics. Check the API key and whether monitors are visible.");
  }
  const responseTimes = new Map<string, number>();
  const certificateDays = new Map<string, number>();
  for (const sample of samples) {
    const identity = monitorIdentity(sample.labels);
    if (sample.name === "monitor_response_time") responseTimes.set(identity, rounded(sample.value));
    if (sample.name === "monitor_cert_days_remaining") certificateDays.set(identity, rounded(sample.value));
  }
  const unique = new Map<string, UptimeKumaMonitor>();
  for (const sample of statusSamples) {
    const identity = monitorIdentity(sample.labels);
    const id = monitorId(sample.labels);
    unique.set(id, {
      id,
      name: sample.labels.monitor_name,
      type: sample.labels.monitor_type || "unknown",
      status: monitorStatus(sample.value),
      responseTime: responseTimes.get(identity) ?? null,
      certificateDaysRemaining: certificateDays.get(identity) ?? null,
    });
  }
  const availableMonitors = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
  const selectedId = config.monitorId?.trim() ?? "";
  const selected = selectedId ? unique.get(selectedId) : undefined;
  if (selectedId && !selected) throw new Error("The selected Uptime Kuma monitor is no longer available. Test the connection and select it again.");
  const payload: UptimeKumaPayload = {
    scope: { monitorId: selectedId },
    monitors: {
      total: availableMonitors.length,
      up: availableMonitors.filter((monitor) => monitor.status === "up").length,
      down: availableMonitors.filter((monitor) => monitor.status === "down").length,
      pending: availableMonitors.filter((monitor) => monitor.status === "pending").length,
      maintenance: availableMonitors.filter((monitor) => monitor.status === "maintenance").length,
      unknown: availableMonitors.filter((monitor) => monitor.status === "unknown").length,
    },
    ...(selected ? { monitor: selected } : {}),
    updatedAt: new Date().toISOString(),
  };
  return { payload, availableMonitors };
}

async function load(config: UptimeKumaConfig, credentials: UptimeKumaCredentials) {
  const apiKey = credentials.apiKey.trim();
  if (!apiKey) throw new Error("Uptime Kuma API key is required.");
  let response: Response;
  try {
    response = await fetchWithoutRedirect(metricsUrl(config.url), {
      method: "GET",
      headers: {
        Accept: "text/plain",
        Authorization: `Basic ${Buffer.from(`:${apiKey}`, "utf8").toString("base64")}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Could not reach Uptime Kuma. Check the URL, TLS certificate and network access.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("Uptime Kuma authentication failed. Check that the Prometheus API key is active.");
  }
  if (!response.ok) throw new Error(`Uptime Kuma request failed with status ${response.status}.`);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Uptime Kuma returned too much metrics data.");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Uptime Kuma returned too much metrics data.");
  return summarize(parseMetrics(text), config);
}

function cacheKey(config: UptimeKumaConfig, credentials: UptimeKumaCredentials): string {
  const secretHash = createHash("sha256").update(credentials.apiKey).digest("hex");
  return `${metricsUrl(config.url)}\u0000${config.monitorId?.trim() ?? ""}\u0000${secretHash}`;
}

export async function testUptimeKumaConnection(
  config: UptimeKumaConfig,
  credentials: UptimeKumaCredentials,
): Promise<UptimeKumaConnectionResult> {
  const { payload, availableMonitors } = await load(config, credentials);
  return { ok: true, ...payload, availableMonitors };
}

export async function fetchUptimeKumaPlugin(
  config: UptimeKumaConfig,
  credentials: UptimeKumaCredentials,
): Promise<UptimeKumaPayload> {
  const key = cacheKey(config, credentials);
  const current = cache.get(key);
  if (current && current.expiresAt > Date.now()) return current.value;
  const { payload } = await load(config, credentials);
  cache.set(key, { value: payload, expiresAt: Date.now() + CACHE_TTL_MS });
  return payload;
}

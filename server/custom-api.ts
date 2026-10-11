import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { DashboardWidget } from "../shared/types.js";
import { isHttpUrl } from "./homepage-yaml.js";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const BLOCKED_PATH_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const cache = new Map<string, { expiresAt: number; response: CustomApiResponse }>();

export interface CustomApiResponse {
  label: string;
  value: unknown;
  updatedAt: string;
}

function normalizedHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isPrivateIp(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  if (isIP(address) !== 6) return true;
  const value = address.toLowerCase();
  if (value.startsWith("::ffff:")) return isPrivateIpv4(value.slice("::ffff:".length));
  return (
    value === "::" ||
    value === "::1" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe8") ||
    value.startsWith("fe9") ||
    value.startsWith("fea") ||
    value.startsWith("feb") ||
    value.startsWith("2001:db8:")
  );
}

async function validateTarget(target: URL, allowedPrivateHosts: string[]): Promise<void> {
  const hostname = normalizedHost(target.hostname);
  const allowlisted = allowedPrivateHosts.map(normalizedHost).includes(hostname);
  if (allowlisted) return;
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal" ||
    hostname === "instance-data.ec2.internal"
  ) {
    throw new Error("The custom API target is private. Add its exact host to allowPrivateHosts to allow it.");
  }

  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error("The custom API target is private. Add its exact host to allowPrivateHosts to allow it.");
    }
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("The custom API host resolves to a private address and is not allowlisted.");
  }
}

function extractPath(value: unknown, dotPath: string): unknown {
  if (!dotPath.trim()) return value;
  let current = value;
  for (const segment of dotPath.split(".")) {
    if (!segment || BLOCKED_PATH_KEYS.has(segment)) throw new Error("The custom API value path is invalid.");
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
      continue;
    }
    if (!current || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, segment)) {
      throw new Error(`The custom API response does not contain “${dotPath}”.`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 253)
    : [];
}

export async function fetchCustomApiWidget(widget: DashboardWidget): Promise<CustomApiResponse> {
  const config = widget.config;
  const endpoint = typeof config.url === "string" ? config.url : typeof config.endpoint === "string" ? config.endpoint : "";
  if (!isHttpUrl(endpoint)) throw new Error("Custom API widget URL must use http:// or https://.");
  const target = new URL(endpoint);
  if (target.username || target.password) throw new Error("Custom API URLs cannot contain embedded credentials.");

  const allowedPrivateHosts = stringArray(config.allowPrivateHosts);
  await validateTarget(target, allowedPrivateHosts);
  const valuePath =
    typeof config.valuePath === "string" ? config.valuePath : typeof config.path === "string" ? config.path : "";
  if (valuePath.length > 500) throw new Error("Custom API value path is too long.");
  const label = typeof config.label === "string" && config.label.trim() ? config.label.trim().slice(0, 120) : widget.id;
  const cacheSeconds =
    typeof config.cacheSeconds === "number" && Number.isFinite(config.cacheSeconds)
      ? Math.max(10, Math.min(3600, Math.round(config.cacheSeconds)))
      : 60;
  const cacheKey = `${widget.id}:${target.toString()}:${valuePath}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.response;

  const response = await fetch(target, {
    signal: AbortSignal.timeout(6_000),
    redirect: "error",
    headers: { Accept: "application/json", "User-Agent": "Dashcenter/0.1 custom-api" },
  });
  if (!response.ok) throw new Error(`Custom API returned HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("Custom API response is larger than 1 MB.");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Custom API response is larger than 1 MB.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Custom API did not return valid JSON.");
  }
  const result = { label, value: extractPath(json, valuePath), updatedAt: new Date().toISOString() };
  cache.set(cacheKey, { expiresAt: Date.now() + cacheSeconds * 1000, response: result });
  return result;
}

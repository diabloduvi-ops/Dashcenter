import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { pipeline, Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { DashboardWidget } from "../shared/types.js";
import { readBoundedText } from "./bounded-response.js";
import { cacheValue } from "./bounded-cache.js";
import { fetchWithoutRedirect } from "./credentialed-fetch.js";
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
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isPrivateIp(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  if (isIP(address) !== 6) return true;
  const [first, second] = address.split(":").map((part) => Number.parseInt(part || "0", 16));
  return first < 0x2000 || first >= 0x4000 || first === 0x2002 || first === 0x3fff ||
    (first === 0x2001 && (second < 0x0200 || second === 0x0db8));
}

async function validateTarget(target: URL, allowedPrivateHosts: string[]): Promise<LookupAddress | undefined> {
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

  const addresses = await lookup(hostname, { all: true, verbatim: true }).catch(() => {
    throw new Error("Could not resolve the custom API host.");
  });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("The custom API host resolves to a private address and is not allowlisted.");
  }
  return addresses[0];
}

const LIMIT_ERROR = "Custom API response is larger than 1 MB.";
const HEADERS = { Accept: "application/json", "User-Agent": "Dashcenter/0.1 custom-api" };

async function fetchApiText(target: URL, pinned: LookupAddress | undefined, signal: AbortSignal): Promise<string> {
  if (!pinned) {
    const response = await fetchWithoutRedirect(target, { signal, headers: HEADERS });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Custom API returned HTTP ${response.status}.`);
    }
    return readBoundedText(response, MAX_RESPONSE_BYTES, LIMIT_ERROR);
  }

  // Keep the configured hostname for HTTP Host and TLS, but connect to the
  // exact address that passed validation.
  return new Promise((resolve, reject) => {
    const request = target.protocol === "https:" ? httpsRequest : httpRequest;
    const outgoing = request(target, {
      agent: false,
      family: pinned.family,
      lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
      signal,
      headers: HEADERS,
    }, (response) => {
      const status = response.statusCode ?? 502;
      if (status < 200 || status >= 300) {
        response.destroy();
        reject(new Error(`Custom API returned HTTP ${status}.`));
        return;
      }

      const encoding = response.headers["content-encoding"];
      const decompress = encoding === "gzip" ? createGunzip()
        : encoding === "deflate" ? createInflate()
          : encoding === "br" ? createBrotliDecompress() : undefined;
      if (encoding && encoding !== "identity" && !decompress) {
        response.destroy();
        reject(new Error("Custom API returned an unsupported content encoding."));
        return;
      }
      if (decompress) pipeline(response, decompress, (error) => { if (error) reject(error); });
      const headers = new Headers();
      if (response.headers["content-length"]) headers.set("content-length", response.headers["content-length"]);
      const body = Readable.toWeb(decompress ?? response, {
        strategy: { highWaterMark: 64 * 1024, size: (chunk: Buffer) => chunk.byteLength },
      }) as ReadableStream<Uint8Array>;
      void readBoundedText({ body, headers }, MAX_RESPONSE_BYTES, LIMIT_ERROR).then(resolve, reject);
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
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
  const signal = AbortSignal.timeout(6_000);
  const valuePath =
    typeof config.valuePath === "string" ? config.valuePath : typeof config.path === "string" ? config.path : "";
  if (valuePath.length > 500) throw new Error("Custom API value path is too long.");
  const label = typeof config.label === "string" && config.label.trim() ? config.label.trim().slice(0, 120) : widget.id;
  const cacheSeconds =
    typeof config.cacheSeconds === "number" && Number.isFinite(config.cacheSeconds)
      ? Math.max(10, Math.min(3600, Math.round(config.cacheSeconds)))
      : 60;
  const cacheKey = JSON.stringify([widget.id, target.href, valuePath, allowedPrivateHosts, label]);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.response;

  const pinned = await validateTarget(target, allowedPrivateHosts);
  const text = await fetchApiText(target, pinned, signal);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Custom API did not return valid JSON.");
  }
  const result = { label, value: extractPath(json, valuePath), updatedAt: new Date().toISOString() };
  cacheValue(cache, cacheKey, { expiresAt: Date.now() + cacheSeconds * 1000, response: result }, 64);
  return result;
}

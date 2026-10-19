import http from "node:http";
import type { DockerConnection } from "../shared/types.js";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export interface DockerContainerSummary {
  id: string;
  names: string[];
  name: string;
  image: string;
  state: string;
  status: string;
  health: "healthy" | "unhealthy" | "starting" | "unknown";
}

function normalizeSocketPath(endpoint: string): string {
  const socketPath = endpoint.startsWith("unix://") ? endpoint.slice("unix://".length) : endpoint;
  if (!socketPath.startsWith("/") || socketPath.includes("\0") || socketPath.length > 1024) {
    throw new Error("Docker socket endpoint must be an absolute filesystem path.");
  }
  return socketPath;
}

function socketRequest(endpoint: string, requestPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: normalizeSocketPath(endpoint),
        path: requestPath,
        method: "GET",
        headers: { Host: "docker" },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let byteLength = 0;
        response.on("data", (chunk: Buffer) => {
          byteLength += chunk.length;
          if (byteLength > MAX_RESPONSE_BYTES) {
            request.destroy(new Error("Docker returned a response larger than 10 MB."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`Docker returned HTTP ${response.statusCode}: ${body.slice(0, 300)}`));
            return;
          }
          resolve(body);
        });
      },
    );
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error("Docker request timed out.")));
    request.on("error", reject);
    request.end();
  });
}

function dockerHttpUrl(endpoint: string, requestPath: string): URL {
  let base: URL;
  try {
    base = new URL(endpoint);
  } catch {
    throw new Error("Docker HTTP endpoint is not a valid URL.");
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new Error("Docker HTTP endpoint must use http:// or https://.");
  }
  base.pathname = "/";
  base.search = "";
  base.hash = "";
  return new URL(requestPath.replace(/^\//, ""), base);
}

async function httpRequest(endpoint: string, requestPath: string): Promise<string> {
  const response = await fetch(dockerHttpUrl(endpoint, requestPath), {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: "error",
    headers: { Accept: "application/json, text/plain;q=0.9" },
  });
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error("Docker returned a response larger than 10 MB.");
  }
  if (!response.ok) throw new Error(`Docker returned HTTP ${response.status}: ${body.slice(0, 300)}`);
  return body;
}

export function dockerRequest(connection: DockerConnection, requestPath: string): Promise<string> {
  return connection.type === "socket"
    ? socketRequest(connection.endpoint, requestPath)
    : httpRequest(connection.endpoint, requestPath);
}

function parseHealth(status: string): DockerContainerSummary["health"] {
  const normalized = status.toLowerCase();
  if (normalized.includes("(healthy)")) return "healthy";
  if (normalized.includes("(unhealthy)")) return "unhealthy";
  if (normalized.includes("health: starting") || normalized.includes("(starting)")) return "starting";
  return "unknown";
}

export async function testDockerConnection(connection: DockerConnection): Promise<{
  ok: boolean;
  message: string;
  latencyMs: number;
  version?: string;
}> {
  const startedAt = Date.now();
  try {
    const ping = await dockerRequest(connection, "/_ping");
    if (ping.trim().toUpperCase() !== "OK") throw new Error(`Unexpected Docker response: ${ping.slice(0, 100)}`);
    let version: string | undefined;
    try {
      const rawVersion = JSON.parse(await dockerRequest(connection, "/version")) as { Version?: unknown };
      if (typeof rawVersion.Version === "string") version = rawVersion.Version;
    } catch {
      // A successful ping is sufficient; older/proxied daemons may hide /version.
    }
    return {
      ok: true,
      message: version ? `Connected to Docker ${version}.` : "Connected to Docker.",
      latencyMs: Date.now() - startedAt,
      ...(version ? { version } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Docker connection failed.",
      latencyMs: Date.now() - startedAt,
    };
  }
}

export async function listDockerContainers(connection: DockerConnection): Promise<DockerContainerSummary[]> {
  const raw = JSON.parse(await dockerRequest(connection, "/containers/json?all=1")) as unknown;
  if (!Array.isArray(raw)) throw new Error("Docker returned an invalid container list.");

  return raw.map((value) => {
    const row = (value ?? {}) as Record<string, unknown>;
    const names = Array.isArray(row.Names)
      ? row.Names.filter((name): name is string => typeof name === "string").map((name) => name.replace(/^\//, ""))
      : [];
    const status = typeof row.Status === "string" ? row.Status : "";
    return {
      id: typeof row.Id === "string" ? row.Id : "",
      names,
      name: names[0] ?? "Unnamed container",
      image: typeof row.Image === "string" ? row.Image : "",
      state: typeof row.State === "string" ? row.State : "unknown",
      status,
      health: parseHealth(status),
    };
  });
}

export async function getDockerContainerStatus(
  connection: DockerConnection,
  container: string,
): Promise<{ running: boolean; health: string; message: string }> {
  const wanted = container.replace(/^\/+/, "").toLowerCase();
  if (!wanted) throw new Error("Docker container name or ID is required.");
  const containers = await listDockerContainers(connection);
  const named = containers.filter((item) => item.names.some((name) => name.toLowerCase() === wanted));
  const matches = named.length ? named : containers.filter((item) => item.id.toLowerCase().startsWith(wanted));
  if (matches.length !== 1) throw new Error(matches.length ? "Docker container ID is ambiguous." : "Docker container was not found.");
  const selected = matches[0];
  const state = selected.state.toLowerCase();
  const running = state === "running";
  const health = selected.health;
  return { running, health, message: health !== "unknown" ? `${state} (${health})` : state };
}

import type { DashboardService, DockerConnection, ServiceStatus } from "../shared/types.js";
import type { AppDatabase } from "./database.js";
import { getServiceCredentials, readDashboard, updateServiceStatuses } from "./database.js";
import { getDockerContainerStatus } from "./docker.js";
import { fetchUptimeKumaPlugin, type UptimeKumaCredentials } from "./uptime-kuma.js";

export interface ServiceHealthUpdate {
  id: string;
  status: ServiceStatus;
  message?: string;
}

export interface HealthRefreshCoordinator<T> {
  run(): Promise<T>;
  start(): void;
  stop(): Promise<void>;
}

function connectionForService(
  service: DashboardService,
  connections: DockerConnection[],
): DockerConnection | undefined {
  const wanted = service.dockerServer.trim().toLowerCase();
  return connections.find(
    (connection) =>
      connection.id.toLowerCase() === wanted || connection.name.toLowerCase() === wanted,
  );
}

async function checkWebService(service: DashboardService): Promise<ServiceHealthUpdate> {
  const startedAt = Date.now();
  try {
    const response = await fetch(service.href, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(6_000),
      headers: { "User-Agent": "Dashcenter/0.1 health-check" },
    });
    await response.body?.cancel();
    const reachable = response.status >= 200 && response.status < 500;
    return {
      id: service.id,
      status: reachable ? "healthy" : "unhealthy",
      message: `HTTP ${response.status} · ${Date.now() - startedAt} ms`,
    };
  } catch (error) {
    return {
      id: service.id,
      status: "unhealthy",
      message: error instanceof Error ? error.message.slice(0, 500) : "Health check failed",
    };
  }
}

async function checkUptimeKumaService(
  service: DashboardService,
  credentials?: UptimeKumaCredentials,
): Promise<ServiceHealthUpdate> {
  if (service.plugin?.type !== "uptime-kuma") {
    return { id: service.id, status: "unhealthy", message: "Uptime Kuma plugin is required." };
  }
  const url = String(service.plugin.config.url ?? "").trim();
  const monitorId = String(service.plugin.config.monitorId ?? "").trim();
  if (!url || !monitorId) {
    return { id: service.id, status: "unhealthy", message: "Select one Uptime Kuma monitor first." };
  }
  if (!credentials?.apiKey.trim()) {
    return { id: service.id, status: "unhealthy", message: "Uptime Kuma API key is not configured." };
  }

  try {
    const payload = await fetchUptimeKumaPlugin({ url, monitorId }, credentials);
    const monitor = payload.monitor;
    if (!monitor) {
      return { id: service.id, status: "unhealthy", message: "The selected Uptime Kuma monitor is unavailable." };
    }
    const status: ServiceStatus = monitor.status === "up"
      ? "healthy"
      : monitor.status === "down"
        ? "unhealthy"
        : monitor.status === "pending" || monitor.status === "maintenance"
          ? "checking"
          : "unknown";
    const responseTime = monitor.responseTime === null ? "" : ` · ${monitor.responseTime} ms`;
    return {
      id: service.id,
      status,
      message: `Uptime Kuma: ${monitor.name} is ${monitor.status}${responseTime}`,
    };
  } catch (error) {
    return {
      id: service.id,
      status: "unhealthy",
      message: error instanceof Error ? error.message.slice(0, 500) : "Uptime Kuma health check failed",
    };
  }
}

export async function checkServiceHealth(
  service: DashboardService,
  connections: DockerConnection[],
  uptimeKumaCredentials?: UptimeKumaCredentials,
): Promise<ServiceHealthUpdate> {
  const source = service.statusSource ?? (service.dockerServer || service.container ? "docker" : "http");
  if (source === "uptime-kuma") return checkUptimeKumaService(service, uptimeKumaCredentials);
  if (source === "http") return checkWebService(service);

  if (!service.dockerServer) {
    return {
      id: service.id,
      status: "unhealthy",
      message: "Docker connection is required.",
    };
  }
  if (!service.container) {
    return {
      id: service.id,
      status: "unhealthy",
      message: "Docker container name is required.",
    };
  }

  const connection = connectionForService(service, connections);
  if (!connection) {
    return {
      id: service.id,
      status: "unhealthy",
      message: `Docker connection “${service.dockerServer}” was not found.`,
    };
  }
  if (!connection.enabled) {
    return {
      id: service.id,
      status: "unhealthy",
      message: `Docker connection “${connection.name}” is disabled.`,
    };
  }

  try {
    const result = await getDockerContainerStatus(connection, service.container);
    const isHealthy = result.running && result.health !== "unhealthy";
    return {
      id: service.id,
      status: isHealthy ? "healthy" : "unhealthy",
      message: `${connection.name}: ${result.message}`,
    };
  } catch (error) {
    return {
      id: service.id,
      status: "unhealthy",
      message: error instanceof Error ? error.message.slice(0, 500) : "Docker health check failed",
    };
  }
}

export function createHealthRefreshCoordinator<T>(
  task: () => Promise<T>,
  intervalMs = 30_000,
  onError: (error: unknown) => void = () => undefined,
): HealthRefreshCoordinator<T> {
  const interval = Math.max(1, Math.trunc(intervalMs));
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<T> | undefined;

  const schedule = () => {
    if (!active || timer !== undefined || inFlight) return;
    timer = setTimeout(() => {
      timer = undefined;
      void run().catch((error) => {
        try {
          onError(error);
        } catch {
          // Logging must never interrupt future health checks.
        }
      });
    }, interval);
    timer.unref();
  };

  const settle = (current: Promise<T>) => {
    if (inFlight === current) inFlight = undefined;
    schedule();
  };

  const run = (): Promise<T> => {
    if (inFlight) return inFlight;
    const current = Promise.resolve().then(task);
    inFlight = current;
    void current.then(
      () => settle(current),
      () => settle(current),
    );
    return current;
  };

  const start = () => {
    if (active) return;
    active = true;
    schedule();
  };

  const stop = async () => {
    active = false;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    const current = inFlight;
    if (current) {
      try {
        await current;
      } catch {
        // Scheduled errors are already reported and shutdown must still complete.
      }
    }
  };

  return { run, start, stop };
}

export async function refreshServiceHealth(database: AppDatabase): Promise<ServiceHealthUpdate[]> {
  const dashboard = readDashboard(database);
  const services = dashboard.groups.flatMap((group) => group.services).filter((service) => service.statusCheck);
  const updates = await Promise.all(services.map((service) => {
    const stored = service.statusSource === "uptime-kuma"
      ? getServiceCredentials(database, service.id, "uptime-kuma")
      : undefined;
    const credentials = stored ? { apiKey: stored.password } : undefined;
    return checkServiceHealth(service, dashboard.connections, credentials);
  }));
  updateServiceStatuses(database, updates);
  return updates;
}

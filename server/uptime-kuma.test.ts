import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DashboardData } from "../shared/types.js";
import { createDatabase } from "./database.js";
import { buildApp } from "./index.js";
import { fetchUptimeKumaPlugin, testUptimeKumaConnection } from "./uptime-kuma.js";

const metrics = `# HELP monitor_status Monitor status
# TYPE monitor_status gauge
monitor_response_time{monitor_name="Public API",monitor_type="http",monitor_url="https://api.example.test/health",monitor_hostname="",monitor_port=""} 82.36
monitor_cert_days_remaining{monitor_name="Public API",monitor_type="http",monitor_url="https://api.example.test/health",monitor_hostname="",monitor_port=""} 44
monitor_status{monitor_name="Public API",monitor_type="http",monitor_url="https://api.example.test/health",monitor_hostname="",monitor_port=""} 1
monitor_response_time{monitor_name="Database \\"primary\\"",monitor_type="port",monitor_url="",monitor_hostname="db.internal",monitor_port="5432"} 14
monitor_status{monitor_name="Database \\"primary\\"",monitor_type="port",monitor_url="",monitor_hostname="db.internal",monitor_port="5432"} 0
monitor_status{monitor_name="Maintenance",monitor_type="ping",monitor_url="",monitor_hostname="router.internal",monitor_port=""} 3
`;

function mockUptimeKuma(statusCode = 200) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string; authorization: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    return new Response(statusCode === 200 ? metrics : "authentication failed with secret-in-body", {
      status: statusCode,
      headers: { "Content-Type": "text/plain" },
    });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("Uptime Kuma reads supported Prometheus metrics without exposing its API key", async () => {
  const mock = mockUptimeKuma();
  try {
    const config = { url: "https://kuma.test/" };
    const credentials = { apiKey: "kuma-api-secret" };
    const result = await testUptimeKumaConnection(config, credentials);
    assert.equal(result.ok, true);
    assert.deepEqual(result.monitors, { total: 3, up: 1, down: 1, pending: 0, maintenance: 1, unknown: 0 });
    assert.equal(result.availableMonitors[0].name, 'Database "primary"');
    assert.equal(result.availableMonitors[0].status, "down");
    const api = result.availableMonitors.find((monitor) => monitor.name === "Public API");
    assert.ok(api);
    assert.equal(api.responseTime, 82.4);
    assert.equal(api.certificateDaysRemaining, 44);
    assert.deepEqual(mock.calls, [{
      url: "https://kuma.test/metrics",
      method: "GET",
      authorization: `Basic ${Buffer.from(":kuma-api-secret").toString("base64")}`,
    }]);
    assert.doesNotMatch(mock.calls[0].url, /kuma-api-secret/);
    assert.doesNotMatch(JSON.stringify(result), /kuma-api-secret|api\.example\.test|db\.internal/);

    const selected = await testUptimeKumaConnection({ ...config, monitorId: api.id }, credentials);
    assert.deepEqual(selected.monitor, api);

    const callCount = mock.calls.length;
    await fetchUptimeKumaPlugin(config, credentials);
    await fetchUptimeKumaPlugin(config, credentials);
    assert.equal(mock.calls.length, callCount + 1);
  } finally {
    mock.restore();
  }
});

test("Uptime Kuma rejects unavailable monitors and sanitizes authentication failures", async () => {
  const mock = mockUptimeKuma();
  try {
    await assert.rejects(
      testUptimeKumaConnection({ url: "https://kuma-select.test", monitorId: "missing" }, { apiKey: "select-secret" }),
      /selected Uptime Kuma monitor is no longer available/i,
    );
  } finally {
    mock.restore();
  }

  const unauthorized = mockUptimeKuma(401);
  try {
    await assert.rejects(
      testUptimeKumaConnection({ url: "https://kuma-auth.test" }, { apiKey: "never-echo-key" }),
      (error: Error) => {
        assert.match(error.message, /authentication failed/i);
        assert.doesNotMatch(error.message, /never-echo-key|secret-in-body/);
        return true;
      },
    );
  } finally {
    unauthorized.restore();
  }
});

test("Uptime Kuma service routes keep the API key server-side and reuse stored credentials", async () => {
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-uptime-kuma-plugin-"));
  const database = createDatabase(path.join(dataDirectory, "app.db"));
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  process.env.DEV_BYPASS_AUTH = "1";
  const mock = mockUptimeKuma();
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });
  try {
    const initial = (await app.inject({ method: "GET", url: "/api/dashboard" })).json<DashboardData>();
    const service = initial.groups.flatMap((group) => group.services).find((item) => item.name === "YouTube");
    assert.ok(service);
    const groups = initial.groups.map((group) => ({
      ...group,
      services: group.services.map((item) => item.id === service.id ? {
        ...item,
        plugin: {
          type: "uptime-kuma" as const,
          enabled: true,
          presentation: "expanded" as const,
          config: { url: "https://kuma-route.test", monitorId: "" },
        },
      } : item),
    }));
    assert.equal((await app.inject({ method: "PUT", url: "/api/dashboard", payload: { ...initial, groups } })).statusCode, 200);
    const credentials = await app.inject({
      method: "PUT",
      url: `/api/services/${service.id}/plugin/credentials`,
      payload: { apiKey: "route-kuma-secret" },
    });
    assert.equal(credentials.statusCode, 200, credentials.body);
    assert.deepEqual(credentials.json(), { username: "", passwordConfigured: true });

    const publicDashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    assert.doesNotMatch(publicDashboard.body, /route-kuma-secret|api\.example\.test|db\.internal/);
    const invalidHealthSource = await app.inject({
      method: "PUT",
      url: "/api/dashboard",
      payload: {
        ...publicDashboard.json<DashboardData>(),
        groups: publicDashboard.json<DashboardData>().groups.map((group) => ({
          ...group,
          services: group.services.map((item) => item.id === service.id
            ? { ...item, statusCheck: true, statusSource: "uptime-kuma" as const }
            : item),
        })),
      },
    });
    assert.equal(invalidHealthSource.statusCode, 400);
    assert.match(invalidHealthSource.body, /one selected monitor/i);

    const tested = await app.inject({
      method: "POST",
      url: `/api/services/${service.id}/plugin/test`,
      payload: {
        type: "uptime-kuma",
        config: { url: "https://kuma-route.test", monitorId: "" },
        credentials: {},
      },
    });
    assert.equal(tested.statusCode, 200, tested.body);
    assert.equal(tested.json().availableMonitors.length, 3);
    const publicApiMonitor = tested.json().availableMonitors.find((monitor: { name: string }) => monitor.name === "Public API");
    assert.ok(publicApiMonitor);

    const plugin = await app.inject({ method: "GET", url: `/api/services/${service.id}/plugin` });
    assert.equal(plugin.statusCode, 200, plugin.body);
    assert.deepEqual(plugin.json().monitors, { total: 3, up: 1, down: 1, pending: 0, maintenance: 1, unknown: 0 });
    assert.doesNotMatch(plugin.body, /route-kuma-secret|api\.example\.test|db\.internal/);

    const latest = (await app.inject({ method: "GET", url: "/api/dashboard" })).json<DashboardData>();
    const healthGroups = latest.groups.map((group) => ({
      ...group,
      services: group.services.map((item) => item.id === service.id ? {
        ...item,
        statusCheck: true,
        statusSource: "uptime-kuma" as const,
        plugin: item.plugin ? {
          ...item.plugin,
          config: { ...item.plugin.config, monitorId: publicApiMonitor.id },
        } : undefined,
      } : item),
    }));
    const savedHealthSource = await app.inject({
      method: "PUT",
      url: "/api/dashboard",
      payload: { ...latest, groups: healthGroups },
    });
    assert.equal(savedHealthSource.statusCode, 200, savedHealthSource.body);

    const refreshed = await app.inject({ method: "POST", url: "/api/health/refresh" });
    assert.equal(refreshed.statusCode, 200, refreshed.body);
    const refreshedService = refreshed.json().dashboard.groups
      .flatMap((group: { services: DashboardData["groups"][number]["services"] }) => group.services)
      .find((item: { id: string }) => item.id === service.id);
    assert.equal(refreshedService.status, "healthy");
    assert.equal(refreshedService.statusSource, "uptime-kuma");
    assert.match(refreshedService.statusMessage, /^Uptime Kuma: Public API is up/);
    assert.doesNotMatch(refreshed.body, /route-kuma-secret|api\.example\.test|db\.internal/);
  } finally {
    await app.close();
    mock.restore();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DashboardData } from "../shared/types.js";
import { createDatabase } from "./database.js";
import { buildApp } from "./index.js";
import { fetchMikrotikPlugin, testMikrotikConnection } from "./mikrotik.js";

function mockMikrotik(status = 200) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string; authorization: string | null }> = [];
  let interfaceRequests = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? "GET", authorization: headers.get("Authorization") });
    if (status !== 200) return new Response("denied secret-router-password", { status });
    const payload = url.includes("/rest/system/resource")
      ? [{
          "architecture-name": "arm64",
          "board-name": "RB5009UG+S+",
          "cpu-count": "4",
          "cpu-load": "17",
          "free-hdd-space": "250",
          "free-memory": "268435456",
          platform: "MikroTik",
          "total-hdd-space": "1000",
          "total-memory": "1073741824",
          uptime: "2d4h12m",
          version: "7.20.2 (stable)",
        }]
      : url.includes("/rest/system/identity")
        ? [{ name: "Core Router" }]
        : url.includes("/rest/ip/dhcp-server/lease")
          ? [
              { address: "192.168.88.10", status: "bound", disabled: "false" },
              { address: "192.168.88.11", "active-address": "192.168.88.11", disabled: "false" },
              { address: "192.168.88.12", status: "waiting", disabled: "true" },
            ]
          : [
              {
                name: "ether1",
                type: "ether",
                running: "true",
                disabled: "false",
                "rx-byte": String(1_000_000 + interfaceRequests++ * 3_000_000),
                "tx-byte": String(500_000 + (interfaceRequests - 1) * 750_000),
              },
              { name: "ether2", running: "true", disabled: "true" },
              { name: "wlan1", running: "false", disabled: "false" },
              { name: "bridge", running: "true", disabled: "false" },
            ];
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("MikroTik returns read-only router metrics without exposing credentials", async () => {
  const mock = mockMikrotik();
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  try {
    const config = { url: "https://router.test/", interfaceName: "ether1" };
    const credentials = { username: "router-api-reader", password: "secret-router-password" };
    const result = await testMikrotikConnection(config, credentials);
    assert.equal(result.ok, true);
    assert.deepEqual(result.router, {
      name: "Core Router",
      boardName: "RB5009UG+S+",
      platform: "MikroTik",
      version: "7.20.2 (stable)",
      architecture: "arm64",
    });
    assert.deepEqual(result.dhcp, { leases: 3, active: 2 });
    assert.deepEqual(result.interfaces, { total: 4, running: 2, disabled: 1 });
    assert.deepEqual(result.interfaceOptions[0], { name: "ether1", type: "ether", running: true, disabled: false });
    assert.equal(result.traffic.status, "warming-up");
    assert.equal(result.system.cpuLoad, 17);
    assert.equal(result.system.memoryUsedPercent, 75);
    assert.equal(result.system.storageUsedPercent, 75);
    assert.doesNotMatch(JSON.stringify(result), /secret-router-password|router-api-reader/);
    assert.ok(mock.calls.every((call) => call.method === "GET"));
    assert.ok(mock.calls.every((call) => call.authorization === `Basic ${Buffer.from("router-api-reader:secret-router-password").toString("base64")}`));
    assert.ok(mock.calls.every((call) => call.url.startsWith("https://router.test/rest/")));

    const firstCallCount = mock.calls.length;
    const first = await fetchMikrotikPlugin(config, credentials);
    assert.equal(first.traffic.status, "warming-up");
    const cached = await fetchMikrotikPlugin(config, credentials);
    assert.equal(cached.traffic.status, "warming-up");
    assert.equal(mock.calls.length, firstCallCount + 4);
    now += 30_000;
    const [sampled, duplicate] = await Promise.all([
      fetchMikrotikPlugin(config, credentials),
      fetchMikrotikPlugin(config, credentials),
    ]);
    assert.equal(mock.calls.length, firstCallCount + 8);
    assert.deepEqual(duplicate.traffic, sampled.traffic);
    assert.equal(sampled.traffic.status, "ready");
    assert.equal(sampled.traffic.downloadBitsPerSecond, 800_000);
    assert.equal(sampled.traffic.uploadBitsPerSecond, 200_000);
    assert.deepEqual(sampled.traffic.samples, [{
      at: new Date(now).toISOString(),
      downloadBitsPerSecond: 800_000,
      uploadBitsPerSecond: 200_000,
    }]);
    assert.doesNotMatch(JSON.stringify(sampled), /secret-router-password|router-api-reader/);
  } finally {
    Date.now = originalNow;
    mock.restore();
  }
});

test("MikroTik authentication errors are concise and never echo credentials", async () => {
  const mock = mockMikrotik(401);
  try {
    await assert.rejects(
      testMikrotikConnection(
        { url: "https://router-auth.test" },
        { username: "router-api-reader", password: "secret-router-password" },
      ),
      (error: Error) => {
        assert.match(error.message, /authentication failed/i);
        assert.doesNotMatch(error.message, /secret-router-password|router-api-reader/);
        return true;
      },
    );
  } finally {
    mock.restore();
  }
});

test("MikroTik service routes keep credentials server-side and use them for test and dashboard requests", async () => {
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-mikrotik-plugin-"));
  const database = createDatabase(path.join(dataDirectory, "app.db"));
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  process.env.DEV_BYPASS_AUTH = "1";
  const mock = mockMikrotik();
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });
  try {
    const initial = (await app.inject({ method: "GET", url: "/api/dashboard" })).json<DashboardData>();
    const service = initial.groups.flatMap((group) => group.services).find((item) => item.name === "YouTube");
    assert.ok(service);
    const groups = initial.groups.map((group) => ({
      ...group,
      services: group.services.map((item) => item.id === service.id ? {
        ...item,
        plugin: { type: "mikrotik" as const, enabled: true, presentation: "expanded" as const, config: { url: "https://router-route.test", interfaceName: "ether1" } },
      } : item),
    }));
    assert.equal((await app.inject({ method: "PUT", url: "/api/dashboard", payload: { ...initial, groups } })).statusCode, 200);
    assert.equal((await app.inject({
      method: "PUT",
      url: `/api/services/${service.id}/plugin/credentials`,
      payload: { username: "router-api-reader", password: "secret-router-password" },
    })).statusCode, 200);

    const publicDashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    assert.doesNotMatch(publicDashboard.body, /secret-router-password|router-api-reader/);
    assert.deepEqual((await app.inject({
      method: "GET",
      url: `/api/services/${service.id}/plugin/credentials`,
    })).json(), { username: "router-api-reader", passwordConfigured: true });

    const tested = await app.inject({
      method: "POST",
      url: `/api/services/${service.id}/plugin/test`,
      payload: { type: "mikrotik", config: { url: "https://router-route.test", interfaceName: "ether1" }, credentials: { username: "router-api-reader" } },
    });
    assert.equal(tested.statusCode, 200);
    assert.equal(tested.json().router.name, "Core Router");
    assert.equal(tested.json().interfaceOptions[0].name, "ether1");

    const plugin = await app.inject({ method: "GET", url: `/api/services/${service.id}/plugin` });
    assert.equal(plugin.statusCode, 200);
    assert.deepEqual(plugin.json().interfaces, { total: 4, running: 2, disabled: 1 });
    assert.equal(plugin.json().traffic.interfaceName, "ether1");
    assert.equal(plugin.json().traffic.status, "warming-up");
  } finally {
    await app.close();
    mock.restore();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DashboardData } from "../shared/types.js";
import { createDatabase } from "./database.js";
import { buildApp } from "./index.js";
import { fetchProxmoxPlugin, testProxmoxConnection } from "./proxmox.js";

const resources = [
  { type: "node", node: "pve-a", status: "online", cpu: 0.25, maxcpu: 4, mem: 4_000, maxmem: 8_000 },
  { type: "node", node: "pve-b", status: "offline", cpu: 0.5, maxcpu: 8, mem: 8_000, maxmem: 16_000 },
  { type: "qemu", node: "pve-a", vmid: 100, name: "app", status: "running" },
  { type: "lxc", node: "pve-a", vmid: 101, name: "proxy", status: "stopped" },
  { type: "qemu", node: "pve-b", vmid: 200, name: "backup", status: "running" },
  { type: "storage", node: "pve-a", storage: "local", disk: 50, maxdisk: 100, shared: 0 },
  { type: "storage", node: "pve-b", storage: "local", disk: 20, maxdisk: 100, shared: 0 },
  { type: "storage", node: "pve-a", storage: "shared", disk: 100, maxdisk: 200, shared: 1 },
  { type: "storage", node: "pve-b", storage: "shared", disk: 100, maxdisk: 200, shared: 1 },
];

function mockProxmox(statusCode = 200) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string; authorization: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    if (statusCode !== 200) return new Response(JSON.stringify({ data: null, message: "secret denied" }), { status: statusCode });
    const data = url.endsWith("/version")
      ? { version: "8.3.5", release: "8.3" }
      : url.endsWith("/cluster/status")
        ? [{ type: "cluster", name: "home-cluster", quorate: 1 }]
        : resources;
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("Proxmox returns read-only cluster metrics and de-duplicates shared storage", async () => {
  const mock = mockProxmox();
  try {
    const config = { url: "https://proxmox.test:8006/" };
    const credentials = { tokenId: "dashcenter@pve!monitoring", tokenSecret: "proxmox-secret" };
    const result = await testProxmoxConnection(config, credentials);
    assert.equal(result.ok, true);
    assert.deepEqual(result.cluster, { name: "home-cluster", version: "8.3.5" });
    assert.deepEqual(result.nodes, { total: 2, online: 1, offline: 1 });
    assert.deepEqual(result.guests, { total: 3, running: 2, stopped: 1, virtualMachines: 2, containers: 1 });
    assert.equal(result.resources.cpuUsedPercent, 41.7);
    assert.equal(result.resources.memoryUsedPercent, 50);
    assert.equal(result.resources.storageUsed, 170);
    assert.equal(result.resources.storageTotal, 400);
    assert.equal(result.resources.storageUsedPercent, 42.5);
    assert.deepEqual(result.availableNodes, [
      { id: "pve-a", name: "pve-a", status: "online" },
      { id: "pve-b", name: "pve-b", status: "offline" },
    ]);
    assert.ok(mock.calls.every((call) => call.method === "GET"));
    assert.ok(mock.calls.every((call) => call.authorization === "PVEAPIToken=dashcenter@pve!monitoring=proxmox-secret"));
    assert.ok(mock.calls.every((call) => call.url.startsWith("https://proxmox.test:8006/api2/json/")));
    assert.ok(mock.calls.every((call) => !call.url.includes("proxmox-secret")));
    assert.doesNotMatch(JSON.stringify(result), /proxmox-secret|dashcenter@pve!monitoring/);

    const callCount = mock.calls.length;
    await fetchProxmoxPlugin(config, credentials);
    await fetchProxmoxPlugin(config, credentials);
    assert.equal(mock.calls.length, callCount + 3);
  } finally {
    mock.restore();
  }
});

test("Proxmox can scope metrics to one node and rejects inaccessible nodes", async () => {
  const mock = mockProxmox();
  const credentials = { tokenId: "reader@pve!dashcenter", tokenSecret: "node-secret" };
  try {
    const result = await testProxmoxConnection({ url: "https://pve.test:8006", node: "pve-a" }, credentials);
    assert.deepEqual(result.nodes, { total: 1, online: 1, offline: 0 });
    assert.deepEqual(result.guests, { total: 2, running: 1, stopped: 1, virtualMachines: 1, containers: 1 });
    assert.equal(result.resources.cpuUsedPercent, 25);
    assert.equal(result.resources.memoryUsedPercent, 50);
    assert.equal(result.resources.storageUsedPercent, 50);
    await assert.rejects(
      testProxmoxConnection({ url: "https://pve.test:8006", node: "missing-node" }, credentials),
      /not available to this API token/i,
    );
  } finally {
    mock.restore();
  }
});

test("Proxmox authentication errors never echo API token secrets", async () => {
  const mock = mockProxmox(401);
  try {
    await assert.rejects(
      testProxmoxConnection(
        { url: "https://pve-auth.test:8006" },
        { tokenId: "reader@pve!dashcenter", tokenSecret: "never-echo-token" },
      ),
      (error: Error) => {
        assert.match(error.message, /authentication failed/i);
        assert.doesNotMatch(error.message, /never-echo-token|secret denied/);
        return true;
      },
    );
  } finally {
    mock.restore();
  }
});

test("Proxmox service routes keep API tokens server-side and reuse stored credentials", async () => {
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-proxmox-plugin-"));
  const database = createDatabase(path.join(dataDirectory, "app.db"));
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  process.env.DEV_BYPASS_AUTH = "1";
  const mock = mockProxmox();
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
          type: "proxmox" as const,
          enabled: true,
          presentation: "expanded" as const,
          config: { url: "https://proxmox-route.test:8006", node: "" },
        },
      } : item),
    }));
    const saved = await app.inject({ method: "PUT", url: "/api/dashboard", payload: { ...initial, groups } });
    assert.equal(saved.statusCode, 200, saved.body);
    const credentials = await app.inject({
      method: "PUT",
      url: `/api/services/${service.id}/plugin/credentials`,
      payload: { username: "dashcenter@pve!monitoring", password: "route-proxmox-secret" },
    });
    assert.equal(credentials.statusCode, 200, credentials.body);
    assert.deepEqual(credentials.json(), { username: "dashcenter@pve!monitoring", passwordConfigured: true });

    const publicDashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    assert.doesNotMatch(publicDashboard.body, /dashcenter@pve|route-proxmox-secret/);

    const tested = await app.inject({
      method: "POST",
      url: `/api/services/${service.id}/plugin/test`,
      payload: {
        type: "proxmox",
        config: { url: "https://proxmox-route.test:8006", node: "" },
        credentials: { username: "" },
      },
    });
    assert.equal(tested.statusCode, 200, tested.body);
    assert.equal(tested.json().cluster.name, "home-cluster");
    assert.equal(tested.json().availableNodes.length, 2);

    const plugin = await app.inject({ method: "GET", url: `/api/services/${service.id}/plugin` });
    assert.equal(plugin.statusCode, 200, plugin.body);
    assert.equal(plugin.json().guests.running, 2);
    assert.doesNotMatch(plugin.body, /dashcenter@pve|route-proxmox-secret/);
  } finally {
    await app.close();
    mock.restore();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

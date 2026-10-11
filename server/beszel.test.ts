import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DashboardData } from "../shared/types.js";
import { fetchBeszelWidget, testBeszelConnection } from "./beszel.js";
import { createDatabase } from "./database.js";
import { buildApp } from "./index.js";

const systemsPayload = {
  items: [
    { id: "alpha", name: "Main server", status: "up", updated: "2026-09-01T12:00:00Z", info: { cpu: 12.5, mp: 48, dp: 71, bb: 2048 } },
    { id: "beta", name: "Backup", status: "down", info: { cpu: 0, mp: 0, dp: 0, bb: 0 } },
  ],
  totalItems: 2,
};

function mockBeszel() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/api/collections/_superusers/auth-with-password")) {
      return new Response(JSON.stringify({ token: "secret-token" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/api/collections/systems/records")) {
      return new Response(JSON.stringify(systemsPayload), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ message: "not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("Beszel adapter authenticates with v2 and returns overview or one system", async () => {
  const mock = mockBeszel();
  try {
    const config = { url: "http://beszel.test:8090", version: 2 as const };
    const credentials = { username: "admin@example.com", password: "correct-password" };
    const result = await testBeszelConnection(config, credentials);
    assert.equal(result.total, 2);
    assert.equal(result.up, 1);
    assert.match(mock.calls[0].url, /_superusers\/auth-with-password$/);
    assert.equal(JSON.parse(String(mock.calls[0].init?.body)).identity, "admin@example.com");
    assert.doesNotMatch(JSON.stringify(result), /secret-token|correct-password/);

    const overview = await fetchBeszelWidget(config, credentials);
    assert.deepEqual(overview, { mode: "overview", systems: 2, up: 1, updatedAt: overview.updatedAt });

    const single = await fetchBeszelWidget({ ...config, systemId: "alpha" }, credentials);
    assert.equal(single.mode, "system");
    if (single.mode === "system") {
      assert.equal(single.system.name, "Main server");
      assert.equal(single.system.cpu, 12.5);
      assert.equal(single.system.memory, 48);
      assert.equal(single.system.disk, 71);
      assert.equal(single.system.network, 2048);
    }
  } finally {
    mock.restore();
  }
});

test("Beszel credentials remain server-only and power the public widget endpoint", async () => {
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-beszel-"));
  const database = createDatabase(path.join(dataDirectory, "app.db"));
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  process.env.DEV_BYPASS_AUTH = "1";
  const mock = mockBeszel();
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });
  try {
    const initial = (await app.inject({ method: "GET", url: "/api/dashboard" })).json<DashboardData>();
    const widget = {
      id: "widget-beszel-test",
      type: "beszel" as const,
      enabled: true,
      position: initial.widgets.length,
      config: { label: "Lab", url: "http://beszel-route.test:8090", version: 2, systemId: "" },
    };
    const saved = await app.inject({ method: "PUT", url: "/api/dashboard", payload: { ...initial, widgets: [...initial.widgets, widget] } });
    assert.equal(saved.statusCode, 200);
    const credentials = await app.inject({
      method: "PUT",
      url: `/api/widgets/${widget.id}/credentials`,
      payload: { username: "admin@example.com", password: "correct-password" },
    });
    assert.equal(credentials.statusCode, 200);
    assert.deepEqual(credentials.json(), { username: "admin@example.com", passwordConfigured: true });

    const publicDashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    assert.doesNotMatch(publicDashboard.body, /admin@example\.com|correct-password/);
    const widgetResponse = await app.inject({ method: "GET", url: `/api/widgets/beszel/${widget.id}` });
    assert.equal(widgetResponse.statusCode, 200);
    assert.deepEqual(widgetResponse.json(), {
      mode: "overview",
      systems: 2,
      up: 1,
      updatedAt: widgetResponse.json<{ updatedAt: string }>().updatedAt,
    });
  } finally {
    await app.close();
    mock.restore();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DashboardData } from "../shared/types.js";
import { createDatabase } from "./database.js";
import { buildApp } from "./index.js";
import { fetchNginxProxyManagerPlugin, testNginxProxyManagerConnection } from "./nginx-proxy-manager.js";

const proxyHosts = [
  { enabled: 1, certificate_id: 7, meta: { nginx_online: true } },
  { enabled: true, certificate_id: 0, meta: { nginx_online: false, nginx_err: "offline" } },
  { enabled: 0, certificate_id: 3, meta: { nginx_online: false } },
];

function mockNpm(calls: Array<{ url: string; method: string; authorization: string | null; body: string }>) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", authorization: new Headers(init?.headers).get("Authorization"), body: String(init?.body ?? "") });
    if (url.endsWith("/api/tokens")) return new Response(JSON.stringify({ token: "npm-session", expires: "tomorrow" }), { status: 200 });
    if (url.endsWith("/api/nginx/proxy-hosts")) return new Response(JSON.stringify(proxyHosts), { status: 200 });
    if (url.endsWith("/api/nginx/redirection-hosts")) return new Response(JSON.stringify([{ enabled: 1, meta: { nginx_online: true } }]), { status: 200 });
    if (url.endsWith("/api/nginx/dead-hosts")) return new Response(JSON.stringify([{ enabled: 1, meta: { nginx_online: false } }]), { status: 200 });
    if (url.endsWith("/api/nginx/streams")) return new Response(JSON.stringify([{ enabled: true, meta: { nginx_online: true } }, { enabled: false }]), { status: 200 });
    return new Response("not found", { status: 404 });
  };
}

test("Nginx Proxy Manager authenticates and returns read-only host metrics", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string; authorization: string | null; body: string }> = [];
  globalThis.fetch = mockNpm(calls) as typeof fetch;
  try {
    const config = { url: "http://npm.test:81/" };
    const credentials = { identity: "reader@example.com", password: "npm-secret" };
    const result = await testNginxProxyManagerConnection(config, credentials);
    assert.deepEqual(result.proxyHosts, { total: 3, enabled: 2, online: 1, offline: 1, withSsl: 1 });
    assert.deepEqual(result.redirectionHosts, { total: 1, enabled: 1, online: 1 });
    assert.deepEqual(result.deadHosts, { total: 1, enabled: 1, online: 0 });
    assert.deepEqual(result.streams, { total: 2, enabled: 1, online: 1 });
    assert.equal(calls[0]?.method, "POST");
    assert.match(calls[0]?.body ?? "", /reader@example\.com/);
    assert.ok(calls.slice(1).every((call) => call.method === "GET"));
    assert.ok(calls.slice(1).every((call) => call.authorization === "Bearer npm-session"));
    assert.doesNotMatch(JSON.stringify(result), /npm-secret|npm-session|reader@example/);
    await fetchNginxProxyManagerPlugin(config, credentials);
    await fetchNginxProxyManagerPlugin(config, credentials);
    assert.equal(calls.length, 10);
  } finally { globalThis.fetch = original; }
});

test("Nginx Proxy Manager reports authentication and two-factor failures without exposing secrets", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "bad upstream-secret" }), { status: 401 })) as typeof fetch;
    await assert.rejects(
      testNginxProxyManagerConnection({ url: "http://npm-auth.test:81" }, { identity: "admin@example.com", password: "never-echo" }),
      (error: Error) => {
        assert.match(error.message, /authentication failed/i);
        assert.doesNotMatch(error.message, /never-echo|upstream-secret/);
        return true;
      },
    );
    globalThis.fetch = (async () => new Response(JSON.stringify({ challenge: true }), { status: 200 })) as typeof fetch;
    await assert.rejects(
      testNginxProxyManagerConnection({ url: "http://npm-2fa.test:81" }, { identity: "admin@example.com", password: "never-echo" }),
      /two-factor authentication/i,
    );
  } finally { globalThis.fetch = original; }
});

test("Nginx Proxy Manager service routes keep credentials server-side and reuse the stored identity", async () => {
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-npm-plugin-"));
  const database = createDatabase(path.join(dataDirectory, "app.db"));
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  process.env.DEV_BYPASS_AUTH = "1";
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string; authorization: string | null; body: string }> = [];
  globalThis.fetch = mockNpm(calls) as typeof fetch;
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });
  try {
    const initial = (await app.inject({ method: "GET", url: "/api/dashboard" })).json<DashboardData>();
    const service = initial.groups.flatMap((group) => group.services).find((item) => item.name === "YouTube");
    assert.ok(service);
    const groups = initial.groups.map((group) => ({
      ...group,
      services: group.services.map((item) => item.id === service.id ? {
        ...item,
        plugin: { type: "nginx-proxy-manager" as const, enabled: true, presentation: "summary" as const, config: { url: "http://npm-route.test:81" } },
      } : item),
    }));
    const savedDashboard = await app.inject({ method: "PUT", url: "/api/dashboard", payload: { ...initial, groups } });
    assert.equal(savedDashboard.statusCode, 200, savedDashboard.body);
    assert.equal((await app.inject({
      method: "PUT",
      url: `/api/services/${service.id}/plugin/credentials`,
      payload: { username: "reader@example.com", password: "route-secret" },
    })).statusCode, 200);

    const publicDashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    assert.doesNotMatch(publicDashboard.body, /reader@example|route-secret|npm-session/);

    const tested = await app.inject({
      method: "POST",
      url: `/api/services/${service.id}/plugin/test`,
      payload: { type: "nginx-proxy-manager", config: { url: "http://npm-route.test:81" }, credentials: { username: "" } },
    });
    assert.equal(tested.statusCode, 200, tested.body);
    assert.equal(tested.json().proxyHosts.online, 1);
    assert.match(calls[0]?.body ?? "", /reader@example\.com/);
    assert.match(calls[0]?.body ?? "", /route-secret/);

    const plugin = await app.inject({ method: "GET", url: `/api/services/${service.id}/plugin` });
    assert.equal(plugin.statusCode, 200, plugin.body);
    assert.equal(plugin.json().proxyHosts.withSsl, 1);
    assert.doesNotMatch(plugin.body, /reader@example|route-secret|npm-session/);
  } finally {
    await app.close();
    globalThis.fetch = original;
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

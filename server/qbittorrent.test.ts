import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DashboardData } from "../shared/types.js";
import { createDatabase } from "./database.js";
import { buildApp } from "./index.js";
import { fetchQBittorrentPlugin, testQBittorrentConnection } from "./qbittorrent.js";

test("qBittorrent logs in and returns read-only transfer and torrent metrics", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string; cookie: string | null; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", cookie: new Headers(init?.headers).get("Cookie"), body: String(init?.body ?? "") });
    if (url.endsWith("/api/v2/auth/login")) return new Response("Ok.", { status: 200, headers: { "Set-Cookie": "SID=test-session; path=/" } });
    if (url.endsWith("/api/v2/app/version")) return new Response("v5.1.0", { status: 200 });
    if (url.endsWith("/api/v2/transfer/info")) return new Response(JSON.stringify({ dl_info_speed: 2048, up_info_speed: 1024, connection_status: "connected" }), { status: 200 });
    return new Response(JSON.stringify([
      { state: "downloading", dlspeed: 2048, upspeed: 0 },
      { state: "stalledUP", dlspeed: 0, upspeed: 0 },
      { state: "pausedDL", dlspeed: 0, upspeed: 0 },
      { state: "error", dlspeed: 0, upspeed: 0 },
    ]), { status: 200 });
  };
  try {
    const config = { url: "http://qbittorrent.test:8080/" };
    const credentials = { username: "admin", password: "qbit-secret" };
    const result = await testQBittorrentConnection(config, credentials);
    assert.equal(result.version, "v5.1.0");
    assert.equal(result.downloadSpeed, 2048);
    assert.deepEqual(result.torrents, { total: 4, active: 1, downloading: 1, seeding: 1, paused: 1, errored: 1 });
    assert.equal(calls[0]?.method, "POST");
    assert.match(calls[0]?.body ?? "", /username=admin&password=qbit-secret/);
    assert.ok(calls.slice(1).every((call) => call.cookie === "SID=test-session"));
    assert.ok(calls.slice(1).every((call) => call.method === "GET"));
    assert.doesNotMatch(JSON.stringify(result), /qbit-secret|test-session/);
    await fetchQBittorrentPlugin(config, credentials);
    await fetchQBittorrentPlugin(config, credentials);
    assert.equal(calls.length, 8);
  } finally { globalThis.fetch = original; }
});

test("qBittorrent rejects a failed login without returning its response body", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("Fails. upstream-secret", { status: 200 });
  try {
    await assert.rejects(testQBittorrentConnection({ url: "http://qbit-auth.test" }, { username: "admin", password: "never-echo" }), (error: Error) => {
      assert.match(error.message, /authentication failed/i);
      assert.doesNotMatch(error.message, /never-echo|upstream-secret/);
      return true;
    });
  } finally { globalThis.fetch = original; }
});

test("qBittorrent supports the current 204 login response and port-scoped session cookie", async () => {
  const original = globalThis.fetch;
  const cookies: Array<string | null> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/v2/auth/login")) {
      return new Response(null, { status: 204, headers: { "Set-Cookie": "QBT_SID_8112=current-session; Path=/; HttpOnly; SameSite=Strict" } });
    }
    cookies.push(new Headers(init?.headers).get("Cookie"));
    if (url.endsWith("/api/v2/app/version")) return new Response("v5.2.0", { status: 200 });
    if (url.endsWith("/api/v2/transfer/info")) return new Response(JSON.stringify({ connection_status: "connected" }), { status: 200 });
    return new Response("[]", { status: 200 });
  };
  try {
    const result = await testQBittorrentConnection(
      { url: "http://qbittorrent-current.test:8112" },
      { username: "admin", password: "current-secret" },
    );
    assert.equal(result.version, "v5.2.0");
    assert.deepEqual(cookies, ["QBT_SID_8112=current-session", "QBT_SID_8112=current-session", "QBT_SID_8112=current-session"]);
    assert.doesNotMatch(JSON.stringify(result), /current-secret|current-session/);
  } finally { globalThis.fetch = original; }
});

test("qBittorrent rejects a successful-looking login without a session cookie", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 204 });
  try {
    await assert.rejects(
      testQBittorrentConnection({ url: "http://qbit-cookie.test" }, { username: "admin", password: "never-echo" }),
      /authentication failed/i,
    );
  } finally { globalThis.fetch = original; }
});

test("qBittorrent service routes keep credentials server-side and reuse the stored username", async () => {
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-qbittorrent-plugin-"));
  const database = createDatabase(path.join(dataDirectory, "app.db"));
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  process.env.DEV_BYPASS_AUTH = "1";
  const original = globalThis.fetch;
  const loginBodies: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/v2/auth/login")) {
      loginBodies.push(String(init?.body ?? ""));
      return new Response(null, { status: 204, headers: { "Set-Cookie": "QBT_SID_8080=route-session; Path=/; HttpOnly" } });
    }
    if (url.endsWith("/api/v2/app/version")) return new Response("v5.2.0", { status: 200 });
    if (url.endsWith("/api/v2/transfer/info")) {
      return new Response(JSON.stringify({ dl_info_speed: 4096, up_info_speed: 1024, connection_status: "connected" }), { status: 200 });
    }
    return new Response(JSON.stringify([{ state: "downloading", dlspeed: 4096, upspeed: 0 }]), { status: 200 });
  };
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });
  try {
    const initial = (await app.inject({ method: "GET", url: "/api/dashboard" })).json<DashboardData>();
    const service = initial.groups.flatMap((group) => group.services).find((item) => item.name === "YouTube");
    assert.ok(service);
    const groups = initial.groups.map((group) => ({
      ...group,
      services: group.services.map((item) => item.id === service.id ? {
        ...item,
        plugin: { type: "qbittorrent" as const, enabled: true, presentation: "summary" as const, config: { url: "http://qbittorrent-route.test:8080" } },
      } : item),
    }));
    const savedDashboard = await app.inject({ method: "PUT", url: "/api/dashboard", payload: { ...initial, groups } });
    assert.equal(savedDashboard.statusCode, 200, savedDashboard.body);
    assert.equal((await app.inject({
      method: "PUT",
      url: `/api/services/${service.id}/plugin/credentials`,
      payload: { username: "qbit-reader", password: "route-secret" },
    })).statusCode, 200);

    const publicDashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    assert.doesNotMatch(publicDashboard.body, /qbit-reader|route-secret|route-session/);

    const tested = await app.inject({
      method: "POST",
      url: `/api/services/${service.id}/plugin/test`,
      payload: { type: "qbittorrent", config: { url: "http://qbittorrent-route.test:8080" }, credentials: { username: "" } },
    });
    assert.equal(tested.statusCode, 200);
    assert.equal(tested.json().version, "v5.2.0");
    assert.match(loginBodies[0] ?? "", /username=qbit-reader&password=route-secret/);

    const plugin = await app.inject({ method: "GET", url: `/api/services/${service.id}/plugin` });
    assert.equal(plugin.statusCode, 200);
    assert.equal(plugin.json().torrents.downloading, 1);
    assert.doesNotMatch(plugin.body, /qbit-reader|route-secret|route-session/);
  } finally {
    await app.close();
    globalThis.fetch = original;
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

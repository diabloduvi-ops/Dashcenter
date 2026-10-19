import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DashboardData } from "../shared/types.js";
import { createDatabase, getServiceCredentials, readDashboard } from "./database.js";
import { buildApp } from "./index.js";

const systemsPayload = {
  items: [
    { id: "alpha", name: "Main server", status: "up", info: { cpu: 12, mp: 48, dp: 71, bb: 2048 } },
    { id: "beta", name: "Backup", status: "down", info: { cpu: 0, mp: 0, dp: 0, bb: 0 } },
  ],
  totalItems: 2,
};

function mockBeszel() {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/api/collections/_superusers/auth-with-password")) {
      return new Response(JSON.stringify({ token: "service-plugin-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/collections/systems/records")) {
      return new Response(JSON.stringify(systemsPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
  };
  return () => { globalThis.fetch = original; };
}

function mockPortainer() {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/api/endpoints")) {
      return new Response(JSON.stringify([{ Id: 7, Name: "Home Docker", Status: 1 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/endpoints/7/docker/containers/json")) {
      return new Response(JSON.stringify([
        { State: "running", Status: "Up 1 hour (healthy)" },
        { State: "exited", Status: "Exited (0)" },
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/api/stacks?endpointId=7")) {
      return new Response(JSON.stringify([{ EndpointId: 7 }, { EndpointId: 7 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function mockJellyfin() {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (
      headers.get("Authorization") !== 'MediaBrowser Token="jellyfin-server-only-key"'
      || headers.has("X-Emby-Token")
    ) {
      return new Response(JSON.stringify({ error: "legacy authentication disabled" }), { status: 401 });
    }
    const payload = url.endsWith("/System/Info")
      ? { ServerName: "Media Server", Version: "12.0.0", OperatingSystem: "Linux", HasPendingRestart: false }
      : url.endsWith("/Items/Counts")
        ? { MovieCount: 42, SeriesCount: 8, EpisodeCount: 126, SongCount: 24 }
        : url.endsWith("/Sessions")
          ? [{ NowPlayingItem: { Name: "Movie" }, PlayState: { IsPaused: false } }]
          : { message: "not found" };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return () => { globalThis.fetch = original; };
}

function mockArr(provider: "radarr" | "sonarr") {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    const payload = url.endsWith("/api/v3/system/status")
      ? { appName: provider === "radarr" ? "Radarr" : "Sonarr", instanceName: "Media automation", version: "6.0.1" }
      : url.endsWith("/api/v3/movie")
        ? [{ monitored: true, hasFile: true }, { monitored: false, hasFile: false }]
        : url.endsWith("/api/v3/series")
          ? [{ monitored: true, statistics: { episodeCount: 20, episodeFileCount: 18 } }]
          : url.endsWith("/api/v3/queue/status")
            ? { totalCount: 1 }
            : url.includes("/api/v3/wanted/missing?")
              ? { totalRecords: 3, records: [] }
              : { message: "not found" };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return () => { globalThis.fetch = original; };
}

function mockLidarr() {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    const payload = url.endsWith("/api/v1/system/status")
      ? { appName: "Lidarr", instanceName: "Music automation", version: "3.1.2" }
      : url.endsWith("/api/v1/artist")
        ? [
            { monitored: true, statistics: { albumCount: 1, totalTrackCount: 12, trackFileCount: 10 } },
            { monitored: false, statistics: { albumCount: 1, totalTrackCount: 8, trackFileCount: 8 } },
          ]
          : url.endsWith("/api/v1/queue/status")
            ? { totalCount: 1 }
            : url.includes("/api/v1/wanted/missing?")
              ? { totalRecords: 3, records: [] }
              : { message: "not found" };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return () => { globalThis.fetch = original; };
}

test("Beszel service plugins keep credentials server-side and render through the service endpoint", async () => {
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-service-plugin-"));
  const database = createDatabase(path.join(dataDirectory, "app.db"));
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  process.env.DEV_BYPASS_AUTH = "1";
  const restoreFetch = mockBeszel();
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });

  try {
    const initial = (await app.inject({ method: "GET", url: "/api/dashboard" })).json<DashboardData>();
    const service = initial.groups.flatMap((group) => group.services).find((item) => item.name === "Beszel");
    assert.ok(service);

    const groups = initial.groups.map((group) => ({
      ...group,
      services: group.services.map((item) => item.id === service.id
        ? {
            ...item,
            plugin: {
              type: "beszel" as const,
              enabled: true,
              presentation: "expanded" as const,
              config: { url: "http://beszel-service-plugin.test:8090", version: 2, systemId: "" },
            },
          }
        : item),
    }));

    const saved = await app.inject({ method: "PUT", url: "/api/dashboard", payload: { ...initial, groups } });
    assert.equal(saved.statusCode, 200);
    const credentials = await app.inject({
      method: "PUT",
      url: `/api/services/${service.id}/plugin/credentials`,
      payload: { username: "admin@example.com", password: "correct-password" },
    });
    assert.equal(credentials.statusCode, 200);
    assert.deepEqual(credentials.json(), { username: "admin@example.com", passwordConfigured: true });

    const publicDashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    assert.doesNotMatch(publicDashboard.body, /admin@example\.com|correct-password|service-plugin-token/);
    const configuredService = publicDashboard
      .json<DashboardData>()
      .groups.flatMap((group) => group.services)
      .find((item) => item.id === service.id);
    assert.equal(configuredService?.plugin?.type, "beszel");

    const pluginResponse = await app.inject({ method: "GET", url: `/api/services/${service.id}/plugin` });
    assert.equal(pluginResponse.statusCode, 200);
    assert.deepEqual(pluginResponse.json(), {
      mode: "overview",
      systems: 2,
      up: 1,
      updatedAt: pluginResponse.json<{ updatedAt: string }>().updatedAt,
    });

    const withoutPlugin = groups.map((group) => ({
      ...group,
      services: group.services.map((item) => item.id === service.id ? { ...item, plugin: undefined } : item),
    }));
    assert.equal((await app.inject({
      method: "PUT",
      url: "/api/dashboard",
      payload: { ...initial, groups: withoutPlugin },
    })).statusCode, 200);
    assert.deepEqual((await app.inject({
      method: "GET",
      url: `/api/services/${service.id}/plugin/credentials`,
    })).json(), { username: "", passwordConfigured: false });
  } finally {
    await app.close();
    restoreFetch();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

test("Portainer service plugins store only server-side tokens and return container metrics", async () => {
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-portainer-plugin-"));
  const database = createDatabase(path.join(dataDirectory, "app.db"));
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  process.env.DEV_BYPASS_AUTH = "1";
  const mock = mockPortainer();
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });

  try {
    const initial = (await app.inject({ method: "GET", url: "/api/dashboard" })).json<DashboardData>();
    const service = initial.groups.flatMap((group) => group.services).find((item) => item.name === "Portainer");
    assert.ok(service);
    const groups = initial.groups.map((group) => ({
      ...group,
      services: group.services.map((item) => item.id === service.id
        ? {
            ...item,
            plugin: {
              type: "portainer" as const,
              enabled: true,
              presentation: "summary" as const,
              config: { url: "http://portainer-service-plugin.test:9000", endpointId: "7" },
            },
          }
        : item),
    }));
    assert.equal((await app.inject({ method: "PUT", url: "/api/dashboard", payload: { ...initial, groups } })).statusCode, 200);
    assert.equal((await app.inject({
      method: "PUT",
      url: `/api/services/${service.id}/plugin/credentials`,
      payload: { apiKey: "portainer-secret-token" },
    })).statusCode, 200);

    const publicDashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    assert.doesNotMatch(publicDashboard.body, /portainer-secret-token/);
    assert.deepEqual((await app.inject({
      method: "GET",
      url: `/api/services/${service.id}/plugin/credentials`,
    })).json(), { username: "", passwordConfigured: true });

    const tested = await app.inject({
      method: "POST",
      url: `/api/services/${service.id}/plugin/test`,
      payload: {
        type: "portainer",
        config: { url: "http://portainer-service-plugin.test:9000", endpointId: "7" },
        credentials: {},
      },
    });
    assert.equal(tested.statusCode, 200);
    assert.deepEqual(tested.json().endpoints, [{ id: "7", name: "Home Docker", status: "up" }]);
    assert.equal(new Headers(mock.calls[0].init?.headers).get("X-API-Key"), "portainer-secret-token");
    assert.ok(mock.calls.every((call) => call.init?.redirect === "error"));
    assert.equal((await app.inject({
      method: "PUT", url: "/api/dashboard",
      payload: { ...initial, settings: { ...initial.settings, title: "Lab dashboard" }, groups },
    })).statusCode, 200);
    assert.equal(getServiceCredentials(database, service.id)?.password, "portainer-secret-token");

    const callCount = mock.calls.length;
    const foreignTest = await app.inject({
      method: "POST",
      url: `/api/services/${service.id}/plugin/test`,
      payload: { type: "portainer", config: { url: "http://untrusted-plugin.test:9000", endpointId: "7" }, credentials: {} },
    });
    assert.equal(foreignTest.statusCode, 502);
    assert.equal(mock.calls.length, callCount);

    const changedGroups = groups.map((group) => ({
      ...group,
      services: group.services.map((item) => item.id === service.id && item.plugin
        ? { ...item, plugin: { ...item.plugin, config: { ...item.plugin.config, url: "http://untrusted-plugin.test:9000" } } }
        : item),
    }));
    assert.equal((await app.inject({ method: "PUT", url: "/api/dashboard", payload: { ...initial, groups: changedGroups } })).statusCode, 200);
    assert.equal(getServiceCredentials(database, service.id), undefined);
    const withoutCredentials = await app.inject({ method: "GET", url: `/api/services/${service.id}/plugin` });
    assert.equal(withoutCredentials.statusCode, 409);
    assert.equal(mock.calls.length, callCount);

    assert.equal((await app.inject({ method: "PUT", url: "/api/dashboard", payload: { ...initial, groups } })).statusCode, 200);
    assert.equal((await app.inject({
      method: "PUT", url: `/api/services/${service.id}/plugin/credentials`, payload: { apiKey: "portainer-secret-token" },
    })).statusCode, 200);
    const pluginResponse = await app.inject({ method: "GET", url: `/api/services/${service.id}/plugin` });
    assert.equal(pluginResponse.statusCode, 200);
    const payload = pluginResponse.json();
    assert.equal(payload.mode, "endpoint");
    assert.deepEqual(payload.containers, { total: 2, running: 1, healthy: 1, stopped: 1 });
    assert.equal(payload.stacks, 2);
  } finally {
    await app.close();
    mock.restore();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

test("Jellyfin 12 service plugins become available and return media metrics with server-side credentials", async () => {
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-jellyfin-plugin-"));
  const database = createDatabase(path.join(dataDirectory, "app.db"));
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  process.env.DEV_BYPASS_AUTH = "1";
  const restoreFetch = mockJellyfin();
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });

  try {
    const initial = (await app.inject({ method: "GET", url: "/api/dashboard" })).json<DashboardData>();
    const service = initial.groups.flatMap((group) => group.services).find((item) => item.name === "YouTube");
    assert.ok(service);
    const groups = initial.groups.map((group) => ({
      ...group,
      services: group.services.map((item) => item.id === service.id
        ? {
            ...item,
            plugin: {
              type: "jellyfin" as const,
              enabled: true,
              presentation: "expanded" as const,
              config: { url: "http://jellyfin-service-plugin.test:8096" },
            },
          }
        : item),
    }));
    assert.equal((await app.inject({ method: "PUT", url: "/api/dashboard", payload: { ...initial, groups } })).statusCode, 200);
    assert.equal((await app.inject({
      method: "PUT",
      url: `/api/services/${service.id}/plugin/credentials`,
      payload: { apiKey: "jellyfin-server-only-key" },
    })).statusCode, 200);

    const publicDashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    assert.doesNotMatch(publicDashboard.body, /jellyfin-server-only-key/);
    assert.deepEqual((await app.inject({
      method: "GET",
      url: `/api/services/${service.id}/plugin/credentials`,
    })).json(), { username: "", passwordConfigured: true });

    const tested = await app.inject({
      method: "POST",
      url: `/api/services/${service.id}/plugin/test`,
      payload: {
        type: "jellyfin",
        config: { url: "http://jellyfin-service-plugin.test:8096" },
        credentials: {},
      },
    });
    assert.equal(tested.statusCode, 200);
    assert.equal(tested.json().server.name, "Media Server");

    const pluginResponse = await app.inject({ method: "GET", url: `/api/services/${service.id}/plugin` });
    assert.equal(pluginResponse.statusCode, 200);
    assert.deepEqual(pluginResponse.json().library, { movies: 42, series: 8, episodes: 126, songs: 24 });
    assert.deepEqual(pluginResponse.json().sessions, { connected: 1, playing: 1, paused: 0, transcoding: 0 });
  } finally {
    await app.close();
    restoreFetch();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

for (const provider of ["radarr", "sonarr"] as const) {
  test(`${provider} service plugins keep API keys server-side and return library metrics`, async () => {
    const dataDirectory = mkdtempSync(path.join(tmpdir(), `dashcenter-${provider}-plugin-`));
    const database = createDatabase(path.join(dataDirectory, "app.db"));
    const previousBypass = process.env.DEV_BYPASS_AUTH;
    process.env.DEV_BYPASS_AUTH = "1";
    const restoreFetch = mockArr(provider);
    const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });

    try {
      const initial = (await app.inject({ method: "GET", url: "/api/dashboard" })).json<DashboardData>();
      const service = initial.groups.flatMap((group) => group.services).find((item) => item.name === "YouTube");
      assert.ok(service);
      const groups = initial.groups.map((group) => ({
        ...group,
        services: group.services.map((item) => item.id === service.id
          ? {
              ...item,
              plugin: {
                type: provider,
                enabled: true,
                presentation: "expanded" as const,
                config: { url: `http://${provider}-service-plugin.test` },
              },
            }
          : item),
      }));
      assert.equal((await app.inject({ method: "PUT", url: "/api/dashboard", payload: { ...initial, groups } })).statusCode, 200);
      assert.equal((await app.inject({
        method: "PUT",
        url: `/api/services/${service.id}/plugin/credentials`,
        payload: { apiKey: `${provider}-server-only-key` },
      })).statusCode, 200);

      const publicDashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
      assert.doesNotMatch(publicDashboard.body, new RegExp(`${provider}-server-only-key`));
      assert.deepEqual((await app.inject({
        method: "GET",
        url: `/api/services/${service.id}/plugin/credentials`,
      })).json(), { username: "", passwordConfigured: true });

      const tested = await app.inject({
        method: "POST",
        url: `/api/services/${service.id}/plugin/test`,
        payload: { type: provider, config: { url: `http://${provider}-service-plugin.test` }, credentials: {} },
      });
      assert.equal(tested.statusCode, 200);
      assert.equal(tested.json().server.name, "Media automation");

      const pluginResponse = await app.inject({ method: "GET", url: `/api/services/${service.id}/plugin` });
      assert.equal(pluginResponse.statusCode, 200);
      assert.equal(pluginResponse.json().provider, provider);
      assert.equal(pluginResponse.json().wanted, 3);
      assert.equal(pluginResponse.json().queue, 1);
      assert.equal(pluginResponse.json().library.items, provider === "radarr" ? 2 : 1);
    } finally {
      await app.close();
      restoreFetch();
      database.close();
      rmSync(dataDirectory, { recursive: true, force: true });
      if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
      else process.env.DEV_BYPASS_AUTH = previousBypass;
    }
  });
}

test("Lidarr service plugins keep API keys server-side and return music library metrics", async () => {
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-lidarr-plugin-"));
  const database = createDatabase(path.join(dataDirectory, "app.db"));
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  process.env.DEV_BYPASS_AUTH = "1";
  const restoreFetch = mockLidarr();
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });

  try {
    const initial = (await app.inject({ method: "GET", url: "/api/dashboard" })).json<DashboardData>();
    const service = initial.groups.flatMap((group) => group.services).find((item) => item.name === "YouTube");
    assert.ok(service);
    const groups = initial.groups.map((group) => ({
      ...group,
      services: group.services.map((item) => item.id === service.id
        ? {
            ...item,
            plugin: {
              type: "lidarr" as const,
              enabled: true,
              presentation: "expanded" as const,
              config: { url: "http://lidarr-service-plugin.test" },
            },
          }
        : item),
    }));
    assert.equal((await app.inject({ method: "PUT", url: "/api/dashboard", payload: { ...initial, groups } })).statusCode, 200);
    assert.equal((await app.inject({
      method: "PUT",
      url: `/api/services/${service.id}/plugin/credentials`,
      payload: { apiKey: "lidarr-server-only-key" },
    })).statusCode, 200);

    const publicDashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    assert.doesNotMatch(publicDashboard.body, /lidarr-server-only-key/);
    assert.deepEqual((await app.inject({
      method: "GET",
      url: `/api/services/${service.id}/plugin/credentials`,
    })).json(), { username: "", passwordConfigured: true });

    const tested = await app.inject({
      method: "POST",
      url: `/api/services/${service.id}/plugin/test`,
      payload: { type: "lidarr", config: { url: "http://lidarr-service-plugin.test" }, credentials: {} },
    });
    assert.equal(tested.statusCode, 200, tested.body);
    assert.equal(tested.json().server.name, "Music automation");

    const pluginResponse = await app.inject({ method: "GET", url: `/api/services/${service.id}/plugin` });
    assert.equal(pluginResponse.statusCode, 200, pluginResponse.body);
    assert.equal(pluginResponse.json().provider, "lidarr");
    assert.equal(pluginResponse.json().wanted, 3);
    assert.equal(pluginResponse.json().queue, 1);
    assert.deepEqual(pluginResponse.json().library, {
      artists: 2,
      monitoredArtists: 1,
      albums: 2,
      tracks: 20,
      trackFiles: 18,
    });
  } finally {
    await app.close();
    restoreFetch();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

test("legacy standalone Beszel widgets migrate once to the matching service", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dashcenter-beszel-migration-"));
  const filename = path.join(directory, "app.db");
  let database = createDatabase(filename);

  try {
    const service = readDashboard(database).groups
      .flatMap((group) => group.services)
      .find((item) => item.name === "Beszel");
    assert.ok(service);
    database.prepare(`
      INSERT INTO dashboard_widgets (id, type, enabled, position, config)
      VALUES (?, 'beszel', 1, 99, ?)
    `).run("legacy-beszel", JSON.stringify({
      label: "Infrastructure",
      url: "http://beszel-migration.test:8090",
      version: 2,
      systemId: "alpha",
    }));
    database.prepare(`
      INSERT INTO widget_credentials (widget_id, username, password, updated_at)
      VALUES (?, ?, ?, ?)
    `).run("legacy-beszel", "migration@example.com", "migrated-password", new Date().toISOString());
    database.prepare("DELETE FROM app_meta WHERE key = 'service_plugins_v1'").run();
    database.close();

    database = createDatabase(filename);
    const migratedService = readDashboard(database).groups
      .flatMap((group) => group.services)
      .find((item) => item.id === service.id);
    assert.equal(migratedService?.plugin?.type, "beszel");
    assert.equal(migratedService?.plugin?.presentation, "expanded");
    assert.equal(migratedService?.plugin?.config.systemId, "alpha");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM dashboard_widgets WHERE id = ?").get("legacy-beszel")?.count, 0);
    const migratedCredentials = getServiceCredentials(database, service.id);
    assert.equal(migratedCredentials?.username, "migration@example.com");
    assert.equal(migratedCredentials?.password, "migrated-password");
  } finally {
    try {
      database.close();
    } catch {
      // The first connection is already closed before the migration reopen.
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

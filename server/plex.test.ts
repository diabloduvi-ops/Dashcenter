import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DashboardData } from "../shared/types.js";
import { createDatabase } from "./database.js";
import { buildApp } from "./index.js";
import { fetchPlexPlugin, testPlexConnection } from "./plex.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function mockPlex(status = 200) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; token: string | null; size: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, token: headers.get("X-Plex-Token"), size: headers.get("X-Plex-Container-Size") });
    if (status !== 200) return new Response("denied secret-plex-token", { status });
    if (url.endsWith("/library/metadata/101/thumb/1")) {
      return new Response(PNG, { status: 200, headers: { "Content-Type": "image/png" } });
    }
    const payload = url.endsWith("/status/sessions")
      ? { MediaContainer: { size: 3, Metadata: [
          {
            ratingKey: "101",
            title: "The Quiet Harbour",
            grandparentTitle: "Harbour Lights",
            parentIndex: 3,
            index: 4,
            duration: 2_535_000,
            viewOffset: 1_062_000,
            thumb: "/library/metadata/101/thumb/1",
            Player: { state: "playing", product: "Plex Web", title: "Living room" },
            User: { title: "Alex" },
            Media: { videoResolution: "4k", videoDecision: "directplay", audioDecision: "directplay" },
          },
          { Player: [{ state: "paused" }], TranscodeSession: { videoDecision: "transcode" } },
          { Player: { state: "playing" }, TranscodeSession: [{ videoDecision: "transcode" }] },
        ] } }
      : url.endsWith("/library/sections")
        ? { MediaContainer: { Directory: [
            { key: "1", type: "movie", title: "Movies" },
            { key: "2", type: "show", title: "TV" },
            { key: "3", type: "artist", title: "Music" },
          ] } }
        : url.endsWith("/library/sections/1/all")
          ? { MediaContainer: { totalSize: 42 } }
          : url.endsWith("/library/sections/2/all")
            ? { MediaContainer: { totalSize: 8 } }
            : url.endsWith("/library/sections/3/albums")
              ? { MediaContainer: { size: 24 } }
              : { MediaContainer: { friendlyName: "Home Plex", version: "1.42.2", platform: "Linux" } };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("Plex returns playback and library metrics without exposing its token", async () => {
  const mock = mockPlex();
  try {
    const config = { url: "http://plex.test:32400/" };
    const credentials = { token: "secret-plex-token" };
    const result = await testPlexConnection(config, credentials);
    assert.equal(result.ok, true);
    assert.deepEqual(result.server, { name: "Home Plex", version: "1.42.2", platform: "Linux" });
    assert.deepEqual(result.sessions, { total: 3, playing: 2, paused: 1, transcoding: 2 });
    assert.deepEqual(result.library, { movies: 42, shows: 8, albums: 24 });
    assert.equal(result.activity.active, 3);
    assert.deepEqual(result.activity.sessions[0], {
      id: result.activity.sessions[0].id,
      title: "The Quiet Harbour",
      seriesTitle: "Harbour Lights",
      seasonNumber: 3,
      episodeNumber: 4,
      client: "Plex Web",
      device: "Living room",
      username: "Alex",
      state: "playing",
      playMethod: "direct-play",
      progressPercent: 41.9,
      positionSeconds: 1062,
      durationSeconds: 2535,
      quality: "4K",
      artworkId: result.activity.sessions[0].artworkId,
    });
    assert.match(result.activity.sessions[0].id, /^[a-f0-9]{24}$/);
    assert.match(result.activity.sessions[0].artworkId ?? "", /^[a-f0-9]{32}$/);
    assert.doesNotMatch(JSON.stringify(result), /secret-plex-token/);
    assert.ok(mock.calls.every((call) => call.token === "secret-plex-token"));
    assert.ok(mock.calls.every((call) => !call.url.includes("secret-plex-token")));
    assert.ok(mock.calls.some((call) => call.url.endsWith("/library/sections/1/all") && call.size === "1"));

    const firstCallCount = mock.calls.length;
    await fetchPlexPlugin(config, credentials);
    await fetchPlexPlugin(config, credentials);
    assert.equal(mock.calls.length, firstCallCount + 6);
  } finally {
    mock.restore();
  }
});

test("Plex authentication errors are concise and never echo the token", async () => {
  const mock = mockPlex(401);
  try {
    await assert.rejects(
      testPlexConnection({ url: "http://plex-auth.test:32400" }, { token: "secret-plex-token" }),
      (error: Error) => {
        assert.match(error.message, /authentication failed/i);
        assert.doesNotMatch(error.message, /secret-plex-token/);
        return true;
      },
    );
  } finally {
    mock.restore();
  }
});

test("Plex service routes keep the token server-side and use it for test and dashboard requests", async () => {
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-plex-plugin-"));
  const database = createDatabase(path.join(dataDirectory, "app.db"));
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  process.env.DEV_BYPASS_AUTH = "1";
  const mock = mockPlex();
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });
  try {
    const initial = (await app.inject({ method: "GET", url: "/api/dashboard" })).json<DashboardData>();
    const service = initial.groups.flatMap((group) => group.services).find((item) => item.name === "YouTube");
    assert.ok(service);
    const groups = initial.groups.map((group) => ({
      ...group,
      services: group.services.map((item) => item.id === service.id ? {
        ...item,
        plugin: { type: "plex" as const, enabled: true, presentation: "expanded" as const, config: { url: "http://plex-route.test:32400" } },
      } : item),
    }));
    assert.equal((await app.inject({ method: "PUT", url: "/api/dashboard", payload: { ...initial, groups } })).statusCode, 200);
    assert.equal((await app.inject({
      method: "PUT",
      url: `/api/services/${service.id}/plugin/credentials`,
      payload: { token: "secret-plex-token" },
    })).statusCode, 200);

    const publicDashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    assert.doesNotMatch(publicDashboard.body, /secret-plex-token/);
    assert.deepEqual((await app.inject({
      method: "GET",
      url: `/api/services/${service.id}/plugin/credentials`,
    })).json(), { username: "", passwordConfigured: true });

    const tested = await app.inject({
      method: "POST",
      url: `/api/services/${service.id}/plugin/test`,
      payload: { type: "plex", config: { url: "http://plex-route.test:32400" }, credentials: {} },
    });
    assert.equal(tested.statusCode, 200);
    assert.equal(tested.json().server.name, "Home Plex");

    const plugin = await app.inject({ method: "GET", url: `/api/services/${service.id}/plugin` });
    assert.equal(plugin.statusCode, 200);
    assert.deepEqual(plugin.json().library, { movies: 42, shows: 8, albums: 24 });
    const artworkId = plugin.json().activity.sessions[0].artworkId;
    assert.match(artworkId, /^[a-f0-9]{32}$/);
    const artwork = await app.inject({ method: "GET", url: `/api/services/${service.id}/plugin/artwork/${artworkId}` });
    assert.equal(artwork.statusCode, 200);
    assert.equal(artwork.headers["content-type"], "image/png");
    assert.equal(artwork.headers["x-content-type-options"], "nosniff");
    assert.equal(artwork.headers["cross-origin-resource-policy"], "same-origin");
    assert.ok(mock.calls.at(-1)?.url.endsWith("/library/metadata/101/thumb/1"));
    assert.equal(mock.calls.at(-1)?.token, "secret-plex-token");
    assert.doesNotMatch(mock.calls.at(-1)?.url ?? "", /secret-plex-token/);
  } finally {
    await app.close();
    mock.restore();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

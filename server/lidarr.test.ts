import assert from "node:assert/strict";
import test from "node:test";
import { fetchLidarrPlugin, testLidarrConnection } from "./lidarr.js";

function mockLidarr() {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; apiKey: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, apiKey: headers.get("X-Api-Key") });
    const payload = url.endsWith("/api/v1/system/status")
      ? { appName: "Lidarr", instanceName: "Music", version: "3.1.2" }
      : url.endsWith("/api/v1/artist")
        ? [
            { monitored: true, statistics: { albumCount: 1, totalTrackCount: 12, trackFileCount: 10 } },
            { monitored: false, statistics: { albumCount: 1, totalTrackCount: 8, trackFileCount: 8 } },
            { monitored: true, statistics: { albumCount: 1, trackCount: 5, trackFileCount: 2 } },
          ]
          : url.endsWith("/api/v1/queue/status")
            ? { totalCount: 2 }
            : url.includes("/api/v1/wanted/missing?")
              ? { totalRecords: 4, records: [] }
              : { message: "not found" };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("Lidarr returns read-only music library and activity metrics without leaking its key", async () => {
  const mock = mockLidarr();
  try {
    const payload = await testLidarrConnection({ url: "http://lidarr.test/" }, { apiKey: "lidarr-secret" });
    assert.equal(payload.ok, true);
    assert.equal(payload.provider, "lidarr");
    assert.equal(payload.server.name, "Music");
    assert.equal(payload.queue, 2);
    assert.equal(payload.wanted, 4);
    assert.deepEqual(payload.library, {
      artists: 3,
      monitoredArtists: 2,
      albums: 3,
      tracks: 25,
      trackFiles: 20,
    });
    assert.equal(mock.calls.length, 4);
    assert.ok(mock.calls.every((call) => !call.url.endsWith("/api/v1/album")));
    assert.ok(mock.calls.every((call) => call.apiKey === "lidarr-secret"));
    assert.ok(mock.calls.every((call) => !call.url.includes("lidarr-secret")));
    assert.ok(mock.calls.every((call) => call.url.includes("/api/v1/")));
  } finally {
    mock.restore();
  }
});

test("Lidarr plugin caches equal requests", async () => {
  const mock = mockLidarr();
  try {
    const config = { url: "http://lidarr-cache.test" };
    await fetchLidarrPlugin(config, { apiKey: "same-key" });
    await fetchLidarrPlugin(config, { apiKey: "same-key" });
    assert.equal(mock.calls.length, 4);
  } finally {
    mock.restore();
  }
});

test("Lidarr accepts a large artist summary while keeping the response bounded", async () => {
  const original = globalThis.fetch;
  const padding = "x".repeat(2 * 1024 * 1024);
  globalThis.fetch = async (input) => {
    const url = String(input);
    const payload = url.endsWith("/api/v1/system/status")
      ? { appName: "Lidarr", version: "3.1.2" }
      : url.endsWith("/api/v1/artist")
        ? [{ monitored: true, overview: padding, statistics: { albumCount: 12, totalTrackCount: 144, trackFileCount: 120 } }]
        : url.endsWith("/api/v1/queue/status")
          ? { totalCount: 0 }
          : { totalRecords: 0, records: [] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const payload = await testLidarrConnection({ url: "http://lidarr-large.test" }, { apiKey: "large-library-key" });
    assert.equal(payload.library.albums, 12);
    assert.equal(payload.library.tracks, 144);
    assert.equal(payload.library.trackFiles, 120);
  } finally {
    globalThis.fetch = original;
  }
});

test("Lidarr rejects artist summaries above the bounded library limit", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/api/v1/artist")) {
      return new Response("[]", { status: 200, headers: { "Content-Length": String(8 * 1024 * 1024 + 1) } });
    }
    const payload = url.endsWith("/api/v1/system/status")
      ? { appName: "Lidarr", version: "3.1.2" }
      : url.endsWith("/api/v1/queue/status") ? { totalCount: 0 } : { totalRecords: 0, records: [] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await assert.rejects(
      testLidarrConnection({ url: "http://lidarr-oversized.test" }, { apiKey: "bounded-library-key" }),
      /Lidarr returned too much data\./,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("Lidarr plugin gives a safe authentication error", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "secret details" }), { status: 401 });
  try {
    await assert.rejects(
      testLidarrConnection({ url: "http://lidarr-auth.test:8686" }, { apiKey: "never-echo-me" }),
      (error: Error) => {
        assert.match(error.message, /authentication failed/i);
        assert.doesNotMatch(error.message, /never-echo-me|secret details/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});

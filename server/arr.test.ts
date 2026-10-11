import assert from "node:assert/strict";
import test from "node:test";
import { fetchArrPlugin, testArrConnection } from "./arr.js";

function mockArr(provider: "radarr" | "sonarr") {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; apiKey: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, apiKey: headers.get("X-Api-Key") });
    const payload = url.endsWith("/api/v3/system/status")
      ? { appName: provider === "radarr" ? "Radarr" : "Sonarr", instanceName: provider === "radarr" ? "Movies" : "Television", version: "6.0.1" }
      : url.endsWith("/api/v3/movie")
        ? [
            { monitored: true, hasFile: true },
            { monitored: true, hasFile: false },
            { monitored: false, hasFile: true },
          ]
        : url.endsWith("/api/v3/series")
          ? [
              { monitored: true, statistics: { episodeCount: 24, episodeFileCount: 20 } },
              { monitored: false, statistics: { episodeCount: 10, episodeFileCount: 8 } },
            ]
          : url.endsWith("/api/v3/queue/status")
            ? { totalCount: 2, count: 2 }
            : url.includes("/api/v3/wanted/missing?")
              ? { totalRecords: 4, records: [] }
              : { message: "not found" };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

for (const provider of ["radarr", "sonarr"] as const) {
  test(`${provider} returns read-only library and activity metrics without leaking its key`, async () => {
    const mock = mockArr(provider);
    try {
      const payload = await testArrConnection(provider, { url: `http://${provider}.test/` }, { apiKey: `${provider}-secret` });
      assert.equal(payload.ok, true);
      assert.equal(payload.provider, provider);
      assert.equal(payload.queue, 2);
      assert.equal(payload.wanted, 4);
      assert.equal(payload.server.name, provider === "radarr" ? "Movies" : "Television");
      assert.deepEqual(payload.library, provider === "radarr"
        ? { items: 3, monitored: 2, files: 2, episodes: 0 }
        : { items: 2, monitored: 1, files: 28, episodes: 34 });
      assert.equal(mock.calls.length, 4);
      assert.ok(mock.calls.every((call) => call.apiKey === `${provider}-secret`));
      assert.ok(mock.calls.every((call) => !call.url.includes(`${provider}-secret`)));
    } finally {
      mock.restore();
    }
  });
}

test("Arr plugin caches equal requests and isolates providers", async () => {
  const mock = mockArr("radarr");
  try {
    const config = { url: "http://arr-cache.test" };
    await fetchArrPlugin("radarr", config, { apiKey: "same-key" });
    await fetchArrPlugin("radarr", config, { apiKey: "same-key" });
    assert.equal(mock.calls.length, 4);
    await fetchArrPlugin("sonarr", config, { apiKey: "same-key" });
    assert.equal(mock.calls.length, 8);
  } finally {
    mock.restore();
  }
});

test("Arr plugin gives a safe authentication error", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "secret details" }), { status: 401 });
  try {
    await assert.rejects(
      testArrConnection("sonarr", { url: "http://sonarr-auth.test:8989" }, { apiKey: "never-echo-me" }),
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

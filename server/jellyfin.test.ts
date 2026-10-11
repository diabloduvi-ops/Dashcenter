import assert from "node:assert/strict";
import test from "node:test";
import { fetchJellyfinArtwork, fetchJellyfinPlugin, testJellyfinConnection } from "./jellyfin.js";

const system = {
  ServerName: "Home Media",
  Version: "12.0.0",
  OperatingSystem: "Linux",
  HasPendingRestart: false,
};

const counts = {
  MovieCount: 245,
  SeriesCount: 38,
  EpisodeCount: 1284,
  SongCount: 912,
};

const sessions = [
  {
    Id: "session-1",
    Client: "Jellyfin Web",
    DeviceName: "Living room",
    UserName: "Alex",
    NowPlayingItem: {
      Id: "episode-1",
      Name: "The Quiet Harbour",
      SeriesName: "Harbour Lights",
      ParentIndexNumber: 3,
      IndexNumber: 4,
      RunTimeTicks: 2_535_000_000,
      PrimaryImageTag: "image-tag",
    },
    PlayState: { IsPaused: false, PositionTicks: 1_062_000_000 },
    TranscodingInfo: { VideoCodec: "h264", Height: 2160 },
  },
  { Id: "session-2", NowPlayingItem: { Id: "film-1", Name: "Episode" }, PlayState: { IsPaused: true, PlayMethod: "DirectPlay" } },
  { UserName: "Connected user" },
];

function mockJellyfin(expectedApiKey: string, status = 200) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; authorization: string | null; legacyToken: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const authorization = headers.get("Authorization");
    const legacyToken = headers.get("X-Emby-Token");
    calls.push({ url, authorization, legacyToken });
    if (status !== 200) return new Response(JSON.stringify({ error: "denied" }), { status });
    if (authorization !== `MediaBrowser Token="${expectedApiKey}"` || legacyToken !== null) {
      return new Response(JSON.stringify({ error: "legacy authentication disabled" }), { status: 401 });
    }
    const payload = url.endsWith("/System/Info")
      ? system
      : url.endsWith("/Items/Counts")
        ? counts
        : url.endsWith("/Sessions")
          ? sessions
          : { error: "not found" };
    return new Response(JSON.stringify(payload), {
      status: url.includes("not-found") ? 404 : 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("Jellyfin 12 uses MediaBrowser authorization for every API request", async () => {
  const mock = mockJellyfin("jellyfin-test-key");
  try {
    const result = await testJellyfinConnection(
      { url: "http://jellyfin.test:8096/" },
      { apiKey: "jellyfin-test-key" },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.server, {
      name: "Home Media",
      version: "12.0.0",
      operatingSystem: "Linux",
      pendingRestart: false,
    });
    assert.deepEqual(result.sessions, { connected: 3, playing: 1, paused: 1, transcoding: 1 });
    assert.deepEqual(result.library, { movies: 245, series: 38, episodes: 1284, songs: 912 });
    assert.equal(result.activity.active, 2);
    assert.equal(result.activity.truncated, false);
    assert.deepEqual(result.activity.sessions[0], {
      id: result.activity.sessions[0].id,
      title: "The Quiet Harbour",
      seriesTitle: "Harbour Lights",
      seasonNumber: 3,
      episodeNumber: 4,
      client: "Jellyfin Web",
      device: "Living room",
      username: "Alex",
      state: "playing",
      playMethod: "transcode",
      progressPercent: 41.9,
      positionSeconds: 106,
      durationSeconds: 253,
      quality: "4K",
      artworkId: result.activity.sessions[0].artworkId,
    });
    assert.match(result.activity.sessions[0].id, /^[a-f0-9]{24}$/);
    assert.match(result.activity.sessions[0].artworkId ?? "", /^[a-f0-9]{32}$/);
    assert.equal(result.activity.sessions[1].playMethod, "direct-play");
    assert.deepEqual(mock.calls.map((call) => new URL(call.url).pathname).sort(), [
      "/Items/Counts",
      "/Sessions",
      "/System/Info",
    ]);
    assert.ok(mock.calls.every((call) => call.authorization === 'MediaBrowser Token="jellyfin-test-key"'));
    assert.ok(mock.calls.every((call) => call.legacyToken === null));
    assert.ok(mock.calls.every((call) => !call.url.includes("jellyfin-test-key")));
  } finally {
    mock.restore();
  }
});

test("Jellyfin artwork uses the same MediaBrowser authorization without putting the key in the URL", async () => {
  const mock = mockJellyfin("artwork-test-key");
  try {
    const config = { url: "http://jellyfin-artwork.test:8096" };
    const credentials = { apiKey: "artwork-test-key" };
    const payload = await fetchJellyfinPlugin(config, credentials);
    const artworkId = payload.activity.sessions[0].artworkId;
    assert.ok(artworkId);
    const original = globalThis.fetch;
    let requestedUrl = "";
    let authorization = "";
    globalThis.fetch = async (input, init) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
      return new Response(png, { headers: { "Content-Type": "image/png" } });
    };
    try {
      const artwork = await fetchJellyfinArtwork(config, credentials, artworkId);
      assert.equal(artwork.contentType, "image/png");
      assert.equal(authorization, 'MediaBrowser Token="artwork-test-key"');
      assert.equal(new URL(requestedUrl).pathname, "/Items/episode-1/Images/Primary");
      assert.doesNotMatch(requestedUrl, /artwork-test-key/);
    } finally {
      globalThis.fetch = original;
    }
  } finally {
    mock.restore();
  }
});

test("Jellyfin payloads are cached briefly without exposing the API key", async () => {
  const mock = mockJellyfin("cache-test-key");
  try {
    const config = { url: "http://jellyfin-cache.test:8096" };
    const credentials = { apiKey: "cache-test-key" };
    const first = await fetchJellyfinPlugin(config, credentials);
    const second = await fetchJellyfinPlugin(config, credentials);
    assert.deepEqual(second, first);
    assert.equal(mock.calls.length, 3);
    assert.doesNotMatch(JSON.stringify(first), /cache-test-key/);
  } finally {
    mock.restore();
  }
});

test("Jellyfin authentication failures stay concise and do not echo credentials", async () => {
  const mock = mockJellyfin("never-echo-me", 401);
  try {
    await assert.rejects(
      testJellyfinConnection({ url: "http://jellyfin-auth.test:8096" }, { apiKey: "never-echo-me" }),
      (error: Error) => {
        assert.match(error.message, /authentication failed/i);
        assert.doesNotMatch(error.message, /never-echo-me/);
        return true;
      },
    );
  } finally {
    mock.restore();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  clearMediaArtworkForTests,
  fetchRegisteredMediaArtwork,
  registerMediaArtwork,
} from "./media-artwork.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("media artwork proxy serves only registered same-origin image paths", async () => {
  clearMediaArtworkForTests();
  const sourceKey = "jellyfin-source";
  const reference = registerMediaArtwork(sourceKey, "/Items/item-1/Images/Primary?tag=image-tag");
  assert.match(reference ?? "", /^[a-f0-9]{32}$/);
  const original = globalThis.fetch;
  let requestedUrl = "";
  let authorization = "";
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get("Authorization") ?? "";
    return new Response(PNG, { headers: { "Content-Type": "image/png", "Content-Length": String(PNG.length) } });
  };
  try {
    const result = await fetchRegisteredMediaArtwork(
      sourceKey,
      reference ?? "",
      "http://jellyfin.test:8096/",
      { Authorization: 'MediaBrowser Token="server-only-key"' },
    );
    assert.equal(result.contentType, "image/png");
    assert.deepEqual(result.buffer, PNG);
    assert.equal(new URL(requestedUrl).origin, "http://jellyfin.test:8096");
    assert.equal(authorization, 'MediaBrowser Token="server-only-key"');
    assert.doesNotMatch(requestedUrl, /server-only-key/);
  } finally {
    globalThis.fetch = original;
    clearMediaArtworkForTests();
  }
});

test("media artwork proxy rejects unregistered, oversized and spoofed responses", async () => {
  clearMediaArtworkForTests();
  await assert.rejects(
    fetchRegisteredMediaArtwork("source", "0".repeat(32), "http://plex.test:32400", {}),
    /no longer available/i,
  );

  const reference = registerMediaArtwork("source", "/library/metadata/1/thumb/2");
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(PNG, {
      headers: { "Content-Type": "image/png", "Content-Length": String(4 * 1024 * 1024 + 1) },
    });
    await assert.rejects(
      fetchRegisteredMediaArtwork("source", reference ?? "", "http://plex.test:32400", {}),
      /larger than 4 MB/i,
    );

    globalThis.fetch = async () => new Response("not an image", { headers: { "Content-Type": "image/png" } });
    await assert.rejects(
      fetchRegisteredMediaArtwork("source", reference ?? "", "http://plex.test:32400", {}),
      /do not match/i,
    );
  } finally {
    globalThis.fetch = original;
    clearMediaArtworkForTests();
  }
});

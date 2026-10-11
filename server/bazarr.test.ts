import assert from "node:assert/strict";
import test from "node:test";
import { fetchBazarrPlugin, testBazarrConnection } from "./bazarr.js";

test("Bazarr returns missing subtitle counts and caches equal requests", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    return new Response(JSON.stringify({ total: url.includes("/episodes/") ? 14 : 5 }), { status: 200 });
  };
  try {
    const config = { url: "http://bazarr.test:6767/" };
    const credentials = { apiKey: "bazarr-secret" };
    const result = await testBazarrConnection(config, credentials);
    assert.equal(result.missingEpisodes, 14);
    assert.equal(result.missingMovies, 5);
    assert.doesNotMatch(JSON.stringify(result), /bazarr-secret/);
    await fetchBazarrPlugin(config, credentials);
    await fetchBazarrPlugin(config, credentials);
    assert.equal(calls.length, 4);
  } finally { globalThis.fetch = original; }
});

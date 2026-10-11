import assert from "node:assert/strict";
import test from "node:test";
import { fetchProwlarrPlugin, testProwlarrConnection } from "./prowlarr.js";

test("Prowlarr aggregates indexer activity and keeps its key out of the payload", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ indexers: [
      { numberOfQueries: 12, numberOfGrabs: 4, numberOfFailedQueries: 2, numberOfFailedGrabs: 1 },
      { numberOfQueries: 8, numberOfGrabs: 3, numberOfFailedQueries: 0, numberOfFailedGrabs: 0 },
    ] }), { status: 200 });
  };
  try {
    const config = { url: "http://prowlarr.test:9696/" };
    const credentials = { apiKey: "prowlarr-secret" };
    const result = await testProwlarrConnection(config, credentials);
    assert.deepEqual({ indexers: result.indexers, queries: result.queries, grabs: result.grabs, failedQueries: result.failedQueries, failedGrabs: result.failedGrabs }, { indexers: 2, queries: 20, grabs: 7, failedQueries: 2, failedGrabs: 1 });
    assert.doesNotMatch(JSON.stringify(result), /prowlarr-secret/);
    await fetchProwlarrPlugin(config, credentials);
    await fetchProwlarrPlugin(config, credentials);
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = original; }
});

test("Prowlarr reports authentication failure without echoing secrets", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("secret upstream body", { status: 401 });
  try {
    await assert.rejects(testProwlarrConnection({ url: "http://prowlarr-auth.test" }, { apiKey: "never-echo" }), (error: Error) => {
      assert.match(error.message, /authentication failed/i);
      assert.doesNotMatch(error.message, /never-echo|secret upstream/);
      return true;
    });
  } finally { globalThis.fetch = original; }
});

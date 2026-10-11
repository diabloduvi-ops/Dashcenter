import assert from "node:assert/strict";
import test from "node:test";
import { fetchPortainerPlugin, testPortainerConnection } from "./portainer.js";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

test("Portainer adapter authenticates with X-API-Key and returns environment metrics", async () => {
  const original = globalThis.fetch;
  const requests: Array<{ url: string; apiKey: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, apiKey: new Headers(init?.headers).get("X-API-Key") ?? "" });
    if (url.endsWith("/api/endpoints")) {
      return json([
        { Id: 1, Name: "Local", Status: 1 },
        { Id: 2, Name: "Remote", Status: 2 },
      ]);
    }
    if (url.includes("/api/endpoints/1/docker/containers/json")) {
      return json([
        { State: "running", Status: "Up 2 hours (healthy)" },
        { State: "running", Status: "Up 2 hours" },
        { State: "exited", Status: "Exited (0)" },
      ]);
    }
    if (url.includes("/api/stacks?endpointId=1")) {
      return json([{ EndpointId: 1 }, { EndpointId: 1 }, { EndpointId: 2 }]);
    }
    return json({ message: "not found" }, 404);
  };

  try {
    const config = { url: "http://portainer-adapter.test:9000", endpointId: "1" };
    const credentials = { apiKey: "read-only-token" };
    const connection = await testPortainerConnection(config, credentials);
    assert.deepEqual(connection, {
      ok: true,
      endpoints: [
        { id: "1", name: "Local", status: "up" },
        { id: "2", name: "Remote", status: "down" },
      ],
      total: 2,
      online: 1,
    });
    const payload = await fetchPortainerPlugin(config, credentials);
    assert.equal(payload.mode, "endpoint");
    if (payload.mode === "endpoint") {
      assert.deepEqual(payload.endpoint, { id: "1", name: "Local", status: "up" });
      assert.deepEqual(payload.containers, { total: 3, running: 2, healthy: 1, stopped: 1 });
      assert.equal(payload.stacks, 2);
    }
    assert.ok(requests.every((request) => request.apiKey === "read-only-token"));
    assert.ok(requests.some((request) => request.url.endsWith("/api/endpoints")));
    assert.ok(requests.some((request) => request.url.includes("/docker/containers/json?all=true")));
  } finally {
    globalThis.fetch = original;
  }
});

test("Portainer adapter returns an overview when no environment is selected", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/api/endpoints")) return json([
      { Id: 1, Name: "Local", Status: 1 },
      { Id: 2, Name: "Remote", Status: 1 },
      { Id: 3, Name: "Offline", Status: 2 },
    ]);
    if (url.endsWith("/api/stacks")) return json([
      { EndpointId: 1 },
      { EndpointId: 2 },
      { EndpointId: 99 },
    ]);
    if (url.includes("/api/endpoints/1/docker/containers/json")) return json([
      { State: "running", Status: "Up 1 hour (healthy)" },
      { State: "exited", Status: "Exited (0)" },
    ]);
    if (url.includes("/api/endpoints/2/docker/containers/json")) return json([
      { State: "running", Status: "Up 2 hours" },
      { State: "running", Status: "Up 3 hours (healthy)" },
    ]);
    return json({ message: "not found" }, 404);
  };
  try {
    const payload = await fetchPortainerPlugin(
      { url: "http://portainer-overview.test:9000", endpointId: "" },
      { apiKey: "overview-token" },
    );
    assert.equal(payload.mode, "overview");
    if (payload.mode === "overview") {
      assert.equal(payload.endpoints, 3);
      assert.equal(payload.online, 2);
      assert.equal(payload.inspected, 2);
      assert.deepEqual(payload.containers, { total: 4, running: 3, healthy: 2, stopped: 1 });
      assert.equal(payload.stacks, 2);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("Portainer overview keeps partial metrics when one online environment cannot be inspected", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/api/endpoints")) return json([
      { Id: 11, Name: "Available", Status: 1 },
      { Id: 12, Name: "Unavailable", Status: 1 },
    ]);
    if (url.endsWith("/api/stacks")) return json([{ EndpointId: 11 }]);
    if (url.includes("/api/endpoints/11/docker/containers/json")) return json([
      { State: "running", Status: "Up 1 hour (healthy)" },
    ]);
    return json({ message: "gateway timeout" }, 504);
  };
  try {
    const payload = await fetchPortainerPlugin(
      { url: "http://portainer-partial-overview.test:9000", endpointId: "" },
      { apiKey: "partial-token" },
    );
    assert.equal(payload.mode, "overview");
    if (payload.mode === "overview") {
      assert.equal(payload.inspected, 1);
      assert.deepEqual(payload.containers, { total: 1, running: 1, healthy: 1, stopped: 0 });
      assert.equal(payload.stacks, 1);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("Portainer adapter reports authentication failures without exposing the token", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => json({ message: "Unauthorized" }, 401);
  try {
    await assert.rejects(
      () => testPortainerConnection(
        { url: "http://portainer-auth.test:9000", endpointId: "" },
        { apiKey: "do-not-leak-this-token" },
      ),
      (error: Error) => {
        assert.match(error.message, /authentication failed/i);
        assert.doesNotMatch(error.message, /do-not-leak-this-token/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});

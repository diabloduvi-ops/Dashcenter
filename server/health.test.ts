import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { DashboardService, DockerConnection } from "../shared/types.js";
import {
  checkServiceHealth,
  createHealthRefreshCoordinator,
  type ServiceHealthUpdate,
} from "./health.js";

function service(overrides: Partial<DashboardService> = {}): DashboardService {
  return {
    id: "service-1",
    groupId: "group-1",
    name: "Example",
    href: "https://example.test",
    description: "",
    icon: "",
    dockerServer: "",
    container: "",
    position: 0,
    visible: true,
    statusCheck: true,
    status: "unknown",
    ...overrides,
  };
}

function connection(overrides: Partial<DockerConnection> = {}): DockerConnection {
  return {
    id: "docker-1",
    name: "Docker host",
    type: "http",
    endpoint: "http://192.0.2.10:2375",
    enabled: true,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(predicate: () => boolean, timeoutMs = 250) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) assert.fail("Timed out waiting for health refresh");
    await delay(2);
  }
}

test("HTTP-only services still use their URL health check", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    const result = await checkServiceHealth(service(), []);
    assert.equal(fetchCalls, 1);
    assert.equal(result.status, "healthy");
    assert.match(result.message ?? "", /^HTTP 204/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an explicit HTTP source ignores a preserved Docker mapping", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    const result = await checkServiceHealth(service({
      statusSource: "http",
      dockerServer: "missing-but-preserved",
      container: "old-container",
    }), []);
    assert.equal(fetchCalls, 1);
    assert.equal(result.status, "healthy");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Uptime Kuma status reuses the selected plugin monitor and credentials", async () => {
  const originalFetch = globalThis.fetch;
  const identity = ["Public API", "http", "https://api.example.test/health", "", ""].join("\u0000");
  const monitorId = createHash("sha256").update(identity).digest("hex").slice(0, 24);
  let authorization = "";
  globalThis.fetch = (async (_input, init) => {
    authorization = new Headers(init?.headers).get("Authorization") ?? "";
    return new Response([
      'monitor_response_time{monitor_name="Public API",monitor_type="http",monitor_url="https://api.example.test/health",monitor_hostname="",monitor_port=""} 42.25',
      'monitor_status{monitor_name="Public API",monitor_type="http",monitor_url="https://api.example.test/health",monitor_hostname="",monitor_port=""} 1',
    ].join("\n"), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await checkServiceHealth(service({
      statusSource: "uptime-kuma",
      plugin: {
        type: "uptime-kuma",
        enabled: false,
        presentation: "summary",
        config: { url: "https://kuma-health.test", monitorId },
      },
    }), [], { apiKey: "health-secret" });
    assert.equal(result.status, "healthy");
    assert.equal(result.message, "Uptime Kuma: Public API is up · 42.3 ms");
    assert.equal(authorization, `Basic ${Buffer.from(":health-secret").toString("base64")}`);
    assert.doesNotMatch(result.message ?? "", /health-secret|api\.example\.test/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Uptime Kuma status never falls back when its credentials are missing", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("Unexpected fallback");
  }) as typeof fetch;

  try {
    const result = await checkServiceHealth(service({
      statusSource: "uptime-kuma",
      plugin: {
        type: "uptime-kuma",
        enabled: true,
        presentation: "summary",
        config: { url: "https://kuma-missing.test", monitorId: "selected-monitor" },
      },
    }), []);
    assert.equal(result.status, "unhealthy");
    assert.match(result.message ?? "", /API key is not configured/i);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("invalid Docker mappings never fall back to an HTTP check", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("Unexpected HTTP fallback");
  }) as typeof fetch;

  try {
    const cases: Array<{
      target: DashboardService;
      connections: DockerConnection[];
      message: RegExp;
    }> = [
      {
        target: service({ dockerServer: "missing", container: "app" }),
        connections: [],
        message: /was not found/i,
      },
      {
        target: service({ dockerServer: "docker-1", container: "app" }),
        connections: [connection({ enabled: false })],
        message: /is disabled/i,
      },
      {
        target: service({ dockerServer: "docker-1", container: "" }),
        connections: [connection()],
        message: /container name is required/i,
      },
      {
        target: service({ dockerServer: "", container: "app" }),
        connections: [connection()],
        message: /connection is required/i,
      },
    ];

    for (const item of cases) {
      const result = await checkServiceHealth(item.target, item.connections);
      assert.equal(result.status, "unhealthy");
      assert.match(result.message ?? "", item.message);
    }
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("health refresh coordinator coalesces runs and recovers after a failure", async () => {
  const first = deferred<ServiceHealthUpdate[]>();
  let calls = 0;
  const coordinator = createHealthRefreshCoordinator(async () => {
    calls += 1;
    if (calls === 1) return first.promise;
    if (calls === 2) throw new Error("temporary failure");
    return [];
  }, 60_000);

  const firstRun = coordinator.run();
  const duplicateRun = coordinator.run();
  assert.strictEqual(firstRun, duplicateRun);
  assert.equal(calls, 0);

  first.resolve([]);
  await firstRun;
  assert.equal(calls, 1);

  await assert.rejects(coordinator.run(), /temporary failure/);
  assert.equal(calls, 2);

  await coordinator.run();
  assert.equal(calls, 3);
  await coordinator.stop();
});

test("scheduled refresh recovers from errors and stop prevents another tick", async () => {
  let calls = 0;
  let reportedErrors = 0;
  const coordinator = createHealthRefreshCoordinator(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error("first scheduled failure");
      return [];
    },
    5,
    () => {
      reportedErrors += 1;
    },
  );

  coordinator.start();
  await waitFor(() => calls >= 2);
  assert.equal(reportedErrors, 1);

  await coordinator.stop();
  const callsAfterStop = calls;
  await delay(20);
  assert.equal(calls, callsAfterStop);
});

test("stop waits for an in-flight health refresh", async () => {
  const gate = deferred<ServiceHealthUpdate[]>();
  let calls = 0;
  let stopped = false;
  const coordinator = createHealthRefreshCoordinator(async () => {
    calls += 1;
    return gate.promise;
  }, 60_000);

  coordinator.start();
  const running = coordinator.run();
  const stopping = coordinator.stop().then(() => {
    stopped = true;
  });

  await delay(0);
  assert.equal(stopped, false);

  gate.resolve([]);
  await Promise.all([running, stopping]);
  assert.equal(stopped, true);
  assert.equal(calls, 1);

  await delay(10);
  assert.equal(calls, 1);
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DockerConnection } from "../shared/types.js";
import {
  appendSystemResourceHistory,
  calculateCpuUsedPercent,
  clearSystemResourceCachesForTests,
  selectSystemResourceDockerConnection,
  SYSTEM_HISTORY_MAX_SAMPLES,
  SYSTEM_HISTORY_SAMPLE_INTERVAL_MS,
} from "./system-resources.js";
import { createDatabase } from "./database.js";
import { buildApp } from "./index.js";

test("system resource CPU usage is calculated from counter deltas and bounded", () => {
  assert.equal(calculateCpuUsedPercent({ idle: 40, total: 100 }, { idle: 60, total: 200 }), 80);
  assert.equal(calculateCpuUsedPercent({ idle: 100, total: 100 }, { idle: 90, total: 200 }), 100);
  assert.equal(calculateCpuUsedPercent({ idle: 50, total: 100 }, { idle: 50, total: 100 }), 0);
});

test("system resource history replaces the current bucket and stays bounded", () => {
  const start = Date.parse("2026-09-24T00:00:00.000Z");
  let samples = appendSystemResourceHistory([], {
    sampledAt: new Date(start).toISOString(),
    cpuUsedPercent: 10,
    memoryUsedPercent: 20,
  }, start);
  samples = appendSystemResourceHistory(samples, {
    sampledAt: new Date(start + 1_000).toISOString(),
    cpuUsedPercent: 11,
    memoryUsedPercent: 21,
  }, start + 1_000);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].cpuUsedPercent, 11);

  for (let index = 1; index <= SYSTEM_HISTORY_MAX_SAMPLES + 4; index += 1) {
    const timestamp = start + index * SYSTEM_HISTORY_SAMPLE_INTERVAL_MS;
    samples = appendSystemResourceHistory(samples, {
      sampledAt: new Date(timestamp).toISOString(),
      cpuUsedPercent: index % 101,
      memoryUsedPercent: index % 101,
    }, timestamp);
  }
  assert.equal(samples.length, SYSTEM_HISTORY_MAX_SAMPLES);
  assert.ok(Date.parse(samples.at(-1)?.sampledAt ?? "") > Date.parse(samples[0].sampledAt));
});

test("Docker composition is automatic only for one enabled connection", () => {
  const connection = (id: string, enabled = true): DockerConnection => ({
    id,
    name: id,
    type: "http",
    endpoint: `http://${id}.test`,
    enabled,
  });
  assert.equal(selectSystemResourceDockerConnection([connection("one")])?.id, "one");
  assert.equal(selectSystemResourceDockerConnection([connection("one"), connection("two")]), undefined);
  assert.equal(selectSystemResourceDockerConnection([connection("one"), connection("two")], "two")?.id, "two");
  assert.equal(selectSystemResourceDockerConnection([connection("one", false)], "one"), undefined);
});

test("system resource endpoint exposes bounded aggregate host metrics and history", async () => {
  clearSystemResourceCachesForTests();
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-system-resources-"));
  const database = createDatabase(":memory:");
  database.prepare("INSERT INTO dashboard_widgets (id, type, enabled, position, config) VALUES (?, ?, ?, ?, ?)")
    .run("resources-test", "system-resources", 1, 10, "{}");
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });
  try {
    const response = await app.inject({ method: "GET", url: "/api/system/resources?includeHistory=1" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    const payload = response.json();
    assert.ok(payload.cpu.usedPercent >= 0 && payload.cpu.usedPercent <= 100);
    assert.ok(payload.cpu.cores >= 1);
    assert.ok(payload.memory.usedBytes >= 0 && payload.memory.usedBytes <= payload.memory.totalBytes);
    assert.ok(payload.disk.usedBytes >= 0 && payload.disk.usedBytes <= payload.disk.totalBytes);
    assert.ok(payload.uptimeSeconds >= 0);
    assert.ok(payload.loadAverage === null || payload.loadAverage.oneMinute >= 0);
    assert.equal(payload.history.scope, "process");
    assert.equal(payload.history.samples.length, 1);
    assert.ok(payload.history.samples.length <= SYSTEM_HISTORY_MAX_SAMPLES);
    assert.equal(typeof payload.updatedAt, "string");
    assert.equal("hostname" in payload, false);
    assert.equal("platform" in payload, false);
  } finally {
    await app.close();
    database.close();
    clearSystemResourceCachesForTests();
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test("server health composes Docker counts without failing host metrics", async () => {
  clearSystemResourceCachesForTests();
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-system-containers-"));
  const database = createDatabase(":memory:");
  database.prepare("INSERT INTO dashboard_widgets (id, type, enabled, position, config) VALUES (?, ?, ?, ?, ?)")
    .run("health-test", "server-health", 1, 10, "{}");
  database.prepare("UPDATE docker_connections SET type = 'http', endpoint = 'http://docker.test', enabled = 1 WHERE id = 'docker-local'").run();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([
    { Id: "one", Names: ["/web"], Image: "web", State: "running", Status: "Up 2 hours (healthy)" },
    { Id: "two", Names: ["/worker"], Image: "worker", State: "exited", Status: "Exited (1)" },
  ]), { status: 200, headers: { "Content-Type": "application/json" } });
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });
  try {
    const response = await app.inject({ method: "GET", url: "/api/system/resources?includeContainers=1" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().containers, { total: 2, running: 1, stopped: 1, healthy: 1, unhealthy: 0 });

    clearSystemResourceCachesForTests();
    globalThis.fetch = async () => { throw new Error("Docker unavailable"); };
    const partial = await app.inject({ method: "GET", url: "/api/system/resources?includeContainers=1" });
    assert.equal(partial.statusCode, 200);
    assert.equal("containers" in partial.json(), false);
    assert.ok(partial.json().cpu.usedPercent >= 0);
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
    database.close();
    clearSystemResourceCachesForTests();
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

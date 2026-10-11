import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DashboardData } from "../shared/types.js";
import { createDatabase } from "./database.js";
import { buildApp } from "./index.js";

test("Docker connection creation ignores client IDs and allocates unique server IDs", async () => {
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-docker-connections-"));
  const database = createDatabase(":memory:");

  process.env.DEV_BYPASS_AUTH = "1";
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false });

  try {
    const existingIds = new Set(
      (await app.inject({ method: "GET", url: "/api/docker/connections" })).json<Array<{ id: string }>>().map(
        (connection) => connection.id,
      ),
    );
    assert.ok(existingIds.has("docker-local"));

    const duplicateIdResponse = await app.inject({
      method: "POST",
      url: "/api/docker/connections",
      payload: {
        id: "docker-local",
        name: "Remote Docker",
        type: "http",
        endpoint: "http://192.0.2.10:2375",
        enabled: true,
      },
    });
    assert.equal(duplicateIdResponse.statusCode, 200);

    const firstDashboard = duplicateIdResponse.json<DashboardData>();
    const firstCreated = firstDashboard.connections.find((connection) => connection.name === "Remote Docker");
    assert.ok(firstCreated);
    assert.match(firstCreated.id, /^docker-[0-9a-f-]{36}$/);
    assert.notEqual(firstCreated.id, "docker-local");
    assert.ok(!existingIds.has(firstCreated.id));

    const invalidIdResponse = await app.inject({
      method: "POST",
      url: "/api/docker/connections",
      payload: {
        id: "../invalid client id",
        name: "Another Docker",
        type: "http",
        endpoint: "http://192.0.2.11:2375",
        enabled: true,
      },
    });
    assert.equal(invalidIdResponse.statusCode, 200);

    const secondDashboard = invalidIdResponse.json<DashboardData>();
    const secondCreated = secondDashboard.connections.find((connection) => connection.name === "Another Docker");
    assert.ok(secondCreated);
    assert.match(secondCreated.id, /^docker-[0-9a-f-]{36}$/);
    assert.notEqual(secondCreated.id, firstCreated.id);
    assert.notEqual(secondCreated.id, "../invalid client id");
  } finally {
    await app.close();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

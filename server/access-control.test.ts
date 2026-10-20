import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DashboardData } from "../shared/types.js";
import { createDatabase, openAppDatabase, readDashboard, replaceDashboard } from "./database.js";
import { buildApp } from "./index.js";

function temporaryData() {
  const directory = mkdtempSync(path.join(tmpdir(), "dashcenter-access-"));
  const database = createDatabase(":memory:");
  return { directory, database };
}

test("first-run choice creates an empty or neutral demo board without changing existing dashboards", async () => {
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  delete process.env.DEV_BYPASS_AUTH;
  try {
    for (const starter of ["empty", "demo"] as const) {
      const { directory, database } = temporaryData();
      const app = await buildApp({ database, dataDirectory: directory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });
      try {
        const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "admin", password: "example-password", starter } });
        assert.equal(setup.statusCode, 200);
        const dashboard = readDashboard(database);
        assert.equal(dashboard.connections.length, 0);
        assert.equal((database.prepare("SELECT count(*) AS count FROM revisions").get() as { count: number }).count, 1);
        if (starter === "empty") {
          assert.deepEqual(dashboard.groups, []);
          assert.deepEqual(dashboard.widgets, []);
          assert.deepEqual(dashboard.layout, []);
        } else {
          assert.equal(dashboard.groups.length, 1);
          assert.ok(dashboard.groups[0].services.every((service) => new URL(service.href).hostname.endsWith("example.com") || new URL(service.href).hostname.endsWith("example.org")));
          assert.doesNotMatch(JSON.stringify(dashboard), /Facebook|Bitdefender|Websupport|docker-local/);
        }
      } finally {
        await app.close();
        database.close();
        rmSync(directory, { recursive: true, force: true });
      }
    }

    const { directory, database } = temporaryData();
    replaceDashboard(database, { ...readDashboard(database), settings: { ...readDashboard(database).settings, title: "Existing board" } });
    const app = await buildApp({ database, dataDirectory: directory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });
    try {
      assert.equal((await app.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "admin", password: "example-password", starter: "empty" } })).statusCode, 200);
      assert.equal(readDashboard(database).settings.title, "Existing board");
      assert.ok(readDashboard(database).groups.length > 0);
    } finally {
      await app.close();
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  } finally {
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

test("a fresh production data directory starts empty and reopening preserves saved data", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dashcenter-fresh-data-"));
  let database = openAppDatabase(directory);
  try {
    const initial = readDashboard(database);
    assert.deepEqual(initial.groups, []);
    assert.deepEqual(initial.widgets, []);
    assert.deepEqual(initial.connections, []);
    database.close();
    database = openAppDatabase(directory);
    assert.deepEqual(readDashboard(database).groups, []);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("private dashboard blocks anonymous data and uploads but keeps health and sign-in available", async () => {
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  delete process.env.DEV_BYPASS_AUTH;
  const { directory, database } = temporaryData();
  const current = readDashboard(database);
  replaceDashboard(database, { ...current, settings: { ...current.settings, requireSignIn: true } });
  const app = await buildApp({ database, dataDirectory: directory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });
  try {
    for (const url of ["/api/dashboard", "/api/weather", "/api/system/resources", "/api/widgets/feed-reader/missing", "/uploads/example.png"]) {
      assert.equal((await app.inject({ method: "GET", url })).statusCode, 401, url);
    }
    assert.equal((await app.inject({ method: "GET", url: "/api/healthz" })).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: "/api/auth/state" })).json<{ requireSignIn: boolean }>().requireSignIn, true);
    const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "admin", password: "example-password" } });
    const cookie = String(setup.headers["set-cookie"]).split(";", 1)[0];
    assert.equal((await app.inject({ method: "GET", url: "/api/dashboard", headers: { cookie } })).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: "/api/dashboard" })).statusCode, 401);
  } finally {
    await app.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

test("signed-in groups are absent from public data while signed-in users can read them", async () => {
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  delete process.env.DEV_BYPASS_AUTH;
  const { directory, database } = temporaryData();
  const current = readDashboard(database);
  const signedInId = current.groups[1].id;
  const hiddenId = current.groups[2].id;
  replaceDashboard(database, {
    ...current,
    groups: current.groups.map((group) => group.id === signedInId
      ? { ...group, visibility: "signed-in", visible: true }
      : group.id === hiddenId ? { ...group, visibility: "hidden", visible: false } : group),
  });
  const app = await buildApp({ database, dataDirectory: directory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });
  try {
    const publicData = (await app.inject({ method: "GET", url: "/api/dashboard" })).json<DashboardData>();
    assert.equal(publicData.groups.some((group) => group.id === signedInId || group.id === hiddenId), false);
    const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "admin", password: "example-password" } });
    const cookie = String(setup.headers["set-cookie"]).split(";", 1)[0];
    const signedInData = (await app.inject({ method: "GET", url: "/api/dashboard", headers: { cookie } })).json<DashboardData>();
    assert.equal(signedInData.groups.find((group) => group.id === signedInId)?.visibility, "signed-in");
    assert.equal(signedInData.groups.find((group) => group.id === hiddenId)?.visible, false);
    const shown = await app.inject({ method: "PATCH", url: `/api/groups/${hiddenId}`, headers: { cookie }, payload: { visibility: "signed-in" } });
    assert.equal(shown.statusCode, 200);
    assert.equal(readDashboard(database).groups.find((group) => group.id === hiddenId)?.visibility, "signed-in");
    assert.equal((await app.inject({ method: "GET", url: "/api/dashboard" })).json<DashboardData>().groups.some((group) => group.id === hiddenId), false);
  } finally {
    await app.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

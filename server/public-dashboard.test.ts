import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DashboardData, DashboardGroup } from "../shared/types.js";
import { createDatabase, readDashboard, replaceDashboard } from "./database.js";
import { buildApp } from "./index.js";

test("anonymous dashboard responses contain only published content", async () => {
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  delete process.env.DEV_BYPASS_AUTH;
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-public-"));
  const database = createDatabase(":memory:");

  try {
    const initial = readDashboard(database);
    const visibleGroup = initial.groups[0];
    const visibleService = visibleGroup.services[0];
    const privateService = {
      ...visibleService,
      id: "private-service",
      groupId: visibleGroup.id,
      visible: false,
      href: "https://private-service.example/",
    };
    const hiddenGroup: DashboardGroup = {
      ...visibleGroup,
      id: "private-group",
      name: "Private group",
      visible: false,
      services: [{
        ...visibleService,
        id: "private-group-service",
        groupId: "private-group",
        plugin: { type: "beszel", enabled: true, presentation: "expanded", config: { url: "http://private.example:8090", version: 2 } },
      }],
    };
    const dashboard: DashboardData = {
      ...initial,
      groups: [
        {
          ...visibleGroup,
          services: [
            {
              ...visibleService,
              plugin: { type: "beszel", enabled: true, presentation: "expanded", config: { url: "http://private.example:8090", apiKey: "private-marker" } },
              legacyConfig: { secret: "private-marker" },
              dockerServer: "private-docker",
              container: "private-container",
              statusMessage: "Internal Docker endpoint private-marker failed",
            },
            privateService,
            ...visibleGroup.services.slice(1),
          ],
        },
        ...initial.groups.slice(1),
        hiddenGroup,
      ],
      widgets: [
        ...initial.widgets,
        { id: "public-api", type: "custom-api", enabled: true, position: 100, config: { url: "http://private.example/api", label: "Public metric", apiKey: "private-marker" } },
        { id: "private-api", type: "custom-api", enabled: false, position: 101, config: { url: "http://private.example/hidden" } },
        { id: "media", type: "media-activity", enabled: true, position: 102, config: { serviceIds: [visibleService.id, "private-service"] } },
      ],
      connections: [{ id: "private-docker", name: "Private Docker", type: "http", endpoint: "http://private.example:2375", enabled: true }],
    };
    replaceDashboard(database, dashboard);
    const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });

    try {
      const anonymous = (await app.inject({ method: "GET", url: "/api/dashboard" })).json<DashboardData>();
      assert.equal(anonymous.groups.some((group) => group.id === "private-group"), false);
      assert.equal(anonymous.groups.some((group) => group.services.some((service) => service.id === "private-service")), false);
      assert.deepEqual(anonymous.connections, []);
      assert.deepEqual(anonymous.groups[0].services[0].plugin?.config, {});
      assert.equal(anonymous.groups[0].services[0].legacyConfig, undefined);
      assert.equal(anonymous.groups[0].services[0].dockerServer, "configured");
      assert.equal(anonymous.groups[0].services[0].container, "");
      assert.equal(anonymous.groups[0].services[0].statusMessage, undefined);
      assert.deepEqual(anonymous.widgets.find((widget) => widget.id === "public-api")?.config, { label: "Public metric", url: "configured" });
      assert.equal(anonymous.widgets.some((widget) => widget.id === "private-api"), false);
      assert.deepEqual(anonymous.widgets.find((widget) => widget.id === "media")?.config.serviceIds, [visibleService.id]);
      assert.equal(JSON.stringify(anonymous).includes("private-marker"), false);

      for (const url of ["/api/groups", "/api/services", "/api/settings", "/api/widgets", "/api/services/private-service"]) {
        assert.equal((await app.inject({ method: "GET", url })).statusCode, 401);
      }
      assert.equal((await app.inject({ method: "GET", url: "/api/services/private-group-service/plugin" })).statusCode, 404);
      assert.equal((await app.inject({ method: "GET", url: "/api/system/resources?includeContainers=1&dockerConnectionId=private-docker" })).statusCode, 404);

      const setup = await app.inject({
        method: "POST",
        url: "/api/auth/setup",
        payload: { username: "admin", password: "correct-horse-battery-staple" },
      });
      assert.equal(setup.statusCode, 200);
      const cookie = String(setup.headers["set-cookie"]).split(";", 1)[0];
      const admin = (await app.inject({ method: "GET", url: "/api/dashboard", headers: { cookie } })).json<DashboardData>();
      assert.equal(admin.groups.some((group) => group.id === "private-group"), true);
      assert.equal(admin.connections[0].endpoint, "http://private.example:2375");
      assert.equal((await app.inject({ method: "GET", url: "/api/groups", headers: { cookie } })).statusCode, 200);
      assert.equal((await app.inject({ method: "GET", url: "/api/services/private-group-service/plugin", headers: { cookie } })).statusCode, 409);
    } finally {
      await app.close();
    }
  } finally {
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

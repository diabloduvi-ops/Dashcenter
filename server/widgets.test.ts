import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DashboardData, DashboardWidget } from "../shared/types.js";
import {
  dashboardWidgetPlacement,
  defaultWidgetConfig,
  migrateLegacyWidgets,
  moveDashboardWidget,
  synchronizeLegacyWidgetSettings,
} from "../shared/widgets.js";
import { createDatabase, readDashboard } from "./database.js";
import { buildApp } from "./index.js";

test("widget helpers centralize defaults, ordering, and legacy settings", () => {
  const database = createDatabase(":memory:");
  try {
    const dashboard = readDashboard(database);
    const legacySettings = {
      ...dashboard.settings,
      showSearch: false,
      showClock: true,
      showWeather: false,
      weatherLabel: "Bratislava",
      weatherLatitude: 48.1486,
      weatherLongitude: 17.1077,
    };
    const legacyWidgets: DashboardWidget[] = [
      { id: "weather", type: "weather", enabled: true, position: 7, config: {} },
      { id: "search", type: "search", enabled: true, position: 3, config: {} },
      { id: "clock", type: "clock", enabled: false, position: 5, config: { format: "12h" } },
    ];

    const migrated = migrateLegacyWidgets(legacySettings, legacyWidgets);
    assert.deepEqual(migrated.map((widget) => widget.id), ["search", "clock", "weather"]);
    assert.deepEqual(migrated.map((widget) => widget.position), [0, 1, 2]);
    assert.equal(migrated.find((widget) => widget.type === "search")?.enabled, false);
    assert.equal(migrated.find((widget) => widget.type === "clock")?.config.format, "12h");
    assert.deepEqual(migrated.find((widget) => widget.type === "weather")?.config, {
      label: "Bratislava",
      latitude: 48.1486,
      longitude: 17.1077,
    });

    const moved = moveDashboardWidget(migrated, "weather", -1);
    assert.deepEqual(moved.map((widget) => widget.id), ["search", "weather", "clock"]);
    const synchronized = synchronizeLegacyWidgetSettings(legacySettings, moved);
    assert.equal(synchronized.showSearch, false);
    assert.equal(synchronized.showClock, true);
    assert.equal(synchronized.showWeather, false);
    assert.equal(synchronized.weatherLabel, "Bratislava");
    assert.deepEqual(defaultWidgetConfig("docker", legacySettings), { display: "summary" });
    assert.deepEqual(defaultWidgetConfig("system-resources", legacySettings), { refreshSeconds: 5 });
    assert.deepEqual(defaultWidgetConfig("service-availability", legacySettings), {});
    assert.deepEqual(defaultWidgetConfig("service-health", legacySettings), {});
    assert.deepEqual(defaultWidgetConfig("media-activity", legacySettings), { label: "Now playing", serviceIds: [], maxSessions: 4, showArtwork: true });
    assert.deepEqual(defaultWidgetConfig("network-traffic", legacySettings), { label: "Network", serviceId: "" });
    assert.deepEqual(defaultWidgetConfig("calendar-agenda", legacySettings), { label: "Agenda", daysAhead: 14, maxEvents: 8 });
    assert.deepEqual(defaultWidgetConfig("feed-reader", legacySettings), { label: "Latest news", mode: "articles", maxItems: 6, maxAgeDays: 30, showImages: true });
    assert.equal(dashboardWidgetPlacement("system-resources"), "topbar");
    assert.equal(dashboardWidgetPlacement("service-availability"), "topbar");
    assert.equal(dashboardWidgetPlacement("service-health"), "dashboard");
    assert.equal(dashboardWidgetPlacement("media-activity"), "dashboard");
    assert.equal(dashboardWidgetPlacement("network-traffic"), "dashboard");
    assert.equal(dashboardWidgetPlacement("custom-api"), "dashboard");
    assert.equal(dashboardWidgetPlacement("calendar-agenda"), "dashboard");
    assert.equal(dashboardWidgetPlacement("feed-reader"), "dashboard");

    const mixed: DashboardWidget[] = [
      { id: "search", type: "search", enabled: true, position: 0, config: {} },
      { id: "custom", type: "custom-api", enabled: true, position: 1, config: {} },
      { id: "clock", type: "clock", enabled: true, position: 2, config: {} },
    ];
    assert.deepEqual(moveDashboardWidget(mixed, "clock", -1).map((widget) => widget.id), ["clock", "custom", "search"]);
  } finally {
    database.close();
  }
});

test("existing databases migrate legacy widget visibility and weather settings once", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dashcenter-widget-migration-"));
  const filename = path.join(directory, "app.db");
  let database = createDatabase(filename);

  try {
    const settings = {
      ...readDashboard(database).settings,
      showSearch: false,
      showClock: false,
      showWeather: true,
      weatherLabel: "Bratislava",
      weatherLatitude: 48.1486,
      weatherLongitude: 17.1077,
    };
    database.prepare("UPDATE dashboard_settings SET payload = ? WHERE id = 1").run(JSON.stringify(settings));
    database.prepare("UPDATE dashboard_widgets SET enabled = 1, config = '{}' ").run();
    database.prepare("DELETE FROM app_meta WHERE key = 'widget_model_v1'").run();
    database.close();

    database = createDatabase(filename);
    const migrated = readDashboard(database);
    assert.equal(migrated.widgets.find((widget) => widget.type === "search")?.enabled, false);
    assert.equal(migrated.widgets.find((widget) => widget.type === "clock")?.enabled, false);
    const weather = migrated.widgets.find((widget) => widget.type === "weather");
    assert.equal(weather?.enabled, true);
    assert.deepEqual(weather?.config, {
      label: "Bratislava",
      latitude: 48.1486,
      longitude: 17.1077,
    });

    database.prepare("UPDATE dashboard_widgets SET enabled = 1 WHERE type = 'search'").run();
    database.close();
    database = createDatabase(filename);
    assert.equal(readDashboard(database).widgets.find((widget) => widget.type === "search")?.enabled, true);
  } finally {
    try {
      database.close();
    } catch {
      // The database can already be closed if reopening failed.
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("widget API creates, updates, reorders, and deletes revision-backed widgets", async () => {
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-widget-api-"));
  const database = createDatabase(":memory:");
  process.env.DEV_BYPASS_AUTH = "1";
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false });

  try {
    const initial = (await app.inject({ method: "GET", url: "/api/dashboard" })).json<DashboardData>();
    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/widgets",
      payload: {
        type: "custom-api",
        enabled: true,
        config: { label: "Builds", url: "https://status.example.com/api", path: "count" },
      },
    });
    assert.equal(createdResponse.statusCode, 200);
    const createdDashboard = createdResponse.json<DashboardData>();
    const created = createdDashboard.widgets.find((widget) => widget.config.label === "Builds");
    assert.ok(created);
    assert.ok(createdDashboard.layout?.some((item) => item.kind === "widget" && item.referenceId === created.id));
    assert.ok(createdDashboard.revision > initial.revision);

    const updatedResponse = await app.inject({
      method: "PATCH",
      url: `/api/widgets/${created.id}`,
      payload: { enabled: false, config: { ...created.config, label: "Deployments" } },
    });
    assert.equal(updatedResponse.statusCode, 200);
    assert.equal(
      updatedResponse.json<DashboardData>().widgets.find((widget) => widget.id === created.id)?.config.label,
      "Deployments",
    );

    const order = [created.id, ...initial.widgets.map((widget) => widget.id)];
    const reorderedResponse = await app.inject({
      method: "POST",
      url: "/api/reorder",
      payload: { widgets: order },
    });
    assert.equal(reorderedResponse.statusCode, 200);
    assert.equal(reorderedResponse.json<DashboardData>().widgets[0].id, created.id);

    const reloadedDashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json<DashboardData>();
    assert.deepEqual(reloadedDashboard.widgets.map((widget) => widget.id), order);
    assert.deepEqual(reloadedDashboard.widgets.map((widget) => widget.position), order.map((_, position) => position));

    const deletedResponse = await app.inject({ method: "DELETE", url: `/api/widgets/${created.id}` });
    assert.equal(deletedResponse.statusCode, 200);
    assert.equal(deletedResponse.json<DashboardData>().widgets.some((widget) => widget.id === created.id), false);
    assert.equal(deletedResponse.json<DashboardData>().layout?.some((item) => item.referenceId === created.id), false);
  } finally {
    await app.close();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  createDatabase,
  readDashboard,
  replaceDashboard,
  restoreRevision,
  seedDatabase,
} from "./database.js";

test("a new database is seeded once with the neutral Dashcenter dashboard", () => {
  const database = createDatabase(":memory:");
  try {
    const dashboard = readDashboard(database);
    assert.equal(dashboard.settings.title, "Dashcenter");
    assert.ok(dashboard.groups.length >= 6);
    assert.ok(dashboard.groups.every((group) => group.icon === ""));
    assert.ok(dashboard.groups.every((group) => group.columnSpan === 1));
    assert.ok(dashboard.groups.every((group) => group.columnStart === 0));
    assert.ok(dashboard.groups.every((group) => group.gapBefore === 0));
    assert.ok(dashboard.groups.every((group) => group.direction === "horizontal"));
    assert.ok(dashboard.groups.some((group) => group.name === "Docker Services"));
    assert.ok(dashboard.groups.some((group) => group.services.some((service) => service.name === "Nginx Proxy Manager")));
    assert.equal(dashboard.layout?.length, dashboard.groups.length);
    assert.ok(dashboard.layout?.every((item) => item.kind === "group"));
    assert.equal(seedDatabase(database), false);

    const serialized = JSON.stringify(dashboard);
    assert.doesNotMatch(serialized, /100\.\d+\.\d+\.\d+/);
    assert.match(serialized, /example\.com/);
  } finally {
    database.close();
  }
});

test("calling the seed routine again does not overwrite user changes", () => {
  const database = createDatabase(":memory:");
  try {
    database.prepare("UPDATE dashboard_settings SET payload = ? WHERE id = 1").run(
      JSON.stringify({ ...readDashboard(database).settings, title: "My dashboard" }),
    );
    assert.equal(seedDatabase(database), false);
    assert.equal(readDashboard(database).settings.title, "My dashboard");
  } finally {
    database.close();
  }
});

test("unified dashboard grid persists mixed group and widget placement", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dashcenter-unified-grid-"));
  const filename = path.join(directory, "app.db");
  let database = createDatabase(filename);
  try {
    const dashboard = readDashboard(database);
    dashboard.widgets.push({ id: "server-health", type: "server-health", enabled: true, position: 3, config: { refreshSeconds: 10 } });
    dashboard.layout = [
      { id: "widget:server-health", kind: "widget", referenceId: "server-health", position: 0, columnSpan: 2, columnStart: 2, rowSpan: 2 },
      ...(dashboard.layout ?? []).map((item, index) => ({ ...item, position: index + 1 })),
    ];
    replaceDashboard(database, dashboard, "Unified board configured");
    database.close();

    database = createDatabase(filename);
    const restored = readDashboard(database);
    assert.deepEqual(restored.layout?.[0], {
      id: "widget:server-health",
      kind: "widget",
      referenceId: "server-health",
      position: 0,
      columnSpan: 2,
      columnStart: 2,
      rowSpan: 2,
    });
    assert.equal(restored.layout?.length, restored.groups.length + 1);
  } finally {
    try { database.close(); } catch { /* already closed */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("group icons and layout persist across a database reopen", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dashcenter-group-layout-"));
  const filename = path.join(directory, "app.db");
  let database = createDatabase(filename);

  try {
    const dashboard = readDashboard(database);
    dashboard.groups[0].icon = "mdi-server-#53d39b";
    dashboard.groups[0].columnSpan = 4;
    dashboard.groups[0].columnStart = 2;
    dashboard.groups[0].gapBefore = 72;
    dashboard.groups[0].direction = "vertical";
    replaceDashboard(database, dashboard, "Group layout configured");
    database.close();

    database = createDatabase(filename);
    const persisted = readDashboard(database).groups[0];
    assert.equal(persisted.icon, "mdi-server-#53d39b");
    assert.equal(persisted.columnSpan, 4);
    assert.equal(persisted.columnStart, 2);
    assert.equal(persisted.gapBefore, 72);
    assert.equal(persisted.direction, "vertical");
  } finally {
    try {
      database.close();
    } catch {
      // The first connection may already be closed if reopening failed.
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("existing databases are migrated without losing legacy groups", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dashcenter-group-migration-"));
  const filename = path.join(directory, "app.db");
  const legacyDatabase = new DatabaseSync(filename);

  legacyDatabase.exec([
    "CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    "INSERT INTO app_meta (key, value) VALUES ('seeded', '1');",
    "CREATE TABLE dashboard_groups (",
    "  id TEXT PRIMARY KEY,",
    "  name TEXT NOT NULL,",
    "  position INTEGER NOT NULL,",
    "  visible INTEGER NOT NULL DEFAULT 1",
    ");",
    "INSERT INTO dashboard_groups (id, name, position, visible)",
    "  VALUES ('legacy-group', 'Legacy group', 7, 1);",
    "CREATE TABLE dashboard_services (",
    "  id TEXT PRIMARY KEY, group_id TEXT NOT NULL, name TEXT NOT NULL, href TEXT NOT NULL,",
    "  description TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '',",
    "  docker_server TEXT NOT NULL DEFAULT '', container TEXT NOT NULL DEFAULT '',",
    "  position INTEGER NOT NULL, visible INTEGER NOT NULL DEFAULT 1,",
    "  status_check INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'unknown',",
    "  status_message TEXT, legacy_config TEXT",
    ");",
    "INSERT INTO dashboard_services (id, group_id, name, href, docker_server, container, position, status_check)",
    "  VALUES ('legacy-service', 'legacy-group', 'Legacy service', 'https://legacy.example.com', 'docker-legacy', 'app', 0, 1);",
  ].join("\n"));
  legacyDatabase.close();

  const database = createDatabase(filename);
  try {
    const columns = database
      .prepare("PRAGMA table_info(dashboard_groups)")
      .all() as Array<{ name: string }>;
    assert.ok(columns.some((column) => column.name === "icon"));
    assert.ok(columns.some((column) => column.name === "column_span"));
    assert.ok(columns.some((column) => column.name === "column_start"));
    assert.ok(columns.some((column) => column.name === "gap_before"));
    assert.ok(columns.some((column) => column.name === "direction"));
    const serviceColumns = database
      .prepare("PRAGMA table_info(dashboard_services)")
      .all() as Array<{ name: string }>;
    assert.ok(serviceColumns.some((column) => column.name === "status_source"));

    const legacyGroup = readDashboard(database).groups.find((group) => group.id === "legacy-group");
    assert.ok(legacyGroup);
    assert.equal(legacyGroup.name, "Legacy group");
    assert.equal(legacyGroup.position, 7);
    assert.equal(legacyGroup.visible, true);
    assert.equal(legacyGroup.icon, "");
    assert.equal(legacyGroup.columnSpan, 1);
    assert.equal(legacyGroup.columnStart, 0);
    assert.equal(legacyGroup.gapBefore, 0);
    assert.equal(legacyGroup.direction, "horizontal");
    assert.equal(legacyGroup.services[0]?.statusSource, "docker");
    assert.deepEqual(readDashboard(database).layout?.map((item) => item.id), ["group:legacy-group"]);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("old revision snapshots without group icons, layout fields or appearance tokens can still be restored", () => {
  const database = createDatabase(":memory:");
  try {
    const snapshot = JSON.parse(JSON.stringify(readDashboard(database))) as {
      settings: { appearance?: unknown; accent: string; glassOpacity: number; blur: number };
      groups: Array<{ icon?: string; columnSpan?: number; columnStart?: number; gapBefore?: number; direction?: string }>;
    };
    delete snapshot.settings.appearance;
    snapshot.settings.accent = "#53d39b";
    snapshot.settings.glassOpacity = 0.41;
    snapshot.settings.blur = 16;
    for (const group of snapshot.groups) {
      delete group.icon;
      delete group.columnSpan;
      delete group.columnStart;
      delete group.gapBefore;
      delete group.direction;
    }

    const inserted = database
      .prepare("INSERT INTO revisions (created_at, label, snapshot) VALUES (?, ?, ?)")
      .run(new Date().toISOString(), "Legacy snapshot", JSON.stringify(snapshot));
    const restored = restoreRevision(database, Number(inserted.lastInsertRowid));

    assert.ok(restored);
    assert.ok(restored.groups.every((group) => group.icon === ""));
    assert.ok(restored.groups.every((group) => group.columnSpan === 1));
    assert.ok(restored.groups.every((group) => group.columnStart === 0));
    assert.ok(restored.groups.every((group) => group.gapBefore === 0));
    assert.ok(restored.groups.every((group) => group.direction === "horizontal"));
    assert.equal(restored.settings.appearance.preset, "custom");
    assert.equal(restored.settings.appearance.colors.accent, "#53d39b");
    assert.equal(restored.settings.appearance.surfaces.glassOpacity, 0.41);
    assert.equal(restored.settings.appearance.surfaces.blur, 16);
  } finally {
    database.close();
  }
});

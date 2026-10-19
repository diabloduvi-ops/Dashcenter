import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  DashboardData,
  DashboardGridItem,
  DashboardGroup,
  DashboardService,
  DashboardServicePlugin,
  DashboardSettings,
  DashboardWidget,
  DockerConnection,
  RevisionSummary,
  ServiceStatus,
} from "../shared/types.js";
import { reconcileDashboardGrid } from "../shared/dashboard-grid.js";
import {
  createSeedDashboard,
  DEFAULT_CONNECTIONS,
  DEFAULT_GROUPS,
  DEFAULT_SETTINGS,
  DEFAULT_WIDGETS,
} from "./seed.js";
import { migrateLegacyWidgets } from "../shared/widgets.js";
import { settingsSchema } from "./validation.js";

export type AppDatabase = DatabaseSync;

const SCHEMA = `
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dashboard_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dashboard_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    column_span INTEGER NOT NULL DEFAULT 1 CHECK (column_span BETWEEN 1 AND 6),
    column_start INTEGER NOT NULL DEFAULT 0 CHECK (column_start BETWEEN 0 AND 6),
    gap_before INTEGER NOT NULL DEFAULT 0 CHECK (gap_before BETWEEN 0 AND 160),
    direction TEXT NOT NULL DEFAULT 'horizontal' CHECK (direction IN ('horizontal', 'vertical')),
    position INTEGER NOT NULL,
    visible INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS dashboard_services (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES dashboard_groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    href TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT '',
    docker_server TEXT NOT NULL DEFAULT '',
    container TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL,
    visible INTEGER NOT NULL DEFAULT 1,
    status_check INTEGER NOT NULL DEFAULT 0,
    status_source TEXT NOT NULL DEFAULT 'http',
    status TEXT NOT NULL DEFAULT 'unknown',
    status_message TEXT,
    plugin_config TEXT,
    legacy_config TEXT
  );

  CREATE INDEX IF NOT EXISTS dashboard_services_group_position
    ON dashboard_services(group_id, position);

  CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL,
    config TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS dashboard_grid_items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('group', 'widget')),
    reference_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    column_span INTEGER NOT NULL DEFAULT 1 CHECK (column_span BETWEEN 1 AND 6),
    column_start INTEGER NOT NULL DEFAULT 0 CHECK (column_start BETWEEN 0 AND 6),
    row_span INTEGER NOT NULL DEFAULT 0 CHECK (row_span BETWEEN 0 AND 3),
    UNIQUE (kind, reference_id)
  );

  CREATE TABLE IF NOT EXISTS widget_credentials (
    widget_id TEXT PRIMARY KEY,
    username TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS service_credentials (
    service_id TEXT PRIMARY KEY,
    plugin_type TEXT NOT NULL DEFAULT '',
    username TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS docker_connections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    label TEXT NOT NULL,
    snapshot TEXT NOT NULL
  );
`;

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function validatedSettings(value: unknown): DashboardSettings {
  const parsed = settingsSchema.safeParse(value);
  return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS);
}

function validStatus(value: unknown): ServiceStatus {
  return value === "healthy" || value === "unhealthy" || value === "checking" ? value : "unknown";
}

function urlOrigin(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    return new URL(value).origin.toLocaleLowerCase();
  } catch {
    return "";
  }
}

function migrateBeszelWidgetsToServices(database: AppDatabase): void {
  const completed = database.prepare("SELECT value FROM app_meta WHERE key = 'service_plugins_v1'").get();
  if (completed) return;

  const widgets = database
    .prepare("SELECT id, enabled, config FROM dashboard_widgets WHERE type = 'beszel' ORDER BY position, rowid")
    .all() as Array<{ id: string; enabled: number; config: string }>;
  const services = database
    .prepare("SELECT id, name, href, icon, plugin_config FROM dashboard_services ORDER BY position, rowid")
    .all() as Array<{ id: string; name: string; href: string; icon: string; plugin_config: string | null }>;
  const claimed = new Set<string>();

  for (const widget of widgets) {
    const config = parseJson<Record<string, unknown>>(widget.config, {});
    const widgetOrigin = urlOrigin(config.url);
    const target = services
      .filter((service) => !service.plugin_config && !claimed.has(service.id))
      .map((service) => {
        const name = service.name.trim().toLocaleLowerCase();
        const icon = service.icon.trim().toLocaleLowerCase();
        const score = name === "beszel" ? 4
          : widgetOrigin && urlOrigin(service.href) === widgetOrigin ? 3
            : name.includes("beszel") ? 2
              : icon.includes("beszel") ? 1
                : 0;
        return { service, score };
      })
      .sort((left, right) => right.score - left.score)[0];

    if (!target || target.score === 0) continue;
    const plugin: DashboardServicePlugin = {
      type: "beszel",
      enabled: Boolean(widget.enabled),
      presentation: "expanded",
      config,
    };
    database.prepare("UPDATE dashboard_services SET plugin_config = ? WHERE id = ?")
      .run(stringify(plugin), target.service.id);
    const credentials = database.prepare("SELECT username, password, updated_at FROM widget_credentials WHERE widget_id = ?")
      .get(widget.id) as { username: string; password: string; updated_at: string } | undefined;
    if (credentials) {
      database.prepare(`
        INSERT INTO service_credentials (service_id, plugin_type, username, password, updated_at)
        VALUES (?, 'beszel', ?, ?, ?)
        ON CONFLICT(service_id) DO UPDATE SET
          plugin_type = excluded.plugin_type,
          username = excluded.username,
          password = excluded.password,
          updated_at = excluded.updated_at
      `).run(target.service.id, credentials.username, credentials.password, credentials.updated_at);
    }
    database.prepare("DELETE FROM widget_credentials WHERE widget_id = ?").run(widget.id);
    database.prepare("DELETE FROM dashboard_widgets WHERE id = ?").run(widget.id);
    claimed.add(target.service.id);
  }

  database.prepare("INSERT INTO app_meta (key, value) VALUES ('service_plugins_v1', '1')").run();
}

function migrateSchema(database: AppDatabase): void {
  const groupColumns = database
    .prepare("PRAGMA table_info(dashboard_groups)")
    .all() as Array<{ name: string }>;
  if (!groupColumns.some((column) => column.name === "icon")) {
    database.exec("ALTER TABLE dashboard_groups ADD COLUMN icon TEXT NOT NULL DEFAULT ''");
  }
  if (!groupColumns.some((column) => column.name === "column_span")) {
    database.exec(
      "ALTER TABLE dashboard_groups ADD COLUMN column_span INTEGER NOT NULL DEFAULT 1 CHECK (column_span BETWEEN 1 AND 6)",
    );
  }
  if (!groupColumns.some((column) => column.name === "column_start")) {
    database.exec(
      "ALTER TABLE dashboard_groups ADD COLUMN column_start INTEGER NOT NULL DEFAULT 0 CHECK (column_start BETWEEN 0 AND 6)",
    );
  }
  if (!groupColumns.some((column) => column.name === "gap_before")) {
    database.exec(
      "ALTER TABLE dashboard_groups ADD COLUMN gap_before INTEGER NOT NULL DEFAULT 0 CHECK (gap_before BETWEEN 0 AND 160)",
    );
  }
  if (!groupColumns.some((column) => column.name === "direction")) {
    database.exec(
      "ALTER TABLE dashboard_groups ADD COLUMN direction TEXT NOT NULL DEFAULT 'horizontal' CHECK (direction IN ('horizontal', 'vertical'))",
    );
  }

  const serviceColumns = database
    .prepare("PRAGMA table_info(dashboard_services)")
    .all() as Array<{ name: string }>;
  if (!serviceColumns.some((column) => column.name === "status_source")) {
    database.exec("ALTER TABLE dashboard_services ADD COLUMN status_source TEXT NOT NULL DEFAULT 'http'");
    database.exec("UPDATE dashboard_services SET status_source = 'docker' WHERE docker_server <> '' OR container <> ''");
  }
  if (!serviceColumns.some((column) => column.name === "plugin_config")) {
    database.exec("ALTER TABLE dashboard_services ADD COLUMN plugin_config TEXT");
  }

  const credentialColumns = database
    .prepare("PRAGMA table_info(service_credentials)")
    .all() as Array<{ name: string }>;
  if (!credentialColumns.some((column) => column.name === "plugin_type")) {
    database.exec("ALTER TABLE service_credentials ADD COLUMN plugin_type TEXT NOT NULL DEFAULT ''");
  }
  database.prepare(`
    UPDATE service_credentials
    SET plugin_type = 'beszel'
    WHERE plugin_type = ''
      AND service_id IN (
        SELECT id FROM dashboard_services WHERE plugin_config LIKE '%\"type\":\"beszel\"%'
      )
  `).run();

  const widgetModelMigrated = database
    .prepare("SELECT value FROM app_meta WHERE key = 'widget_model_v1'")
    .get();
  if (!widgetModelMigrated) {
    const settingsRow = database
      .prepare("SELECT payload FROM dashboard_settings WHERE id = 1")
      .get() as { payload: string } | undefined;
    const widgetRows = database
      .prepare("SELECT id, type, enabled, position, config FROM dashboard_widgets ORDER BY position, rowid")
      .all() as Array<{
        id: string;
        type: DashboardWidget["type"];
        enabled: number;
        position: number;
        config: string;
      }>;

    if (settingsRow && widgetRows.length > 0) {
      const settings = parseJson<DashboardSettings>(settingsRow.payload, structuredClone(DEFAULT_SETTINGS));
      const migrated = migrateLegacyWidgets(settings, widgetRows.map((row) => ({
        id: row.id,
        type: row.type,
        enabled: Boolean(row.enabled),
        position: row.position,
        config: parseJson<Record<string, unknown>>(row.config, {}),
      })));
      const update = database.prepare(
        "UPDATE dashboard_widgets SET enabled = ?, position = ?, config = ? WHERE id = ?",
      );
      for (const widget of migrated) {
        update.run(widget.enabled ? 1 : 0, widget.position, stringify(widget.config), widget.id);
      }
    }

    database
      .prepare("INSERT INTO app_meta (key, value) VALUES ('widget_model_v1', '1')")
      .run();
  }

  const appearanceModelMigrated = database
    .prepare("SELECT value FROM app_meta WHERE key = 'appearance_model_v1'")
    .get();
  if (!appearanceModelMigrated) {
    const settingsRow = database
      .prepare("SELECT payload FROM dashboard_settings WHERE id = 1")
      .get() as { payload: string } | undefined;
    if (settingsRow) {
      const original = parseJson<unknown>(settingsRow.payload, null);
      const parsed = settingsSchema.safeParse(original);
      if (parsed.success) {
        database.prepare("UPDATE dashboard_settings SET payload = ? WHERE id = 1")
          .run(stringify(parsed.data));
      }
    }
    database.prepare("INSERT INTO app_meta (key, value) VALUES ('appearance_model_v1', '1')").run();
  }

  migrateBeszelWidgetsToServices(database);
}

export function createDatabase(filename: string): AppDatabase {
  if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true, mode: 0o750 });
  const database = new DatabaseSync(filename);
  if (filename !== ":memory:") database.exec("PRAGMA journal_mode = WAL;");
  database.exec(SCHEMA);
  migrateSchema(database);
  seedDatabase(database);
  synchronizeDashboardGridRows(database);
  return database;
}

export function openAppDatabase(dataDirectory = process.env.DATA_DIR || path.resolve(process.cwd(), "data")): AppDatabase {
  mkdirSync(dataDirectory, { recursive: true, mode: 0o750 });
  return createDatabase(path.join(dataDirectory, "app.db"));
}

function insertSettings(database: AppDatabase, settings: DashboardSettings): void {
  database
    .prepare("INSERT INTO dashboard_settings (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload")
    .run(stringify(settings));
}

function insertGroups(database: AppDatabase, groups: DashboardGroup[]): void {
  const insertGroup = database.prepare(
    "INSERT INTO dashboard_groups (id, name, icon, column_span, column_start, gap_before, direction, position, visible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertService = database.prepare(`
    INSERT INTO dashboard_services (
      id, group_id, name, href, description, icon, docker_server, container,
      position, visible, status_check, status_source, status, status_message, plugin_config, legacy_config
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const group of groups) {
    insertGroup.run(
      group.id,
      group.name,
      group.icon ?? "",
      group.columnSpan ?? 1,
      group.columnStart ?? 0,
      group.gapBefore ?? 0,
      group.direction === "vertical" ? "vertical" : "horizontal",
      group.position,
      group.visible ? 1 : 0,
    );
    for (const item of group.services) {
      insertService.run(
        item.id,
        group.id,
        item.name,
        item.href,
        item.description,
        item.icon,
        item.dockerServer,
        item.container,
        item.position,
        item.visible ? 1 : 0,
        item.statusCheck ? 1 : 0,
        item.statusSource ?? (item.dockerServer || item.container ? "docker" : "http"),
        item.status,
        item.statusMessage ?? null,
        item.plugin ? stringify(item.plugin) : null,
        item.legacyConfig ? stringify(item.legacyConfig) : null,
      );
    }
  }
}

function insertWidgets(database: AppDatabase, widgets: DashboardWidget[]): void {
  const statement = database.prepare(
    "INSERT INTO dashboard_widgets (id, type, enabled, position, config) VALUES (?, ?, ?, ?, ?)",
  );
  for (const widget of widgets) {
    statement.run(widget.id, widget.type, widget.enabled ? 1 : 0, widget.position, stringify(widget.config));
  }
}

function insertDashboardGrid(database: AppDatabase, layout: DashboardGridItem[]): void {
  const statement = database.prepare(`
    INSERT INTO dashboard_grid_items (
      id, kind, reference_id, position, column_span, column_start, row_span
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const item of layout) {
    statement.run(
      item.id,
      item.kind,
      item.referenceId,
      item.position,
      item.columnSpan,
      item.columnStart,
      item.rowSpan,
    );
  }
}

function synchronizeDashboardGridRows(database: AppDatabase): void {
  const settingsRow = database.prepare("SELECT payload FROM dashboard_settings WHERE id = 1").get() as { payload: string } | undefined;
  const settings = parseJson<DashboardSettings>(settingsRow?.payload, structuredClone(DEFAULT_SETTINGS));
  const groups = database.prepare(
    "SELECT id, name, icon, column_span, column_start, gap_before, direction, position, visible FROM dashboard_groups ORDER BY position, rowid",
  ).all().map((row) => {
    const group = row as GroupRow;
    return {
      id: group.id,
      name: group.name,
      icon: group.icon,
      columnSpan: group.column_span,
      columnStart: group.column_start,
      gapBefore: group.gap_before,
      direction: group.direction === "vertical" ? "vertical" : "horizontal",
      position: group.position,
      visible: Boolean(group.visible),
      services: [],
    } satisfies DashboardGroup;
  });
  const widgets = database.prepare(
    "SELECT id, type, enabled, position, config FROM dashboard_widgets ORDER BY position, rowid",
  ).all().map((row) => {
    const widget = row as { id: string; type: DashboardWidget["type"]; enabled: number; position: number; config: string };
    return {
      id: widget.id,
      type: widget.type,
      enabled: Boolean(widget.enabled),
      position: widget.position,
      config: parseJson<Record<string, unknown>>(widget.config, {}),
    } satisfies DashboardWidget;
  });
  const saved = database.prepare(`
    SELECT id, kind, reference_id, position, column_span, column_start, row_span
    FROM dashboard_grid_items ORDER BY position, rowid
  `).all().map((row) => {
    const item = row as {
      id: string; kind: DashboardGridItem["kind"]; reference_id: string; position: number;
      column_span: number; column_start: number; row_span: number;
    };
    return {
      id: item.id,
      kind: item.kind,
      referenceId: item.reference_id,
      position: item.position,
      columnSpan: item.column_span,
      columnStart: item.column_start,
      rowSpan: item.row_span,
    } satisfies DashboardGridItem;
  });
  const reconciled = reconcileDashboardGrid(saved, groups, widgets, settings.columns);
  database.prepare("DELETE FROM dashboard_grid_items").run();
  insertDashboardGrid(database, reconciled);
}

function insertConnections(database: AppDatabase, connections: DockerConnection[]): void {
  const statement = database.prepare(
    "INSERT INTO docker_connections (id, name, type, endpoint, enabled) VALUES (?, ?, ?, ?, ?)",
  );
  for (const connection of connections) {
    statement.run(connection.id, connection.name, connection.type, connection.endpoint, connection.enabled ? 1 : 0);
  }
}

function currentRevision(database: AppDatabase): number {
  const row = database.prepare("SELECT value FROM app_meta WHERE key = 'revision'").get() as
    | { value: string }
    | undefined;
  const revision = Number.parseInt(row?.value ?? "1", 10);
  return Number.isFinite(revision) && revision > 0 ? revision : 1;
}

function setRevision(database: AppDatabase, revision: number): void {
  database
    .prepare("INSERT INTO app_meta (key, value) VALUES ('revision', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(revision));
}

function insertRevision(database: AppDatabase, label: string, dashboard: DashboardData): void {
  database
    .prepare("INSERT INTO revisions (created_at, label, snapshot) VALUES (?, ?, ?)")
    .run(new Date().toISOString(), label.slice(0, 160), stringify(dashboard));
  database.exec(`
    DELETE FROM revisions
    WHERE id NOT IN (SELECT id FROM revisions ORDER BY id DESC LIMIT 100)
  `);
}

export function seedDatabase(database: AppDatabase): boolean {
  const seeded = database.prepare("SELECT value FROM app_meta WHERE key = 'seeded'").get();
  if (seeded) return false;

  database.exec("BEGIN IMMEDIATE");
  try {
    const dashboard = createSeedDashboard();
    insertSettings(database, DEFAULT_SETTINGS);
    insertGroups(database, DEFAULT_GROUPS);
    insertWidgets(database, DEFAULT_WIDGETS);
    insertDashboardGrid(database, dashboard.layout ?? []);
    insertConnections(database, DEFAULT_CONNECTIONS);
    database.prepare("INSERT INTO app_meta (key, value) VALUES ('seeded', '1')").run();
    setRevision(database, dashboard.revision);
    insertRevision(database, "Initial dashboard", dashboard);
    database.exec("COMMIT");
    return true;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

type GroupRow = {
  id: string;
  name: string;
  icon: string;
  column_span: number;
  column_start: number;
  gap_before: number;
  direction: string;
  position: number;
  visible: number;
};
type ServiceRow = {
  id: string;
  group_id: string;
  name: string;
  href: string;
  description: string;
  icon: string;
  docker_server: string;
  container: string;
  position: number;
  visible: number;
  status_check: number;
  status_source: string;
  status: string;
  status_message: string | null;
  plugin_config: string | null;
  legacy_config: string | null;
};

export function readDashboard(database: AppDatabase): DashboardData {
  const settingsRow = database.prepare("SELECT payload FROM dashboard_settings WHERE id = 1").get() as
    | { payload: string }
    | undefined;
  const settings = validatedSettings(parseJson<unknown>(settingsRow?.payload, null));
  const groupRows = database
    .prepare("SELECT id, name, icon, column_span, column_start, gap_before, direction, position, visible FROM dashboard_groups ORDER BY position, rowid")
    .all() as GroupRow[];
  const serviceRows = database
    .prepare(`
      SELECT id, group_id, name, href, description, icon, docker_server, container,
             position, visible, status_check, status_source, status, status_message, plugin_config, legacy_config
      FROM dashboard_services ORDER BY group_id, position, rowid
    `)
    .all() as ServiceRow[];

  const servicesByGroup = new Map<string, DashboardService[]>();
  for (const row of serviceRows) {
    const service: DashboardService = {
      id: row.id,
      groupId: row.group_id,
      name: row.name,
      href: row.href,
      description: row.description,
      icon: row.icon,
      dockerServer: row.docker_server,
      container: row.container,
      position: row.position,
      visible: Boolean(row.visible),
      statusCheck: Boolean(row.status_check),
      statusSource: row.status_source === "docker" || row.status_source === "uptime-kuma" ? row.status_source : "http",
      status: validStatus(row.status),
      ...(row.status_message ? { statusMessage: row.status_message } : {}),
      ...(row.plugin_config
        ? { plugin: parseJson<DashboardServicePlugin | undefined>(row.plugin_config, undefined) }
        : {}),
      ...(row.legacy_config
        ? { legacyConfig: parseJson<Record<string, unknown>>(row.legacy_config, {}) }
        : {}),
    };
    const existing = servicesByGroup.get(row.group_id) ?? [];
    existing.push(service);
    servicesByGroup.set(row.group_id, existing);
  }

  const groups: DashboardGroup[] = groupRows.map((row) => ({
    id: row.id,
    name: row.name,
    icon: row.icon,
    columnSpan: row.column_span,
    columnStart: row.column_start,
    gapBefore: row.gap_before,
    direction: row.direction === "vertical" ? "vertical" : "horizontal",
    position: row.position,
    visible: Boolean(row.visible),
    services: servicesByGroup.get(row.id) ?? [],
  }));

  const widgetRows = database
    .prepare("SELECT id, type, enabled, position, config FROM dashboard_widgets ORDER BY position, rowid")
    .all() as Array<{ id: string; type: DashboardWidget["type"]; enabled: number; position: number; config: string }>;
  const widgets: DashboardWidget[] = widgetRows.map((row) => ({
    id: row.id,
    type: row.type,
    enabled: Boolean(row.enabled),
    position: row.position,
    config: parseJson<Record<string, unknown>>(row.config, {}),
  }));

  const layout = database.prepare(`
    SELECT id, kind, reference_id, position, column_span, column_start, row_span
    FROM dashboard_grid_items ORDER BY position, rowid
  `).all().map((row) => {
    const item = row as {
      id: string; kind: DashboardGridItem["kind"]; reference_id: string; position: number;
      column_span: number; column_start: number; row_span: number;
    };
    return {
      id: item.id,
      kind: item.kind,
      referenceId: item.reference_id,
      position: item.position,
      columnSpan: item.column_span,
      columnStart: item.column_start,
      rowSpan: item.row_span,
    } satisfies DashboardGridItem;
  });

  const connectionRows = database
    .prepare("SELECT id, name, type, endpoint, enabled FROM docker_connections ORDER BY rowid")
    .all() as Array<{ id: string; name: string; type: DockerConnection["type"]; endpoint: string; enabled: number }>;
  const connections: DockerConnection[] = connectionRows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    endpoint: row.endpoint,
    enabled: Boolean(row.enabled),
  }));

  return { settings, groups, widgets, layout, connections, revision: currentRevision(database) };
}

function replaceDashboardRows(database: AppDatabase, dashboard: Omit<DashboardData, "revision">): void {
  database.exec(`
    DELETE FROM dashboard_services;
    DELETE FROM dashboard_groups;
    DELETE FROM dashboard_widgets;
    DELETE FROM dashboard_grid_items;
    DELETE FROM docker_connections;
    DELETE FROM dashboard_settings;
  `);
  insertSettings(database, settingsSchema.parse(dashboard.settings));
  insertGroups(database, dashboard.groups);
  insertWidgets(database, dashboard.widgets);
  insertDashboardGrid(
    database,
    reconcileDashboardGrid(dashboard.layout, dashboard.groups, dashboard.widgets, dashboard.settings.columns),
  );
  insertConnections(database, dashboard.connections);
  database.prepare("DELETE FROM widget_credentials WHERE widget_id NOT IN (SELECT id FROM dashboard_widgets)").run();
  database.prepare("DELETE FROM service_credentials WHERE service_id NOT IN (SELECT id FROM dashboard_services WHERE plugin_config IS NOT NULL)").run();
}

function credentialDestinations(dashboard: DashboardData): { services: Map<string, string>; widgets: Map<string, string> } {
  const services = new Map<string, string>();
  for (const service of dashboard.groups.flatMap((group) => group.services)) {
    if (service.plugin) services.set(service.id, `${service.plugin.type}\0${String(service.plugin.config.url ?? "")}`);
  }
  const widgets = new Map<string, string>();
  for (const widget of dashboard.widgets) {
    widgets.set(widget.id, `${widget.type}\0${widget.type === "beszel" ? String(widget.config.url ?? "") : ""}`);
  }
  return { services, widgets };
}

/** Run a dashboard write, bump its revision, and save a restorable snapshot atomically. */
export function mutateDashboard(
  database: AppDatabase,
  label: string,
  mutation: (database: AppDatabase) => void,
): DashboardData {
  database.exec("BEGIN IMMEDIATE");
  try {
    const previousDestinations = credentialDestinations(readDashboard(database));
    mutation(database);
    synchronizeDashboardGridRows(database);
    setRevision(database, currentRevision(database) + 1);
    const dashboard = readDashboard(database);
    const nextDestinations = credentialDestinations(dashboard);
    for (const [id, destination] of previousDestinations.services) {
      if (nextDestinations.services.get(id) !== destination) deleteServiceCredentials(database, id);
    }
    for (const [id, destination] of previousDestinations.widgets) {
      if (nextDestinations.widgets.get(id) !== destination) deleteWidgetCredentials(database, id);
    }
    insertRevision(database, label, dashboard);
    database.exec("COMMIT");
    return dashboard;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function replaceDashboard(database: AppDatabase, dashboard: DashboardData, label = "Dashboard updated"): DashboardData {
  return mutateDashboard(database, label, (transaction) => {
    replaceDashboardRows(transaction, dashboard);
  });
}

export function replaceGroups(database: AppDatabase, groups: DashboardGroup[], label = "Homepage YAML imported"): DashboardData {
  return mutateDashboard(database, label, (transaction) => {
    transaction.exec("DELETE FROM dashboard_services; DELETE FROM dashboard_groups; DELETE FROM dashboard_grid_items;");
    insertGroups(transaction, groups);
    transaction.prepare("DELETE FROM service_credentials WHERE service_id NOT IN (SELECT id FROM dashboard_services WHERE plugin_config IS NOT NULL)").run();
  });
}

export function listRevisions(database: AppDatabase): RevisionSummary[] {
  return database
    .prepare("SELECT id, created_at, label FROM revisions ORDER BY id DESC LIMIT 100")
    .all()
    .map((row) => {
      const value = row as { id: number; created_at: string; label: string };
      return { id: value.id, createdAt: value.created_at, label: value.label };
    });
}

export function restoreRevision(database: AppDatabase, revisionId: number): DashboardData | undefined {
  const row = database.prepare("SELECT label, snapshot FROM revisions WHERE id = ?").get(revisionId) as
    | { label: string; snapshot: string }
    | undefined;
  if (!row) return undefined;
  const snapshot = parseJson<DashboardData | null>(row.snapshot, null);
  if (!snapshot) return undefined;
  return replaceDashboard(database, snapshot, `Restored revision ${revisionId}: ${row.label}`);
}

export function getConnection(database: AppDatabase, id: string): DockerConnection | undefined {
  const row = database
    .prepare("SELECT id, name, type, endpoint, enabled FROM docker_connections WHERE id = ?")
    .get(id) as
    | { id: string; name: string; type: DockerConnection["type"]; endpoint: string; enabled: number }
    | undefined;
  return row
    ? { id: row.id, name: row.name, type: row.type, endpoint: row.endpoint, enabled: Boolean(row.enabled) }
    : undefined;
}

export interface WidgetCredentials {
  username: string;
  password: string;
}

export interface ServiceCredentials extends WidgetCredentials {
  pluginType?: DashboardServicePlugin["type"] | "";
}

export function getServiceCredentials(
  database: AppDatabase,
  serviceId: string,
  pluginType?: DashboardServicePlugin["type"],
): ServiceCredentials | undefined {
  const credentials = database
    .prepare("SELECT plugin_type AS pluginType, username, password FROM service_credentials WHERE service_id = ?")
    .get(serviceId) as ServiceCredentials | undefined;
  if (pluginType && credentials?.pluginType !== pluginType) return undefined;
  return credentials;
}

export function setServiceCredentials(
  database: AppDatabase,
  serviceId: string,
  pluginType: DashboardServicePlugin["type"],
  credentials: ServiceCredentials,
): void {
  database.prepare(`
    INSERT INTO service_credentials (service_id, plugin_type, username, password, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(service_id) DO UPDATE SET
      plugin_type = excluded.plugin_type,
      username = excluded.username,
      password = excluded.password,
      updated_at = excluded.updated_at
  `).run(serviceId, pluginType, credentials.username, credentials.password, new Date().toISOString());
}

export function deleteServiceCredentials(database: AppDatabase, serviceId: string): void {
  database.prepare("DELETE FROM service_credentials WHERE service_id = ?").run(serviceId);
}

export function getWidgetCredentials(database: AppDatabase, widgetId: string): WidgetCredentials | undefined {
  return database
    .prepare("SELECT username, password FROM widget_credentials WHERE widget_id = ?")
    .get(widgetId) as WidgetCredentials | undefined;
}

export function setWidgetCredentials(
  database: AppDatabase,
  widgetId: string,
  credentials: WidgetCredentials,
): void {
  database.prepare(`
    INSERT INTO widget_credentials (widget_id, username, password, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(widget_id) DO UPDATE SET
      username = excluded.username,
      password = excluded.password,
      updated_at = excluded.updated_at
  `).run(widgetId, credentials.username, credentials.password, new Date().toISOString());
}

export function deleteWidgetCredentials(database: AppDatabase, widgetId: string): void {
  database.prepare("DELETE FROM widget_credentials WHERE widget_id = ?").run(widgetId);
}

export function updateServiceStatuses(
  database: AppDatabase,
  updates: Array<{ id: string; status: ServiceStatus; message?: string }>,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const statement = database.prepare(
      "UPDATE dashboard_services SET status = ?, status_message = ? WHERE id = ?",
    );
    for (const update of updates) statement.run(update.status, update.message ?? null, update.id);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

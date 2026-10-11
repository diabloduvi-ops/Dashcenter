import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  APPEARANCE_PRESETS,
  APPEARANCE_PRESET_IDS,
  APPEARANCE_VERSION,
  appearanceCssVariables,
  appearanceMatchesPreset,
  appearancePreset,
  withDashboardAppearance,
} from "../shared/appearance.js";
import type { DashboardData } from "../shared/types.js";
import { createDatabase, readDashboard } from "./database.js";
import { buildApp } from "./index.js";
import { DEFAULT_SETTINGS } from "./seed.js";
import { settingsSchema } from "./validation.js";

function multipartPayload(
  filename: string,
  mimeType: string,
  contents: Buffer,
  boundary = "dashcenter-appearance-boundary",
): { boundary: string; payload: Buffer } {
  const prefix = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { boundary, payload: Buffer.concat([prefix, contents, suffix]) };
}

test("versioned appearance presets provide complete semantic tokens", () => {
  for (const id of APPEARANCE_PRESET_IDS) {
    const appearance = appearancePreset(id);
    assert.equal(appearance.version, APPEARANCE_VERSION);
    assert.equal(appearance.preset, id);
    assert.equal(appearanceMatchesPreset(appearance, id), true);
    assert.match(appearance.colors.accent, /^#[0-9a-f]{6}$/i);
    assert.notEqual(appearance.colors.text, appearance.colors.canvas);
    assert.equal(APPEARANCE_PRESETS[id].appearance.preset, id);
    const variables = appearanceCssVariables(appearance);
    assert.equal(variables["--dc-color-accent"], appearance.colors.accent);
    assert.equal(variables["--accent"], appearance.colors.accent);
    assert.equal(variables["--background"], appearance.colors.canvas);
    assert.equal(variables["--text"], appearance.colors.text);
    assert.equal(variables["--glass-alpha"], appearance.surfaces.glassOpacity);
    assert.match(String(variables["--surface"]), /color-mix/);
    assert.match(String(variables["--dc-background-overlay"]), /color-mix/);
  }
});

test("legacy visual settings migrate to a synchronized custom appearance", () => {
  const { appearance: _appearance, ...legacy } = structuredClone(DEFAULT_SETTINGS);
  const migrated = settingsSchema.parse({
    ...legacy,
    accent: "#53d39b",
    glassOpacity: 0.42,
    blur: 19,
    density: "compact",
  });

  assert.equal(migrated.appearance.version, APPEARANCE_VERSION);
  assert.equal(migrated.appearance.preset, "custom");
  assert.equal(migrated.appearance.colors.accent, "#53d39b");
  assert.equal(migrated.appearance.surfaces.glassOpacity, 0.42);
  assert.equal(migrated.appearance.surfaces.blur, 19);
  assert.equal(migrated.appearance.surfaces.density, "compact");
  assert.equal(migrated.accent, migrated.appearance.colors.accent);
  assert.equal(migrated.glassOpacity, migrated.appearance.surfaces.glassOpacity);
  assert.equal(migrated.blur, migrated.appearance.surfaces.blur);
  assert.equal(migrated.density, migrated.appearance.surfaces.density);

  const invalidNord = appearancePreset("nord");
  invalidNord.colors.accent = "#ffffff";
  assert.throws(() => settingsSchema.parse(withDashboardAppearance(DEFAULT_SETTINGS, invalidNord)));
});

test("an existing database persists the appearance v1 migration once", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dashcenter-appearance-migration-"));
  const filename = path.join(directory, "app.db");
  let database = createDatabase(filename);
  try {
    const { appearance: _appearance, ...legacy } = readDashboard(database).settings;
    database.prepare("UPDATE dashboard_settings SET payload = ? WHERE id = 1").run(JSON.stringify({
      ...legacy,
      accent: "#6ac99a",
      glassOpacity: 0.44,
      blur: 21,
    }));
    database.prepare("DELETE FROM app_meta WHERE key = 'appearance_model_v1'").run();
    database.close();

    database = createDatabase(filename);
    const migrated = readDashboard(database).settings;
    assert.equal(migrated.appearance.version, APPEARANCE_VERSION);
    assert.equal(migrated.appearance.preset, "custom");
    assert.equal(migrated.appearance.colors.accent, "#6ac99a");
    assert.equal(migrated.appearance.surfaces.glassOpacity, 0.44);
    assert.equal(migrated.appearance.surfaces.blur, 21);
    const stored = database.prepare("SELECT payload FROM dashboard_settings WHERE id = 1").get() as { payload: string };
    assert.equal(JSON.parse(stored.payload).appearance.version, APPEARANCE_VERSION);
    assert.equal(
      (database.prepare("SELECT value FROM app_meta WHERE key = 'appearance_model_v1'").get() as { value: string }).value,
      "1",
    );
  } finally {
    try { database.close(); } catch { /* The first connection was closed before the migration reopen. */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("background upload stays a draft until appearance settings are explicitly saved", async () => {
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-appearance-upload-"));
  const database = createDatabase(":memory:");
  process.env.DEV_BYPASS_AUTH = "1";
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false });

  try {
    const originalBackground = readDashboard(database).settings.backgroundUrl;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const upload = multipartPayload("background.png", "image/png", png);
    const response = await app.inject({
      method: "POST",
      url: "/api/appearance/background",
      headers: { "content-type": `multipart/form-data; boundary=${upload.boundary}` },
      payload: upload.payload,
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.json<{ url: string }>().url, /^\/uploads\/.+\.png$/);
    assert.equal(readDashboard(database).settings.backgroundUrl, originalBackground);
  } finally {
    await app.close();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

test("new presets and legacy settings round-trip through JSON backup restore", async () => {
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-appearance-"));
  const database = createDatabase(":memory:");
  process.env.DEV_BYPASS_AUTH = "1";
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false });

  try {
    const dashboard = readDashboard(database);
    const warmSettings = withDashboardAppearance(dashboard.settings, appearancePreset("warm"));
    const restored = await app.inject({
      method: "POST",
      url: "/api/backups",
      payload: { version: 1, dashboard: { ...dashboard, settings: warmSettings } },
    });
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.json<DashboardData>().settings.appearance.preset, "warm");

    const exported = await app.inject({ method: "GET", url: "/api/backups" });
    assert.equal(exported.statusCode, 200);
    const exportedDashboard = exported.json<{ dashboard: DashboardData }>().dashboard;
    assert.equal(exportedDashboard.settings.appearance.version, APPEARANCE_VERSION);
    assert.equal(exportedDashboard.settings.appearance.preset, "warm");
    assert.deepEqual(exportedDashboard.settings.appearance, appearancePreset("warm"));

    const { appearance: _legacyAppearance, ...legacySettings } = exportedDashboard.settings;
    const legacyRestore = await app.inject({
      method: "POST",
      url: "/api/backups",
      payload: {
        version: 1,
        dashboard: {
          ...exportedDashboard,
          settings: { ...legacySettings, accent: "#53d39b", glassOpacity: 0.39, blur: 17 },
        },
      },
    });
    assert.equal(legacyRestore.statusCode, 200);
    const legacyResult = legacyRestore.json<DashboardData>();
    assert.equal(legacyResult.settings.appearance.preset, "custom");
    assert.equal(legacyResult.settings.appearance.colors.accent, "#53d39b");
    assert.equal(legacyResult.settings.appearance.surfaces.glassOpacity, 0.39);
    assert.equal(legacyResult.settings.appearance.surfaces.blur, 17);
  } finally {
    await app.close();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

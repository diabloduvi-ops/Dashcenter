import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DashboardData, ImportPreview } from "../shared/types.js";
import { createDatabase } from "./database.js";
import { buildApp } from "./index.js";

const SERVICES = `
- Docker:
    - Portainer:
        href: https://portainer.example.com
`;
const SETTINGS = `
layout:
  - Docker:
      icon: mdi-docker
`;

test("Homepage import API accepts settings.yaml and exports category icons separately", async () => {
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-homepage-import-"));
  const database = createDatabase(":memory:");
  process.env.DEV_BYPASS_AUTH = "1";
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false });

  try {
    const previewResponse = await app.inject({
      method: "POST",
      url: "/api/import/preview",
      payload: { yaml: SERVICES, settingsYaml: SETTINGS },
    });
    assert.equal(previewResponse.statusCode, 200);
    const preview = previewResponse.json<ImportPreview>();
    assert.equal(preview.stats.groupIcons, 1);
    assert.equal(preview.groups[0].icon, "mdi-docker");
    assert.equal(preview.groups[0].columnSpan, 1);

    const commitResponse = await app.inject({
      method: "POST",
      url: "/api/import/commit",
      payload: { yaml: SERVICES, settingsYaml: SETTINGS },
    });
    assert.equal(commitResponse.statusCode, 200);
    const committed = commitResponse.json<DashboardData>();
    assert.equal(committed.groups[0].icon, "mdi-docker");
    assert.equal(committed.groups[0].columnSpan, 1);

    const settingsResponse = await app.inject({
      method: "GET",
      url: "/api/export/homepage/settings.yaml",
    });
    assert.equal(settingsResponse.statusCode, 200);
    assert.equal(settingsResponse.headers["content-disposition"], 'attachment; filename="settings.yaml"');
    assert.match(settingsResponse.body, /icon: mdi-docker/);

    const servicesResponse = await app.inject({
      method: "GET",
      url: "/api/export/homepage",
    });
    assert.equal(servicesResponse.statusCode, 200);
    assert.doesNotMatch(servicesResponse.body, /mdi-docker/);

    const oversizedSource = "x".repeat(5 * 1024 * 1024 + 1);
    const oversizedResponse = await app.inject({
      method: "POST",
      url: "/api/import/preview",
      payload: { yaml: oversizedSource, settingsYaml: oversizedSource },
    });
    assert.equal(oversizedResponse.statusCode, 400);
    assert.match(oversizedResponse.body, /10 MB in total/);
  } finally {
    await app.close();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

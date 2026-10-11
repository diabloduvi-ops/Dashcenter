import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DashboardData } from "../shared/types.js";
import { createDatabase } from "./database.js";
import { buildApp } from "./index.js";

test("group icons, layout, and direction can be created, updated, validated, and restored from old payloads", async () => {
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-groups-"));
  const database = createDatabase(":memory:");

  process.env.DEV_BYPASS_AUTH = "1";
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false });

  try {
    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/groups",
      payload: {
        name: "Infrastructure",
        icon: "mdi-server",
        columnSpan: 3,
        columnStart: 2,
        gapBefore: 48,
        direction: "vertical",
      },
    });
    assert.equal(createdResponse.statusCode, 200);

    const createdDashboard = createdResponse.json<DashboardData>();
    const created = createdDashboard.groups.find((group) => group.name === "Infrastructure");
    assert.ok(created);
    assert.equal(created.icon, "mdi-server");
    assert.equal(created.columnSpan, 3);
    assert.equal(created.columnStart, 2);
    assert.equal(created.gapBefore, 48);
    assert.equal(created.direction, "vertical");

    const renamedResponse = await app.inject({
      method: "PATCH",
      url: "/api/groups/" + created.id,
      payload: { name: "Core infrastructure" },
    });
    assert.equal(renamedResponse.statusCode, 200);
    const renamed = renamedResponse
      .json<DashboardData>()
      .groups.find((group) => group.id === created.id);
    assert.equal(renamed?.icon, "mdi-server");
    assert.equal(renamed?.columnSpan, 3);
    assert.equal(renamed?.columnStart, 2);
    assert.equal(renamed?.gapBefore, 48);
    assert.equal(renamed?.direction, "vertical");

    const directionResponse = await app.inject({
      method: "PATCH",
      url: "/api/groups/" + created.id,
      payload: { direction: "horizontal" },
    });
    assert.equal(directionResponse.statusCode, 200);
    assert.equal(directionResponse.json<DashboardData>().groups.find((group) => group.id === created.id)?.direction, "horizontal");

    const resizedResponse = await app.inject({
      method: "PATCH",
      url: "/api/groups/" + created.id,
      payload: { columnSpan: 6 },
    });
    assert.equal(resizedResponse.statusCode, 200);
    assert.equal(
      resizedResponse.json<DashboardData>().groups.find((group) => group.id === created.id)?.columnSpan,
      6,
    );

    const movedResponse = await app.inject({
      method: "PATCH",
      url: "/api/groups/" + created.id,
      payload: { columnStart: 4, gapBefore: 96 },
    });
    assert.equal(movedResponse.statusCode, 200);
    const moved = movedResponse.json<DashboardData>().groups.find((group) => group.id === created.id);
    assert.equal(moved?.columnStart, 4);
    assert.equal(moved?.gapBefore, 96);

    const defaultResponse = await app.inject({
      method: "POST",
      url: "/api/groups",
      payload: { name: "Default width" },
    });
    assert.equal(defaultResponse.statusCode, 200);
    assert.equal(
      defaultResponse.json<DashboardData>().groups.find((group) => group.name === "Default width")?.columnSpan,
      1,
    );
    assert.equal(
      defaultResponse.json<DashboardData>().groups.find((group) => group.name === "Default width")?.columnStart,
      0,
    );
    assert.equal(
      defaultResponse.json<DashboardData>().groups.find((group) => group.name === "Default width")?.gapBefore,
      0,
    );
    assert.equal(
      defaultResponse.json<DashboardData>().groups.find((group) => group.name === "Default width")?.direction,
      "horizontal",
    );

    assert.equal((await app.inject({
      method: "PATCH",
      url: "/api/groups/" + created.id,
      payload: { direction: "diagonal" },
    })).statusCode, 400);

    for (const invalidColumnSpan of [0, 7, 1.5, "2"]) {
      assert.equal(
        (await app.inject({
          method: "PATCH",
          url: "/api/groups/" + created.id,
          payload: { columnSpan: invalidColumnSpan },
        })).statusCode,
        400,
      );
    }

    for (const [field, values] of [
      ["columnStart", [-1, 7, 1.5, "2"]],
      ["gapBefore", [-1, 161, 1.5, "24"]],
    ] as const) {
      for (const value of values) {
        assert.equal(
          (await app.inject({
            method: "PATCH",
            url: "/api/groups/" + created.id,
            payload: { [field]: value },
          })).statusCode,
          400,
        );
      }
    }

    const clearedResponse = await app.inject({
      method: "PATCH",
      url: "/api/groups/" + created.id,
      payload: { icon: "" },
    });
    assert.equal(clearedResponse.statusCode, 200);
    const cleared = clearedResponse
      .json<DashboardData>()
      .groups.find((group) => group.id === created.id);
    assert.equal(cleared?.icon, "");

    const tooLongResponse = await app.inject({
      method: "PATCH",
      url: "/api/groups/" + created.id,
      payload: { icon: "x".repeat(513) },
    });
    assert.equal(tooLongResponse.statusCode, 400);

    const current = (
      await app.inject({ method: "GET", url: "/api/dashboard" })
    ).json<DashboardData>();
    const legacyPayload = JSON.parse(JSON.stringify(current)) as {
      groups: Array<{
        icon?: string;
        columnSpan?: number;
        columnStart?: number;
        gapBefore?: number;
        direction?: string;
        services: Array<{ statusSource?: string; dockerServer: string; container: string }>;
      }>;
    };
    for (const group of legacyPayload.groups) {
      delete group.icon;
      delete group.columnSpan;
      delete group.columnStart;
      delete group.gapBefore;
      delete group.direction;
      for (const service of group.services) delete service.statusSource;
    }

    const legacyResponse = await app.inject({
      method: "PUT",
      url: "/api/dashboard",
      payload: legacyPayload,
    });
    assert.equal(legacyResponse.statusCode, 200);
    const legacyDashboard = legacyResponse.json<DashboardData>();
    assert.ok(legacyDashboard.groups.every((group) => group.icon === ""));
    assert.ok(legacyDashboard.groups.every((group) => group.columnSpan === 1));
    assert.ok(legacyDashboard.groups.every((group) => group.columnStart === 0));
    assert.ok(legacyDashboard.groups.every((group) => group.gapBefore === 0));
    assert.ok(legacyDashboard.groups.every((group) => group.direction === "horizontal"));
    assert.ok(legacyDashboard.groups.every((group) => group.services.every((service) => (
      service.statusSource === (service.dockerServer || service.container ? "docker" : "http")
    ))));
  } finally {
    await app.close();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { summarizeServiceAvailability } from "../shared/service-availability.js";
import type { DashboardGroup, DashboardService, ServiceStatus } from "../shared/types.js";

function service(id: string, status: ServiceStatus, overrides: Partial<DashboardService> = {}): DashboardService {
  return {
    id,
    groupId: "group-1",
    name: id,
    href: `https://${id}.example.test`,
    description: "",
    icon: "",
    dockerServer: "",
    container: "",
    position: 0,
    visible: true,
    statusCheck: true,
    status,
    ...overrides,
  };
}

function group(id: string, position: number, services: DashboardService[], visible = true): DashboardGroup {
  return {
    id,
    name: id,
    icon: "",
    columnSpan: 1,
    columnStart: 0,
    gapBefore: 0,
    position,
    visible,
    services,
  };
}

test("service availability summarizes visible monitored services and orders problems by severity", () => {
  const summary = summarizeServiceAvailability([
    group("later", 2, [
      service("unknown-service", "unknown", { position: 2 }),
      service("healthy-service", "healthy", { position: 0 }),
      service("unchecked-service", "unhealthy", { statusCheck: false, position: 1 }),
    ]),
    group("first", 0, [
      service("checking-service", "checking", { position: 1 }),
      service("down-service", "unhealthy", { position: 0, statusMessage: "Connection timed out" }),
      service("hidden-service", "unhealthy", { visible: false, position: 2 }),
    ]),
    group("hidden-group", 1, [service("hidden-group-service", "unhealthy")], false),
  ]);

  assert.deepEqual({
    total: summary.total,
    healthy: summary.healthy,
    unhealthy: summary.unhealthy,
    checking: summary.checking,
    unknown: summary.unknown,
  }, {
    total: 4,
    healthy: 1,
    unhealthy: 1,
    checking: 1,
    unknown: 1,
  });
  assert.deepEqual(summary.issues.map(({ service: item }) => item.id), [
    "down-service",
    "checking-service",
    "unknown-service",
  ]);
});

test("service availability has a clear empty and all-online result", () => {
  assert.deepEqual(summarizeServiceAvailability([]), {
    total: 0,
    healthy: 0,
    unhealthy: 0,
    checking: 0,
    unknown: 0,
    issues: [],
  });

  const summary = summarizeServiceAvailability([group("online", 0, [service("ready", "healthy")])]);
  assert.equal(summary.total, 1);
  assert.equal(summary.healthy, 1);
  assert.deepEqual(summary.issues, []);
});

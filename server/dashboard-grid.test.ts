import assert from "node:assert/strict";
import test from "node:test";
import {
  dashboardGridItemId,
  dashboardGridRowPixels,
  reconcileDashboardGrid,
} from "../shared/dashboard-grid.js";
import type { DashboardGroup, DashboardWidget } from "../shared/types.js";

const groups = [
  { id: "media", name: "Media", icon: "", columnSpan: 2, columnStart: 0, gapBefore: 0, position: 0, visible: true, services: [] },
  { id: "infra", name: "Infra", icon: "", columnSpan: 1, columnStart: 0, gapBefore: 0, position: 1, visible: true, services: [] },
] satisfies DashboardGroup[];

const widgets = [
  { id: "search", type: "search", enabled: true, position: 0, config: {} },
  { id: "health", type: "server-health", enabled: true, position: 1, config: {} },
  { id: "docker", type: "docker", enabled: true, position: 2, config: {} },
] satisfies DashboardWidget[];

test("unified grid includes groups and dashboard widgets but excludes top-bar widgets", () => {
  const layout = reconcileDashboardGrid(undefined, groups, widgets, 3);
  assert.deepEqual(layout.map((item) => item.id), [
    "group:media",
    "group:infra",
    "widget:health",
    "widget:docker",
  ]);
  assert.equal(layout.some((item) => item.referenceId === "search"), false);
  assert.deepEqual(layout.find((item) => item.referenceId === "health"), {
    id: "widget:health",
    kind: "widget",
    referenceId: "health",
    position: 2,
    columnSpan: 2,
    columnStart: 0,
    rowSpan: 2,
  });
});

test("saved board order and sizes survive reconciliation while stale and duplicate items are removed", () => {
  const layout = reconcileDashboardGrid([
    { id: "old", kind: "widget", referenceId: "health", position: 0, columnSpan: 9, columnStart: 9, rowSpan: 9 },
    { id: "duplicate", kind: "widget", referenceId: "health", position: 1, columnSpan: 1, columnStart: 0, rowSpan: 1 },
    { id: "gone", kind: "group", referenceId: "gone", position: 2, columnSpan: 1, columnStart: 0, rowSpan: 0 },
    { id: "media", kind: "group", referenceId: "media", position: 3, columnSpan: 2, columnStart: 2, rowSpan: 1 },
  ], groups, widgets, 3);

  assert.deepEqual(layout.map((item) => item.id), [
    dashboardGridItemId("widget", "health"),
    dashboardGridItemId("group", "media"),
    dashboardGridItemId("group", "infra"),
    dashboardGridItemId("widget", "docker"),
  ]);
  assert.deepEqual(layout.map((item) => item.position), [0, 1, 2, 3]);
  assert.deepEqual(layout[0], {
    id: "widget:health",
    kind: "widget",
    referenceId: "health",
    position: 0,
    columnSpan: 3,
    columnStart: 1,
    rowSpan: 3,
  });
});

test("fixed grid heights use one, two or three stable rows while automatic height follows content", () => {
  assert.equal(dashboardGridRowPixels(0, 243.4), 243);
  assert.equal(dashboardGridRowPixels(1, 999), 176);
  assert.equal(dashboardGridRowPixels(2, 999), 352);
  assert.equal(dashboardGridRowPixels(8, 999), 528);
});

test("new calendar cards start at a useful two-column and two-row size", () => {
  const layout = reconcileDashboardGrid(undefined, [], [
    { id: "agenda", type: "calendar-agenda", enabled: true, position: 0, config: {} },
  ], 3);
  assert.deepEqual(layout[0], {
    id: "widget:agenda",
    kind: "widget",
    referenceId: "agenda",
    position: 0,
    columnSpan: 2,
    columnStart: 0,
    rowSpan: 2,
  });
});

test("new feed cards start at a useful two-column and two-row size", () => {
  const layout = reconcileDashboardGrid(undefined, [], [
    { id: "news", type: "feed-reader", enabled: true, position: 0, config: {} },
  ], 3);
  assert.deepEqual(layout[0], {
    id: "widget:news",
    kind: "widget",
    referenceId: "news",
    position: 0,
    columnSpan: 2,
    columnStart: 0,
    rowSpan: 2,
  });
});

test("new service health cards start at a useful two-column and two-row size", () => {
  const layout = reconcileDashboardGrid(undefined, [], [
    { id: "services", type: "service-health", enabled: true, position: 0, config: {} },
  ], 3);
  assert.deepEqual(layout[0], {
    id: "widget:services",
    kind: "widget",
    referenceId: "services",
    position: 0,
    columnSpan: 2,
    columnStart: 0,
    rowSpan: 2,
  });
});

test("new media activity cards start at a useful two-column and two-row size", () => {
  const layout = reconcileDashboardGrid(undefined, [], [
    { id: "playing", type: "media-activity", enabled: true, position: 0, config: {} },
  ], 3);
  assert.deepEqual(layout[0], {
    id: "widget:playing",
    kind: "widget",
    referenceId: "playing",
    position: 0,
    columnSpan: 2,
    columnStart: 0,
    rowSpan: 2,
  });
});

test("new network traffic cards start at a useful two-column and two-row size", () => {
  const layout = reconcileDashboardGrid(undefined, [], [
    { id: "network", type: "network-traffic", enabled: true, position: 0, config: {} },
  ], 3);
  assert.deepEqual(layout[0], {
    id: "widget:network",
    kind: "widget",
    referenceId: "network",
    position: 0,
    columnSpan: 2,
    columnStart: 0,
    rowSpan: 2,
  });
});

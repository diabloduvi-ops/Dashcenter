import assert from "node:assert/strict";
import test from "node:test";
import {
  clampGroupLayout,
  clampGroupColumnSpans,
  dashboardGroupRowSpan,
  DEFAULT_DASHBOARD_COLUMN_COUNT,
  normalizeDashboardColumnCount,
  normalizeGroupColumnSpan,
  normalizeGroupColumnStart,
  normalizeGroupGapBefore,
  orderDashboardGroups,
} from "../shared/layout.js";

test("groups are ordered deterministically without mutating the stored collection", () => {
  const groups = [
    { id: "later-b", position: 2 },
    { id: "first", position: 0 },
    { id: "later-a", position: 2 },
  ];

  assert.deepEqual(orderDashboardGroups(groups).map((group) => group.id), ["first", "later-a", "later-b"]);
  assert.deepEqual(groups.map((group) => group.id), ["later-b", "first", "later-a"]);
});

test("group column spans are clamped to the supported responsive grid", () => {
  assert.equal(normalizeGroupColumnSpan(undefined, 3), 1);
  assert.equal(normalizeGroupColumnSpan(0, 3), 1);
  assert.equal(normalizeGroupColumnSpan(3, 6), 3);
  assert.equal(normalizeGroupColumnSpan(7, 6), 6);
  assert.equal(normalizeGroupColumnSpan(6, 2), 2);
  assert.equal(normalizeGroupColumnSpan(2, 1), 1);
});

test("dashboard columns and group widths stay inside one coherent grid", () => {
  assert.equal(normalizeDashboardColumnCount(undefined), DEFAULT_DASHBOARD_COLUMN_COUNT);
  assert.equal(normalizeDashboardColumnCount(0), 1);
  assert.equal(normalizeDashboardColumnCount(7), 6);
  assert.deepEqual(
    clampGroupColumnSpans(
      [
        { id: "wide", columnSpan: 6 },
        { id: "narrow", columnSpan: 1 },
      ],
      3,
    ),
    [
      { id: "wide", columnSpan: 3 },
      { id: "narrow", columnSpan: 1 },
    ],
  );
});

test("group placement and intentional spacing are normalized coherently", () => {
  assert.equal(normalizeGroupColumnStart(undefined, 4, 2), 0);
  assert.equal(normalizeGroupColumnStart(0, 4, 2), 0);
  assert.equal(normalizeGroupColumnStart(4, 4, 2), 3);
  assert.equal(normalizeGroupColumnStart(2, 4, 2), 2);
  assert.equal(normalizeGroupGapBefore(undefined), 0);
  assert.equal(normalizeGroupGapBefore(-8), 0);
  assert.equal(normalizeGroupGapBefore(47.6), 48);
  assert.equal(normalizeGroupGapBefore(400), 160);

  assert.deepEqual(
    clampGroupLayout(
      [
        { id: "pinned", columnSpan: 5, columnStart: 6, gapBefore: 240 },
        { id: "automatic", columnSpan: 1, columnStart: 0, gapBefore: 16 },
      ],
      3,
    ),
    [
      { id: "pinned", columnSpan: 3, columnStart: 1, gapBefore: 160 },
      { id: "automatic", columnSpan: 1, columnStart: 0, gapBefore: 16 },
    ],
  );
});

test("masonry row spans include services, density, and custom space", () => {
  assert.equal(dashboardGroupRowSpan(0, "comfortable"), 66);
  assert.equal(dashboardGroupRowSpan(2, "comfortable"), 200);
  assert.equal(dashboardGroupRowSpan(2, "compact"), 182);
  assert.equal(dashboardGroupRowSpan(2, "compact", 32), 214);
});

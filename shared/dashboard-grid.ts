import type { DashboardGridItem, DashboardGroup, DashboardWidget } from "./types.js";
import { dashboardWidgetPlacement, orderDashboardWidgets } from "./widgets.js";

export const AUTO_GRID_COLUMN_START = 0;
export const AUTO_GRID_ROW_SPAN = 0;
export const MAX_GRID_COLUMN_SPAN = 3;
export const MAX_GRID_ROW_SPAN = 3;
export const GRID_ROW_HEIGHT_PX = 176;

export function dashboardGridItemId(kind: DashboardGridItem["kind"], referenceId: string): string {
  return `${kind}:${referenceId}`;
}

export function orderDashboardGridItems(items: readonly DashboardGridItem[]): DashboardGridItem[] {
  return [...items].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

export function normalizeGridColumnSpan(columnSpan: number | undefined, columns: number): number {
  const available = Math.max(1, Math.min(6, Math.round(columns) || 3));
  const value = Number.isInteger(columnSpan) ? columnSpan as number : 1;
  return Math.min(available, MAX_GRID_COLUMN_SPAN, Math.max(1, value));
}

export function normalizeGridColumnStart(columnStart: number | undefined, columns: number, columnSpan: number): number {
  if (!Number.isInteger(columnStart) || columnStart === AUTO_GRID_COLUMN_START) return AUTO_GRID_COLUMN_START;
  const available = Math.max(1, Math.min(6, Math.round(columns) || 3));
  const width = normalizeGridColumnSpan(columnSpan, available);
  return Math.min(Math.max(1, columnStart as number), available - width + 1);
}

export function normalizeGridRowSpan(rowSpan: number | undefined): number {
  if (!Number.isInteger(rowSpan) || rowSpan === AUTO_GRID_ROW_SPAN) return AUTO_GRID_ROW_SPAN;
  return Math.min(MAX_GRID_ROW_SPAN, Math.max(1, rowSpan as number));
}

export function dashboardGridRowPixels(rowSpan: number, automaticPixels: number): number {
  const normalized = normalizeGridRowSpan(rowSpan);
  return normalized === AUTO_GRID_ROW_SPAN
    ? Math.max(72, Math.round(automaticPixels))
    : normalized * GRID_ROW_HEIGHT_PX;
}

function isDetailedCard(widget: DashboardWidget): boolean {
  return widget.type === "server-health" || widget.type === "service-health" || widget.type === "media-activity" || widget.type === "network-traffic" || widget.type === "calendar-agenda" || widget.type === "feed-reader";
}

function defaultWidgetWidth(widget: DashboardWidget): number {
  return isDetailedCard(widget) ? 2 : 1;
}

function appendMissingItems(
  items: DashboardGridItem[],
  groups: readonly DashboardGroup[],
  widgets: readonly DashboardWidget[],
): DashboardGridItem[] {
  const seen = new Set(items.map((item) => dashboardGridItemId(item.kind, item.referenceId)));
  for (const group of [...groups].sort((left, right) => left.position - right.position)) {
    const id = dashboardGridItemId("group", group.id);
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      kind: "group",
      referenceId: group.id,
      position: items.length,
      columnSpan: group.columnSpan ?? 1,
      columnStart: group.columnStart ?? 0,
      rowSpan: 0,
    });
  }
  for (const widget of orderDashboardWidgets([...widgets])) {
    if (dashboardWidgetPlacement(widget.type) !== "dashboard") continue;
    const id = dashboardGridItemId("widget", widget.id);
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      kind: "widget",
      referenceId: widget.id,
      position: items.length,
      columnSpan: defaultWidgetWidth(widget),
      columnStart: 0,
      rowSpan: isDetailedCard(widget) ? 2 : 0,
    });
  }
  return items;
}

/**
 * Remove stale references, normalize saved dimensions and append newly created
 * groups or dashboard widgets without changing the order of existing items.
 */
export function reconcileDashboardGrid(
  layout: readonly DashboardGridItem[] | undefined,
  groups: readonly DashboardGroup[],
  widgets: readonly DashboardWidget[],
  columns = 3,
): DashboardGridItem[] {
  const groupIds = new Set(groups.map((group) => group.id));
  const dashboardWidgetIds = new Set(
    widgets.filter((widget) => dashboardWidgetPlacement(widget.type) === "dashboard").map((widget) => widget.id),
  );
  const seen = new Set<string>();
  const valid = orderDashboardGridItems(layout ?? []).flatMap((item) => {
    const referenceExists = item.kind === "group"
      ? groupIds.has(item.referenceId)
      : dashboardWidgetIds.has(item.referenceId);
    const stableId = dashboardGridItemId(item.kind, item.referenceId);
    if (!referenceExists || seen.has(stableId)) return [];
    seen.add(stableId);
    const columnSpan = normalizeGridColumnSpan(item.columnSpan, columns);
    return [{
      ...item,
      id: stableId,
      columnSpan,
      columnStart: normalizeGridColumnStart(item.columnStart, columns, columnSpan),
      rowSpan: normalizeGridRowSpan(item.rowSpan),
    }];
  });

  return appendMissingItems(valid, groups, widgets).map((item, position) => ({ ...item, position }));
}

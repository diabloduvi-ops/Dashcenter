export const MIN_GROUP_COLUMN_SPAN = 1;
export const MAX_GROUP_COLUMN_SPAN = 6;
export const AUTO_GROUP_COLUMN_START = 0;
export const MAX_GROUP_GAP_BEFORE = 160;

/** Return groups in stable row-major order without mutating the stored collection. */
export function orderDashboardGroups<T extends { id: string; position: number }>(groups: readonly T[]): T[] {
  return [...groups].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export const DEFAULT_DASHBOARD_COLUMN_COUNT = 3;

export function normalizeDashboardColumnCount(
  columnCount: number | undefined,
  fallback = DEFAULT_DASHBOARD_COLUMN_COUNT,
): number {
  const value = Number.isInteger(columnCount) ? columnCount as number : fallback;
  return Math.min(MAX_GROUP_COLUMN_SPAN, Math.max(MIN_GROUP_COLUMN_SPAN, value));
}

/** Keep a saved group width inside both the supported range and the active responsive grid. */
export function normalizeGroupColumnSpan(columnSpan: number | undefined, availableColumns = MAX_GROUP_COLUMN_SPAN): number {
  const columns = normalizeDashboardColumnCount(availableColumns, MAX_GROUP_COLUMN_SPAN);
  const span = typeof columnSpan === "number" && Number.isInteger(columnSpan)
    ? Math.min(MAX_GROUP_COLUMN_SPAN, Math.max(MIN_GROUP_COLUMN_SPAN, columnSpan))
    : MIN_GROUP_COLUMN_SPAN;
  return Math.min(span, columns);
}

/** Zero means auto-pack; explicit starts are clamped so the group still fits. */
export function normalizeGroupColumnStart(
  columnStart: number | undefined,
  availableColumns = MAX_GROUP_COLUMN_SPAN,
  columnSpan = MIN_GROUP_COLUMN_SPAN,
): number {
  if (!Number.isInteger(columnStart) || columnStart === AUTO_GROUP_COLUMN_START) {
    return AUTO_GROUP_COLUMN_START;
  }
  const columns = normalizeDashboardColumnCount(availableColumns, MAX_GROUP_COLUMN_SPAN);
  const span = normalizeGroupColumnSpan(columnSpan, columns);
  return Math.min(Math.max(MIN_GROUP_COLUMN_SPAN, columnStart as number), columns - span + 1);
}

export function normalizeGroupGapBefore(gapBefore: number | undefined): number {
  if (!Number.isFinite(gapBefore)) return 0;
  return Math.min(MAX_GROUP_GAP_BEFORE, Math.max(0, Math.round(gapBefore as number)));
}

/** Clamp every saved group width when the desktop grid column count is reduced. */
export function clampGroupColumnSpans<T extends { columnSpan: number }>(
  groups: readonly T[],
  availableColumns: number,
): T[] {
  const columns = normalizeDashboardColumnCount(availableColumns);
  return groups.map((group) => ({
    ...group,
    columnSpan: normalizeGroupColumnSpan(group.columnSpan, columns),
  }));
}

/** Keep width, start column and intentional spacing coherent when the grid changes. */
export function clampGroupLayout<
  T extends { columnSpan: number; columnStart: number; gapBefore: number },
>(groups: readonly T[], availableColumns: number): T[] {
  const columns = normalizeDashboardColumnCount(availableColumns);
  return groups.map((group) => {
    const columnSpan = normalizeGroupColumnSpan(group.columnSpan, columns);
    return {
      ...group,
      columnSpan,
      columnStart: normalizeGroupColumnStart(group.columnStart, columns, columnSpan),
      gapBefore: normalizeGroupGapBefore(group.gapBefore),
    };
  });
}

/** Fixed service rows let CSS Grid pack groups vertically without row-sized holes. */
export function dashboardGroupRowSpan(
  serviceCount: number,
  density: "compact" | "comfortable",
  gapBefore = 0,
  pluginHeight = 0,
): number {
  const rows = Math.max(0, Math.floor(serviceCount));
  const serviceRowHeight = density === "compact" ? 58 : 67;
  const headingAndRail = 35;
  const spaceAfter = 31;
  return headingAndRail + rows * serviceRowHeight + Math.max(0, Math.round(pluginHeight)) + normalizeGroupGapBefore(gapBefore) + spaceAfter;
}

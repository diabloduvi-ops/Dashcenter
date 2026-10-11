import type { DashboardSettings, DashboardWidget } from "./types.js";

export type DashboardWidgetType = DashboardWidget["type"];
export type DashboardWidgetPlacement = "topbar" | "dashboard";

const TOPBAR_WIDGET_TYPES = new Set<DashboardWidgetType>([
  "search",
  "clock",
  "weather",
  "system-resources",
  "service-availability",
]);

export const SINGLETON_WIDGET_TYPES = new Set<DashboardWidgetType>([
  "search",
  "clock",
  "weather",
  "system-resources",
  "service-availability",
  "server-health",
  "service-health",
  "docker",
]);

export function dashboardWidgetPlacement(type: DashboardWidgetType): DashboardWidgetPlacement {
  return TOPBAR_WIDGET_TYPES.has(type) ? "topbar" : "dashboard";
}

export function orderDashboardWidgets(widgets: DashboardWidget[]): DashboardWidget[] {
  return [...widgets].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

export function findDashboardWidget(
  widgets: DashboardWidget[],
  type: DashboardWidgetType,
): DashboardWidget | undefined {
  return orderDashboardWidgets(widgets).find((widget) => widget.type === type);
}

export function defaultWidgetConfig(
  type: DashboardWidgetType,
  settings: DashboardSettings,
): Record<string, unknown> {
  switch (type) {
    case "search":
      return { provider: "internal" };
    case "clock":
      return { format: "24h" };
    case "weather":
      return {
        label: settings.weatherLabel || "Weather",
        latitude: settings.weatherLatitude,
        longitude: settings.weatherLongitude,
      };
    case "system-resources":
      return { refreshSeconds: 5 };
    case "service-availability":
      return {};
    case "server-health":
      return { refreshSeconds: 5 };
    case "service-health":
      return {};
    case "media-activity":
      return { label: "Now playing", serviceIds: [], maxSessions: 4, showArtwork: true };
    case "network-traffic":
      return { label: "Network", serviceId: "" };
    case "docker":
      return { display: "summary" };
    case "custom-api":
      return { label: "New API widget", url: "", path: "" };
    case "calendar-agenda":
      return { label: "Agenda", daysAhead: 14, maxEvents: 8 };
    case "feed-reader":
      return { label: "Latest news", mode: "articles", maxItems: 6, maxAgeDays: 30, showImages: true };
    case "beszel":
      return { label: "Beszel", url: "", version: 2, systemId: "" };
  }
}

export function normalizeWidgetPositions(widgets: DashboardWidget[]): DashboardWidget[] {
  return orderDashboardWidgets(widgets).map((widget, position) => ({ ...widget, position }));
}

export function moveDashboardWidget(
  widgets: DashboardWidget[],
  id: string,
  direction: -1 | 1,
): DashboardWidget[] {
  const ordered = orderDashboardWidgets(widgets);
  const index = ordered.findIndex((widget) => widget.id === id);
  if (index < 0) return normalizeWidgetPositions(ordered);
  const placement = dashboardWidgetPlacement(ordered[index].type);
  const peers = ordered.filter((widget) => dashboardWidgetPlacement(widget.type) === placement);
  const peerIndex = peers.findIndex((widget) => widget.id === id);
  const targetPeer = peers[peerIndex + direction];
  if (!targetPeer) return normalizeWidgetPositions(ordered);
  const target = ordered.findIndex((widget) => widget.id === targetPeer.id);
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  return ordered.map((widget, position) => ({ ...widget, position }));
}

/**
 * Keeps the legacy settings payload readable by older backups while widgets
 * remain the single source of truth in the current dashboard and editor.
 */
export function synchronizeLegacyWidgetSettings(
  settings: DashboardSettings,
  widgets: DashboardWidget[],
): DashboardSettings {
  const search = findDashboardWidget(widgets, "search");
  const clock = findDashboardWidget(widgets, "clock");
  const weather = findDashboardWidget(widgets, "weather");
  const next = {
    ...settings,
    showSearch: Boolean(search?.enabled),
    showClock: Boolean(clock?.enabled),
    showWeather: Boolean(weather?.enabled),
  };

  if (!weather) return next;
  const label = weather.config.label;
  const latitude = Number(weather.config.latitude);
  const longitude = Number(weather.config.longitude);
  if (typeof label === "string") next.weatherLabel = label;
  if (Number.isFinite(latitude)) next.weatherLatitude = latitude;
  if (Number.isFinite(longitude)) next.weatherLongitude = longitude;
  return next;
}

/** One-time upgrade for dashboards created before widgets owned their settings. */
export function migrateLegacyWidgets(
  settings: DashboardSettings,
  widgets: DashboardWidget[],
): DashboardWidget[] {
  return normalizeWidgetPositions(widgets.map((widget) => {
    const config = { ...defaultWidgetConfig(widget.type, settings), ...widget.config };
    if (widget.type === "search") return { ...widget, enabled: settings.showSearch, config };
    if (widget.type === "clock") return { ...widget, enabled: settings.showClock, config };
    if (widget.type === "weather") return { ...widget, enabled: settings.showWeather, config };
    return { ...widget, config };
  }));
}

import type { DashboardData, DashboardWidget } from "../shared/types.js";
import { findDashboardWidget } from "../shared/widgets.js";
import { DEFAULT_SETTINGS } from "./seed.js";

// Only fields needed to render the published board belong in an anonymous response.
// Widget and plugin configuration can contain private URLs or future credentials.
const PUBLIC_WIDGET_KEYS: Partial<Record<DashboardWidget["type"], readonly string[]>> = {
  search: ["provider", "label"],
  clock: ["format", "label"],
  weather: ["label", "latitude", "longitude"],
  "system-resources": ["refreshSeconds", "label"],
  "service-availability": ["label"],
  "server-health": ["refreshSeconds", "dockerConnectionId", "label"],
  "service-health": ["serviceIds", "label"],
  "media-activity": ["serviceIds", "maxSessions", "showArtwork", "label"],
  "network-traffic": ["serviceId", "label"],
  docker: ["display", "label"],
  "custom-api": ["label"],
  "calendar-agenda": ["label", "daysAhead", "maxEvents"],
  "feed-reader": ["label", "mode", "maxItems", "maxAgeDays", "showImages"],
  beszel: ["label"],
};

function publicWidgetConfig(widget: DashboardWidget, visibleServiceIds: Set<string>): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const key of PUBLIC_WIDGET_KEYS[widget.type] ?? []) {
    const value = widget.config[key];
    if (key === "serviceIds") {
      if (Array.isArray(value)) {
        config[key] = value.filter((item): item is string => typeof item === "string" && visibleServiceIds.has(item));
      }
      continue;
    }
    if (key === "serviceId") {
      if (typeof value === "string" && visibleServiceIds.has(value)) config[key] = value;
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      config[key] = value;
    }
  }

  // The client needs a truthy URL to render these cards, but it never uses the
  // actual endpoint: their requests go through the server-side widget route.
  if ((widget.type === "custom-api" || widget.type === "beszel") && widget.config.url) {
    config.url = "configured";
  }
  return config;
}

export function publishedWeatherLocation(dashboard: DashboardData) {
  const weather = findDashboardWidget(dashboard.widgets.filter((widget) => widget.enabled), "weather");
  if (!weather) return undefined;
  const fallback = findDashboardWidget(dashboard.widgets, "weather") === weather ? dashboard.settings : DEFAULT_SETTINGS;
  const { label, latitude, longitude } = weather.config;
  return {
    weatherLabel: typeof label === "string" ? label : fallback.weatherLabel,
    weatherLatitude: typeof latitude === "number" ? latitude : fallback.weatherLatitude,
    weatherLongitude: typeof longitude === "number" ? longitude : fallback.weatherLongitude,
  };
}

export function publishedDashboard(dashboard: DashboardData): DashboardData {
  const groups = dashboard.groups
    .filter((group) => group.visible && (group.visibility ?? "everyone") === "everyone")
    .map((group) => ({
      ...group,
      services: group.services
        .filter((service) => service.visible)
        .map(({ legacyConfig: _legacyConfig, statusMessage: _statusMessage, ...service }) => ({
          ...service,
          // The public Docker status card only needs a truthy source marker.
          dockerServer: service.dockerServer ? "configured" : "",
          container: "",
          ...(service.plugin ? { plugin: { ...service.plugin, config: {} } } : {}),
        })),
    }))
    .filter((group) => group.services.length > 0);
  const visibleServiceIds = new Set(groups.flatMap((group) => group.services.map((service) => service.id)));
  const widgets = dashboard.widgets
    .filter((widget) => widget.enabled)
    .map((widget) => ({ ...widget, config: publicWidgetConfig(widget, visibleServiceIds) }));
  const weather = publishedWeatherLocation(dashboard);
  const visibleIds = new Set([
    ...groups.map((group) => `group:${group.id}`),
    ...widgets.map((widget) => `widget:${widget.id}`),
  ]);

  return {
    ...dashboard,
    settings: {
      ...dashboard.settings,
      ...(weather ?? {
        weatherLabel: DEFAULT_SETTINGS.weatherLabel,
        weatherLatitude: DEFAULT_SETTINGS.weatherLatitude,
        weatherLongitude: DEFAULT_SETTINGS.weatherLongitude,
      }),
    },
    groups,
    widgets,
    layout: (dashboard.layout ?? []).filter((item) => visibleIds.has(`${item.kind}:${item.referenceId}`)),
    connections: [],
  };
}

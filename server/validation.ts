import { z } from "zod";
import type { DashboardData } from "../shared/types.js";
import {
  APPEARANCE_VERSION,
  appearanceFromLegacy,
  appearanceMatchesPreset,
  customizeDashboardAppearance,
  withDashboardAppearance,
} from "../shared/appearance.js";
import { isHttpUrl } from "./homepage-yaml.js";

const id = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/, "Invalid ID");
const label = z.string().trim().min(1).max(120);
const shortText = z.string().trim().max(500);
const iconReference = z.string().trim().max(512);
const url = z.string().trim().max(2048).refine(isHttpUrl, "Must be a valid http:// or https:// URL");
const status = z.enum(["healthy", "unhealthy", "checking", "unknown"]);
const statusSource = z.enum(["http", "docker", "uptime-kuma"]);

export const servicePluginSchema = z.object({
  type: z.enum(["beszel", "portainer", "proxmox", "uptime-kuma", "jellyfin", "plex", "mikrotik", "radarr", "sonarr", "lidarr", "prowlarr", "bazarr", "qbittorrent", "nginx-proxy-manager", "steam-wishlist"]),
  enabled: z.boolean().default(true),
  presentation: z.enum(["summary", "expanded"]).default("expanded"),
  config: z.record(z.string().max(200), z.unknown()).default({}),
});

export const serviceSchema = z.object({
  id,
  groupId: id,
  name: label,
  href: url,
  description: shortText.default(""),
  icon: iconReference.default(""),
  dockerServer: z.string().trim().max(120).default(""),
  container: z.string().trim().max(200).default(""),
  position: z.number().int().min(0).max(100_000).default(0),
  visible: z.boolean().default(true),
  statusCheck: z.boolean().default(false),
  statusSource: statusSource.optional(),
  status: status.default("unknown"),
  statusMessage: z.string().max(500).optional(),
  plugin: servicePluginSchema.optional(),
  legacyConfig: z.record(z.string().max(200), z.unknown()).optional(),
}).transform((service) => ({
  ...service,
  statusSource: service.statusSource ?? (service.dockerServer || service.container ? "docker" as const : "http" as const),
})).superRefine((service, context) => {
  if (service.statusSource !== "uptime-kuma") return;
  const monitorId = service.plugin?.config.monitorId;
  if (service.plugin?.type !== "uptime-kuma" || typeof monitorId !== "string" || !monitorId.trim()) {
    context.addIssue({
      code: "custom",
      path: ["statusSource"],
      message: "Uptime Kuma status requires an Uptime Kuma plugin with one selected monitor",
    });
  }
});

export const groupSchema = z.object({
  id,
  name: label,
  icon: iconReference.default(""),
  columnSpan: z.number().int().min(1).max(6).default(1),
  columnStart: z.number().int().min(0).max(6).default(0),
  gapBefore: z.number().int().min(0).max(160).default(0),
  direction: z.enum(["horizontal", "vertical"]).default("horizontal"),
  position: z.number().int().min(0).max(100_000).default(0),
  visible: z.boolean().default(true),
  services: z.array(serviceSchema).max(10_000).default([]),
});

const backgroundUrl = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) => value === "" || value.startsWith("/uploads/") || value.startsWith("/assets/") || isHttpUrl(value),
    "Background must be an uploaded path or an http(s) URL",
  );

const hexColor = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Color must be a six-digit hex value");

export const dashboardAppearanceSchema = z.object({
  version: z.literal(APPEARANCE_VERSION),
  preset: z.enum(["forest", "graphite", "nord", "warm", "custom"]),
  colors: z.object({
    canvas: hexColor,
    surface: hexColor,
    surfaceRaised: hexColor,
    text: hexColor,
    textMuted: hexColor,
    textFaint: hexColor,
    border: hexColor,
    accent: hexColor,
    accentContrast: hexColor,
    success: hexColor,
    warning: hexColor,
    danger: hexColor,
    info: hexColor,
    focus: hexColor,
    overlay: hexColor,
  }),
  surfaces: z.object({
    glassOpacity: z.number().min(0.15).max(0.95),
    blur: z.number().min(0).max(80),
    overlayOpacity: z.number().min(0).max(0.9),
    borderStrength: z.enum(["subtle", "balanced", "strong"]),
    radius: z.enum(["compact", "balanced", "rounded"]),
    shadow: z.enum(["flat", "soft", "lifted"]),
    density: z.enum(["compact", "comfortable"]),
  }),
  typography: z.object({
    family: z.literal("system"),
    scale: z.enum(["compact", "default", "large"]),
    weight: z.enum(["regular", "balanced", "strong"]),
    numbers: z.enum(["tabular", "proportional"]),
  }),
  icons: z.object({
    treatment: z.enum(["original", "monochrome"]),
    size: z.enum(["small", "medium", "large"]),
    frameShape: z.enum(["square", "rounded", "circle"]),
    frameStyle: z.enum(["none", "subtle", "filled"]),
  }),
  motion: z.object({
    level: z.enum(["full", "reduced", "minimal"]),
  }),
}).superRefine((appearance, context) => {
  if (appearance.preset === "custom" || appearanceMatchesPreset(appearance, appearance.preset)) return;
  context.addIssue({
    code: "custom",
    path: ["preset"],
    message: "Named appearance presets must use their versioned token values",
  });
});

const settingsInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  language: z.string().trim().min(2).max(20),
  backgroundUrl,
  accent: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Accent must be a six-digit hex color"),
  glassOpacity: z.number().min(0).max(1),
  blur: z.number().min(0).max(80),
  columns: z.number().int().min(1).max(6),
  density: z.enum(["compact", "comfortable"]),
  openInNewTab: z.boolean(),
  showSearch: z.boolean(),
  showClock: z.boolean(),
  showWeather: z.boolean(),
  weatherLabel: z.string().trim().max(120),
  weatherLatitude: z.number().min(-90).max(90),
  weatherLongitude: z.number().min(-180).max(180),
  appearance: dashboardAppearanceSchema.optional(),
});

export const settingsSchema = settingsInputSchema.transform((settings) => {
  if (!settings.appearance) return withDashboardAppearance(settings, appearanceFromLegacy(settings));
  const aliasesMatch = settings.accent === settings.appearance.colors.accent
    && settings.glassOpacity === settings.appearance.surfaces.glassOpacity
    && settings.blur === settings.appearance.surfaces.blur
    && settings.density === settings.appearance.surfaces.density;
  if (aliasesMatch) return withDashboardAppearance(settings, settings.appearance);
  return customizeDashboardAppearance(withDashboardAppearance(settings, settings.appearance), (appearance) => {
    appearance.colors.accent = settings.accent;
    appearance.surfaces.glassOpacity = settings.glassOpacity;
    appearance.surfaces.blur = settings.blur;
    appearance.surfaces.density = settings.density;
  });
});

export const widgetSchema = z.object({
  id,
  type: z.enum(["search", "clock", "weather", "system-resources", "service-availability", "server-health", "service-health", "media-activity", "network-traffic", "docker", "custom-api", "calendar-agenda", "feed-reader", "beszel"]),
  enabled: z.boolean().default(true),
  position: z.number().int().min(0).max(100_000).default(0),
  config: z.record(z.string().max(200), z.unknown()).default({}),
});

export const dashboardGridItemSchema = z.object({
  id,
  kind: z.enum(["group", "widget"]),
  referenceId: id,
  position: z.number().int().min(0).max(100_000),
  columnSpan: z.number().int().min(1).max(6),
  columnStart: z.number().int().min(0).max(6),
  rowSpan: z.number().int().min(0).max(3),
});

export const connectionSchema = z
  .object({
    id,
    name: label,
    type: z.enum(["socket", "http"]),
    endpoint: z.string().trim().min(1).max(2048),
    enabled: z.boolean().default(true),
  })
  .superRefine((connection, context) => {
    if (connection.type === "http" && !isHttpUrl(connection.endpoint)) {
      context.addIssue({ code: "custom", path: ["endpoint"], message: "HTTP Docker endpoints must use http:// or https://" });
    }
    const socketPath = connection.endpoint.startsWith("unix://")
      ? connection.endpoint.slice("unix://".length)
      : connection.endpoint;
    if (connection.type === "socket" && (!socketPath.startsWith("/") || socketPath.includes("\0"))) {
      context.addIssue({ code: "custom", path: ["endpoint"], message: "Socket endpoint must be an absolute path" });
    }
  });

export const dashboardSchema = z.object({
  settings: settingsSchema,
  groups: z.array(groupSchema).max(1_000),
  widgets: z.array(widgetSchema).max(1_000),
  layout: z.array(dashboardGridItemSchema).max(2_000).optional().default([]),
  connections: z.array(connectionSchema).max(1_000),
  revision: z.number().int().nonnegative().default(0),
});

export const authSetupSchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[\p{L}\p{N}._-]+$/u, "Use letters, numbers, dots, dashes, or underscores"),
  displayName: z.string().trim().max(100).optional().default(""),
  password: z.string().min(8).max(512),
});

export const authLoginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(512),
});

export function assertUniqueDashboardIds(dashboard: DashboardData): void {
  const groupIds = new Set<string>();
  const serviceIds = new Set<string>();
  const widgetIds = new Set<string>();
  const layoutIds = new Set<string>();
  const connectionIds = new Set<string>();
  for (const group of dashboard.groups) {
    if (groupIds.has(group.id)) throw new Error(`Duplicate group ID: ${group.id}`);
    groupIds.add(group.id);
    for (const service of group.services) {
      if (serviceIds.has(service.id)) throw new Error(`Duplicate service ID: ${service.id}`);
      serviceIds.add(service.id);
    }
  }
  for (const widget of dashboard.widgets) {
    if (widgetIds.has(widget.id)) throw new Error(`Duplicate widget ID: ${widget.id}`);
    widgetIds.add(widget.id);
  }
  for (const item of dashboard.layout ?? []) {
    if (layoutIds.has(item.id)) throw new Error(`Duplicate layout item ID: ${item.id}`);
    layoutIds.add(item.id);
  }
  for (const connection of dashboard.connections) {
    if (connectionIds.has(connection.id)) throw new Error(`Duplicate Docker connection ID: ${connection.id}`);
    connectionIds.add(connection.id);
  }
}

export const routeIdSchema = z.object({ id });
export const revisionIdSchema = z.object({ id: z.coerce.number().int().positive() });

export const reorderSchema = z.object({
  groups: z.array(id).max(1_000).optional(),
  services: z.record(id, z.array(id).max(10_000)).optional(),
  widgets: z.array(id).max(1_000).optional(),
});

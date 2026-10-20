import type { DashboardAppearance } from "./appearance.js";

export type ServiceStatus = "healthy" | "unhealthy" | "checking" | "unknown";
export type ServiceStatusSource = "http" | "docker" | "uptime-kuma";
export type ServiceGroupDirection = "horizontal" | "vertical";
export type GroupVisibility = "everyone" | "signed-in" | "hidden";

export type ServicePluginType = "beszel" | "portainer" | "proxmox" | "uptime-kuma" | "jellyfin" | "plex" | "mikrotik" | "radarr" | "sonarr" | "lidarr" | "prowlarr" | "bazarr" | "qbittorrent" | "nginx-proxy-manager" | "steam-wishlist";
export type ServicePluginPresentation = "summary" | "expanded";

export interface DashboardServicePlugin {
  type: ServicePluginType;
  enabled: boolean;
  presentation: ServicePluginPresentation;
  config: Record<string, unknown>;
}

export interface DashboardService {
  id: string;
  groupId: string;
  name: string;
  href: string;
  description: string;
  icon: string;
  dockerServer: string;
  container: string;
  position: number;
  visible: boolean;
  statusCheck: boolean;
  /** Missing on legacy backups; inferred from the saved Docker mapping when loaded. */
  statusSource?: ServiceStatusSource;
  status: ServiceStatus;
  statusMessage?: string;
  plugin?: DashboardServicePlugin;
  legacyConfig?: Record<string, unknown>;
}

export interface DashboardGroup {
  id: string;
  name: string;
  icon: string;
  columnSpan: number;
  columnStart: number;
  gapBefore: number;
  /** Missing on legacy payloads; horizontal tiles are the migration-safe default. */
  direction?: ServiceGroupDirection;
  position: number;
  visible: boolean;
  /** Missing on old backups; derived from visible when validated. */
  visibility?: GroupVisibility;
  services: DashboardService[];
}

export interface DashboardSettings {
  title: string;
  language: string;
  backgroundUrl: string;
  accent: string;
  glassOpacity: number;
  blur: number;
  /** Versioned semantic appearance model. Legacy visual fields above remain synchronized for old backups and clients. */
  appearance: DashboardAppearance;
  columns: number;
  density: "compact" | "comfortable";
  openInNewTab: boolean;
  requireSignIn: boolean;
  showSearch: boolean;
  showClock: boolean;
  showWeather: boolean;
  weatherLabel: string;
  weatherLatitude: number;
  weatherLongitude: number;
}

export interface DashboardWidget {
  id: string;
  type: "search" | "clock" | "weather" | "system-resources" | "service-availability" | "server-health" | "service-health" | "media-activity" | "network-traffic" | "docker" | "custom-api" | "calendar-agenda" | "feed-reader" | "beszel";
  enabled: boolean;
  position: number;
  config: Record<string, unknown>;
}

export interface DashboardGridItem {
  id: string;
  kind: "group" | "widget";
  referenceId: string;
  position: number;
  columnSpan: number;
  columnStart: number;
  /** Zero keeps the content-driven height; 1–3 select a fixed dashboard row height. */
  rowSpan: number;
}

export interface DockerConnection {
  id: string;
  name: string;
  type: "socket" | "http";
  endpoint: string;
  enabled: boolean;
}

export interface DashboardData {
  settings: DashboardSettings;
  groups: DashboardGroup[];
  widgets: DashboardWidget[];
  /** Missing only on backups created before the unified dashboard grid. */
  layout?: DashboardGridItem[];
  connections: DockerConnection[];
  revision: number;
}

export interface AuthState {
  needsSetup: boolean;
  authenticated: boolean;
  requireSignIn?: boolean;
  username?: string;
  displayName?: string;
  devBypass?: boolean;
}

export interface ImportPreview {
  groups: DashboardGroup[];
  warnings: string[];
  stats: { groups: number; services: number; preservedFields: number; groupIcons: number };
  source: string;
  settingsSource?: string;
}

export interface RevisionSummary {
  id: number;
  createdAt: string;
  label: string;
}

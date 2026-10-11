import type {
  DashboardGroup,
  DashboardSettings,
  DashboardWidget,
  DockerConnection,
} from "../shared/types.js";
import { reconcileDashboardGrid } from "../shared/dashboard-grid.js";
import { appearancePreset, withDashboardAppearance } from "../shared/appearance.js";

export const DEFAULT_SETTINGS: DashboardSettings = withDashboardAppearance({
  title: "Dashcenter",
  language: "en",
  backgroundUrl: "/assets/dashcenter-forest.png",
  accent: "#4ee28a",
  glassOpacity: 0.34,
  blur: 14,
  columns: 3,
  density: "comfortable",
  openInNewTab: true,
  showSearch: true,
  showClock: true,
  showWeather: true,
  weatherLabel: "London",
  weatherLatitude: 51.5072,
  weatherLongitude: -0.1276,
}, appearancePreset("forest"));

type SeedService = Omit<DashboardGroup["services"][number], "groupId" | "position">;

function service(
  id: string,
  name: string,
  href: string,
  description: string,
  icon: string,
  dockerServer = "",
  container = "",
): SeedService {
  return {
    id,
    name,
    href,
    description,
    icon,
    dockerServer,
    container,
    visible: true,
    statusCheck: Boolean(dockerServer && container),
    statusSource: dockerServer || container ? "docker" : "http",
    status: "unknown",
  };
}

function group(
  id: string,
  name: string,
  position: number,
  seedServices: SeedService[],
): DashboardGroup {
  return {
    id,
    name,
    icon: "",
    columnSpan: 1,
    columnStart: 0,
    gapBefore: 0,
    direction: "horizontal",
    position,
    visible: true,
    services: seedServices.map((item, servicePosition) => ({
      ...item,
      groupId: id,
      position: servicePosition,
    })),
  };
}

/**
 * A useful first-run dashboard based on the services in the supplied Homepage
 * screenshots. Everything remains editable from the web UI after setup.
 */
export const DEFAULT_GROUPS: DashboardGroup[] = [
  group("docker-services", "Docker Services", 0, [
    service(
      "beszel",
      "Beszel",
      "https://beszel.example.com",
      "Monitoring",
      "beszel.png",
      "docker-local",
      "beszel",
    ),
    service(
      "portainer",
      "Portainer",
      "https://portainer.example.com",
      "Docker management",
      "portainer.png",
      "docker-local",
      "portainer",
    ),
    service(
      "linkwarden",
      "Linkwarden",
      "https://linkwarden.example.com",
      "Link management",
      "linkwarden.png",
      "docker-local",
      "linkwarden",
    ),
    service(
      "prunemate",
      "Prunemate",
      "https://prunemate.example.com",
      "Docker management",
      "prunemate.png",
      "docker-local",
      "prunemate",
    ),
    service(
      "photoprism",
      "Photoprism",
      "https://photoprism.example.com",
      "Photo collection",
      "photoprism.png",
      "docker-local",
      "photoprism",
    ),
    service(
      "swing-music",
      "Swing Music",
      "https://music.example.com",
      "Music collection",
      "swing-music.png",
      "docker-local",
      "swingmusic",
    ),
    service(
      "nginx-proxy-manager",
      "Nginx Proxy Manager",
      "https://proxy.example.com",
      "Proxy manager",
      "nginx-proxy-manager.png",
      "docker-local",
      "npm",
    ),
  ]),
  group("docker-backend", "Docker Backend", 1, [
    service(
      "ferdium-server",
      "Ferdium Server",
      "https://ferdium.example.com",
      "Services workspace",
      "ferdium.png",
      "docker-local",
      "ferdium-server",
    ),
    service(
      "docker-windows",
      "Docker Windows",
      "https://windows.example.com",
      "Win11",
      "sh-microsoft-windows.png",
      "docker-local",
      "windows11",
    ),
  ]),
  group("cloud-services", "Cloud services", 2, [
    service(
      "notion",
      "Notion",
      "https://www.notion.so/",
      "Knowledge base",
      "notion.webp",
    ),
    service(
      "ticktick",
      "Tick Tick",
      "https://ticktick.com/webapp",
      "Task management",
      "sh-ticktick.png",
    ),
    service(
      "chatgpt",
      "ChatGPT",
      "https://chatgpt.com/",
      "AI Chat",
      "sh-chatgpt-light.png",
    ),
    service(
      "perplexity",
      "Perplexity",
      "https://www.perplexity.ai/",
      "AI Chat",
      "sh-perplexity-ai.png",
    ),
    service(
      "proton-pass",
      "Proton Pass",
      "https://pass.proton.me",
      "Password manager",
      "sh-proton-pass.png",
    ),
  ]),
  group("it", "IT", 3, [
    service("hetzner", "Hetzner", "https://console.hetzner.cloud/", "Cloud management", "hetzner.png"),
    service("bitdefender", "Bitdefender", "https://central.bitdefender.com/", "Antivirus", "bitdefender.png"),
    service("websupport", "Websupport", "https://admin.websupport.sk/", "Domain services", "websupport.png"),
    service("tailscale", "Tailscale", "https://login.tailscale.com/admin", "VPN management", "tailscale.png"),
  ]),
  group("social", "Social", 4, [
    service("facebook", "Facebook", "https://www.facebook.com/", "Social", "facebook.png"),
  ]),
  group("entertainment", "Entertainment", 5, [
    service("youtube", "YouTube", "https://www.youtube.com/", "Video", "youtube.png"),
  ]),
];

export const DEFAULT_WIDGETS: DashboardWidget[] = [
  { id: "search", type: "search", enabled: true, position: 0, config: { provider: "internal" } },
  { id: "clock", type: "clock", enabled: true, position: 1, config: { format: "24h" } },
  {
    id: "weather",
    type: "weather",
    enabled: true,
    position: 2,
    config: {
      label: DEFAULT_SETTINGS.weatherLabel,
      latitude: DEFAULT_SETTINGS.weatherLatitude,
      longitude: DEFAULT_SETTINGS.weatherLongitude,
    },
  },
];

export const DEFAULT_CONNECTIONS: DockerConnection[] = [
  {
    id: "docker-local",
    name: "Local Docker",
    type: "socket",
    endpoint: "/var/run/docker.sock",
    enabled: false,
  },
];

export function createSeedDashboard() {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    groups: structuredClone(DEFAULT_GROUPS),
    widgets: structuredClone(DEFAULT_WIDGETS),
    layout: reconcileDashboardGrid(undefined, DEFAULT_GROUPS, DEFAULT_WIDGETS, DEFAULT_SETTINGS.columns),
    connections: structuredClone(DEFAULT_CONNECTIONS),
    revision: 1,
  };
}

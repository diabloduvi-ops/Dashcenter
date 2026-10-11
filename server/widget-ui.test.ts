import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const widgetsSource = readFileSync(new URL("../src/features/admin/WidgetsTab.tsx", import.meta.url), "utf8");
const servicesSource = readFileSync(new URL("../src/features/admin/ServicesTab.tsx", import.meta.url), "utf8");
const dashboardTabSource = readFileSync(new URL("../src/features/admin/DashboardTab.tsx", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../src/components/DashboardView.tsx", import.meta.url), "utf8");
const adminCss = readFileSync(new URL("../src/features/admin/admin.css", import.meta.url), "utf8");
const dashboardCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("widget editor owns add, configure, order, visibility, and delete actions", () => {
  assert.match(widgetsSource, /Add widget/);
  assert.match(widgetsSource, /SINGLETON_WIDGET_TYPES/);
  assert.match(widgetsSource, /moveDashboardWidget/);
  assert.match(widgetsSource, /Save widget/);
  assert.match(widgetsSource, /Delete widget/);
  assert.match(widgetsSource, /synchronizeLegacyWidgetSettings/);
  assert.match(adminCss, /\.admin-widget-catalog\s*\{/);
  assert.match(adminCss, /\.admin-widget-delete-confirmation\s*\{/);
});

test("widget catalog separates top bar modules from dashboard cards", () => {
  assert.match(widgetsSource, /eyebrow: "Top bar"/);
  assert.match(widgetsSource, /eyebrow: "Dashboard"/);
  assert.match(widgetsSource, /dashboardWidgetPlacement/);
  assert.match(widgetsSource, /This server/);
  assert.match(widgetsSource, /Service availability/);
  assert.match(widgetsSource, /Server health/);
  assert.match(widgetsSource, /Service health/);
  assert.match(widgetsSource, /Now playing/);
  assert.match(widgetsSource, /Network traffic/);
  assert.match(widgetsSource, /Calendar agenda/);
  assert.match(widgetsSource, /RSS & releases/);
  assert.match(widgetsSource, /CPU, memory, disk and uptime/);
  assert.match(adminCss, /\.admin-widget-catalog__group\s*\{/);
  assert.match(adminCss, /\.admin-widget-section\s*\{/);
});

test("dashboard header reads widget state without duplicate settings toggles", () => {
  assert.doesNotMatch(dashboardTabSource, /data\.settings\.show(?:Search|Clock|Weather)/);
  assert.doesNotMatch(dashboardSource, /settings\.show(?:Search|Clock|Weather)/);
  assert.match(dashboardSource, /const showSearch = Boolean\(searchWidget\?\.enabled\)/);
  assert.match(dashboardSource, /const showWeather = Boolean\(weatherWidget\?\.enabled\)/);
  assert.match(dashboardSource, /headerWidgets\.map\(\(widget\) =>/);
  assert.match(dashboardSource, /data-widget-type="search"/);
  assert.match(dashboardSource, /data-widget-type="clock"/);
  assert.match(dashboardSource, /data-widget-type="weather"/);
  assert.match(dashboardSource, /data-widget-type="system-resources"/);
  assert.match(dashboardSource, /data-widget-type="service-availability"/);
  assert.match(dashboardSource, /summarizeServiceAvailability/);
  assert.match(dashboardSource, /aria-haspopup="dialog"/);
  assert.match(dashboardSource, /data-widget-type="server-health"/);
  assert.match(dashboardSource, /data-widget-type="service-health"/);
  assert.match(dashboardSource, /data-widget-type="media-activity"/);
  assert.match(dashboardSource, /data-widget-type="network-traffic"/);
  assert.match(dashboardSource, /\/api\/system\/resources/);
  assert.match(dashboardSource, /includeHistory/);
  assert.match(dashboardSource, /includeContainers/);
  assert.match(dashboardSource, /payload\?\.memory\.usedPercent/);
  assert.match(dashboardSource, /payload\.disk\.usedPercent/);
  assert.match(dashboardSource, /aria-label="Dashboard settings"/);
  assert.doesNotMatch(dashboardSource, /aria-label="More dashboard actions"/);
  assert.doesNotMatch(dashboardSource, /Toggle appearance/);
  assert.doesNotMatch(dashboardSource, /theme-light/);
  assert.match(dashboardCss, /\.topbar-modules\s*\{[\s\S]*display:\s*flex/);
  assert.match(dashboardCss, /\.topbar-tools\s*\{[\s\S]*grid-column:\s*3/);
  assert.match(dashboardCss, /\.system-resource-widget\s*\{/);
  assert.match(dashboardCss, /\.system-resource-metric\s*\{/);
  assert.match(dashboardCss, /\.service-availability-widget\s*\{/);
  assert.match(dashboardCss, /\.service-availability-panel__issues\s*\{/);
  assert.match(dashboardCss, /\.server-health-card\s*\{/);
  assert.match(dashboardCss, /\.server-health-card__metrics\s*\{/);
  assert.match(dashboardCss, /\.server-health-card__trend\s*\{/);
  assert.match(dashboardCss, /\.server-health-card__charts\s*\{/);
  assert.match(dashboardCss, /\.service-group__header\s*\{/);
  assert.match(dashboardCss, /\.service-rail\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fit/);
  assert.match(dashboardSource, /serviceStatusText/);
  assert.doesNotMatch(dashboardSource, /dashboardGroupTileHeight/);
  assert.match(dashboardSource, /service-group--\$\{direction\}/);
  assert.match(dashboardCss, /\.service-health-card\s*\{/);
  assert.match(dashboardCss, /\.media-activity-card\s*\{/);
  assert.match(dashboardCss, /\.network-traffic-card\s*\{/);
  assert.match(dashboardSource, /function CalendarAgendaWidget/);
  assert.match(dashboardSource, /const contentWidgets[\s\S]*widget\.type === "calendar-agenda"/);
  assert.match(dashboardSource, /data-widget-type="calendar-agenda"/);
  assert.match(dashboardCss, /\.calendar-agenda-card\s*\{/);
  assert.match(dashboardCss, /\.calendar-agenda-event\s*\{/);
  assert.match(dashboardSource, /function FeedReaderWidget/);
  assert.match(dashboardSource, /const contentWidgets[\s\S]*widget\.type === "feed-reader"/);
  assert.match(dashboardSource, /data-widget-type="feed-reader"/);
  assert.match(dashboardCss, /\.feed-reader-card\s*\{/);
  assert.match(dashboardCss, /\.feed-reader-item--featured\s*\{/);
});

test("media activity selects service plugins without copying credentials into widget settings", () => {
  assert.match(widgetsSource, /Detailed Jellyfin and Plex sessions/);
  assert.match(widgetsSource, /serviceIds/);
  assert.match(widgetsSource, /Maximum sessions/);
  assert.match(widgetsSource, /No media server credentials are copied into the widget/);
  assert.match(dashboardSource, /Promise\.allSettled\(services\.map/);
  assert.match(dashboardSource, /plugin\/artwork/);
  assert.match(dashboardSource, /mediaPlayMethodLabel/);
  assert.doesNotMatch(dashboardSource, /X-Plex-Token|MediaBrowser Token/);
});

test("network traffic references a MikroTik service and keeps RouterOS credentials out of the widget", () => {
  assert.match(widgetsSource, /Live download, upload and bounded history/);
  assert.match(widgetsSource, /MikroTik source/);
  assert.match(widgetsSource, /stores only the selected service ID/);
  assert.match(dashboardSource, /function NetworkTrafficWidget/);
  assert.match(dashboardSource, /downloadBitsPerSecond/);
  assert.match(dashboardSource, /uploadBitsPerSecond/);
  assert.doesNotMatch(dashboardSource, /Basic\s+\$\{/);
});

test("calendar agenda configuration keeps the feed URL server-side", () => {
  assert.match(widgetsSource, /iCalendar feed URL/);
  assert.match(widgetsSource, /Stored securely on the server/);
  assert.match(widgetsSource, /Show events for/);
  assert.match(widgetsSource, /Maximum events/);
  assert.match(widgetsSource, /\/api\/widgets\/calendar-agenda\//);
  assert.doesNotMatch(dashboardSource, /widget\.config\.feedUrl/);
});

test("RSS and release configuration keeps the feed URL server-side", () => {
  assert.match(widgetsSource, /RSS or Atom feed URL/);
  assert.match(widgetsSource, /News and articles/);
  assert.match(widgetsSource, /Software releases/);
  assert.match(widgetsSource, /Maximum age/);
  assert.match(widgetsSource, /Feed images/);
  assert.match(widgetsSource, /\/api\/widgets\/feed-reader\//);
  assert.doesNotMatch(dashboardSource, /widget\.config\.feedUrl/);
});

test("published dashboard renders the existing Docker widget as live service health", () => {
  assert.match(dashboardSource, /function DockerStatusWidget/);
  assert.match(dashboardSource, /service\.statusCheck && Boolean\(service\.dockerServer\)/);
  assert.match(dashboardSource, /widget\.type === "docker"/);
  assert.match(dashboardSource, /No monitored containers/);
  assert.match(dashboardSource, /function formatWidgetValue/);
  assert.match(dashboardSource, /JSON\.stringify\(value\)/);
});

test("Beszel is owned by services with server-only credentials and inline dashboard metrics", () => {
  assert.match(widgetsSource, /filter\(\(type\) => type !== "beszel"\)/);
  assert.match(widgetsSource, /Native provider plugins now belong to Services/);
  assert.match(widgetsSource, /Beszel URL/);
  assert.match(servicesSource, /General/);
  assert.match(servicesSource, /Status/);
  assert.match(servicesSource, /Plugin/);
  assert.match(servicesSource, /Superuser email/);
  assert.match(servicesSource, /Test connection/);
  assert.match(servicesSource, /\/api\/services\/\$\{encodeURIComponent\(serviceForm\.id\)\}\/plugin\/credentials/);
  assert.match(dashboardSource, /function BeszelServicePlugin/);
  assert.match(dashboardSource, /\/api\/services\/\$\{encodeURIComponent\(id\)\}\/plugin/);
  assert.match(dashboardSource, /function BeszelWidget/);
  assert.match(dashboardSource, /\/api\/widgets\/beszel\//);
  assert.match(dashboardCss, /\.service-plugin-panel__metrics\s*\{/);
  assert.match(dashboardCss, /\.beszel-widget__metrics\s*\{/);
  assert.match(adminCss, /\.admin-service-editor-tabs\s*\{/);
});

test("Portainer is configured on a service and renders read-only environment metrics", () => {
  assert.match(servicesSource, /<option value="portainer">Portainer<\/option>/);
  assert.match(servicesSource, /Portainer URL/);
  assert.match(servicesSource, /Access token/);
  assert.match(servicesSource, /All environments overview/);
  assert.match(servicesSource, /Create a read-only token under My account in Portainer/);
  assert.match(dashboardSource, /function PortainerServicePlugin/);
  assert.match(dashboardSource, /containers running/);
  assert.match(dashboardSource, /payload\.containers\.running/);
  assert.match(dashboardSource, /payload\.inspected < payload\.online/);
  assert.match(dashboardSource, /Stopped containers/);
});

test("Jellyfin is configured on a service and renders activity and library metrics", () => {
  assert.match(servicesSource, /<option value="jellyfin">Jellyfin<\/option>/);
  assert.match(servicesSource, /Jellyfin URL/);
  assert.match(servicesSource, /Create an API key in Jellyfin Dashboard/);
  assert.match(dashboardSource, /function JellyfinServicePlugin/);
  assert.match(dashboardSource, /payload\.sessions\.playing/);
  assert.match(dashboardSource, /payload\.library\.movies/);
  assert.match(dashboardSource, /payload\.library\.episodes/);
});

test("Plex is configured on a service and renders playback and library metrics", () => {
  assert.match(servicesSource, /<option value="plex">Plex<\/option>/);
  assert.match(servicesSource, /Plex Media Server URL/);
  assert.match(servicesSource, /X-Plex-Token/);
  assert.match(servicesSource, /Read-only integration/);
  assert.match(dashboardSource, /function PlexServicePlugin/);
  assert.match(dashboardSource, /payload\.sessions\.playing/);
  assert.match(dashboardSource, /payload\.sessions\.transcoding/);
  assert.match(dashboardSource, /payload\.library\.albums/);
});

test("MikroTik is configured on a service and renders read-only RouterOS metrics", () => {
  assert.match(servicesSource, /<option value="mikrotik">MikroTik<\/option>/);
  assert.match(servicesSource, /MikroTik URL/);
  assert.match(servicesSource, /RouterOS username/);
  assert.match(servicesSource, /read and REST API permissions/);
  assert.match(dashboardSource, /function MikrotikServicePlugin/);
  assert.match(dashboardSource, /payload\.system\.cpuLoad/);
  assert.match(dashboardSource, /payload\.system\.memoryUsedPercent/);
  assert.match(dashboardSource, /payload\.interfaces\.running/);
  assert.match(dashboardSource, /payload\.dhcp\.active/);
});

test("Proxmox VE is configured on a service and renders read-only cluster metrics", () => {
  assert.match(servicesSource, /<option value="proxmox">Proxmox VE<\/option>/);
  assert.match(servicesSource, /Proxmox VE URL/);
  assert.match(servicesSource, /API token ID/);
  assert.match(servicesSource, /PVEAuditor/);
  assert.match(servicesSource, /All cluster nodes/);
  assert.match(dashboardSource, /function ProxmoxServicePlugin/);
  assert.match(dashboardSource, /payload\.nodes\.online/);
  assert.match(dashboardSource, /payload\.guests\.running/);
  assert.match(dashboardSource, /payload\.resources\.cpuUsedPercent/);
  assert.match(dashboardSource, /payload\.resources\.storageUsedPercent/);
});

test("Uptime Kuma is configured on a service and renders supported monitor metrics", () => {
  assert.match(servicesSource, /<option value="uptime-kuma">Uptime Kuma<\/option>/);
  assert.match(servicesSource, /Uptime Kuma URL/);
  assert.match(servicesSource, /Prometheus API key/);
  assert.match(servicesSource, /Settings → Security → API Keys/);
  assert.match(servicesSource, /All monitors overview/);
  assert.match(servicesSource, /Status source/);
  assert.match(servicesSource, /Uptime Kuma monitor/);
  assert.match(servicesSource, /reuses its server-side API key/);
  assert.match(dashboardSource, /function UptimeKumaServicePlugin/);
  assert.match(dashboardSource, /payload\.monitors\.up/);
  assert.match(dashboardSource, /payload\.monitor\.responseTime/);
  assert.match(dashboardSource, /payload\.monitor\.certificateDaysRemaining/);
});

test("Radarr and Sonarr are configured on services and render library activity", () => {
  assert.match(servicesSource, /<option value="radarr">Radarr<\/option>/);
  assert.match(servicesSource, /<option value="sonarr">Sonarr<\/option>/);
  assert.match(servicesSource, /Settings → General → Security/);
  assert.match(dashboardSource, /function ArrServicePlugin/);
  assert.match(dashboardSource, /payload\.wanted/);
  assert.match(dashboardSource, /payload\.queue/);
  assert.match(dashboardSource, /payload\.library\.monitored/);
});

test("Lidarr is configured on a service and renders music library activity", () => {
  assert.match(servicesSource, /<option value="lidarr">Lidarr<\/option>/);
  assert.match(servicesSource, /Lidarr URL/);
  assert.match(servicesSource, /http:\/\/lidarr:8686/);
  assert.match(servicesSource, /wanted albums and download queue/);
  assert.match(dashboardSource, /function LidarrServicePlugin/);
  assert.match(dashboardSource, /payload\.library\.artists/);
  assert.match(dashboardSource, /payload\.library\.albums/);
  assert.match(dashboardSource, /payload\.library\.trackFiles/);
});

test("media automation plugins are configured on services with compact and expanded metrics", () => {
  assert.match(servicesSource, /<option value="prowlarr">Prowlarr<\/option>/);
  assert.match(servicesSource, /<option value="bazarr">Bazarr<\/option>/);
  assert.match(servicesSource, /<option value="qbittorrent">qBittorrent<\/option>/);
  assert.match(servicesSource, /qBittorrent Web UI password/);
  assert.match(dashboardSource, /function ProwlarrServicePlugin/);
  assert.match(dashboardSource, /function BazarrServicePlugin/);
  assert.match(dashboardSource, /function QBittorrentServicePlugin/);
  assert.match(dashboardSource, /payload\.downloadSpeed/);
  assert.match(dashboardSource, /payload\.missingEpisodes/);
  assert.match(dashboardSource, /payload\.failedQueries/);
});

test("Nginx Proxy Manager is configured on a service and renders host health metrics", () => {
  assert.match(servicesSource, /<option value="nginx-proxy-manager">Nginx Proxy Manager<\/option>/);
  assert.match(servicesSource, /Nginx Proxy Manager URL/);
  assert.match(servicesSource, /NPM identity \(email\)/);
  assert.match(servicesSource, /Credentials stay on the Dashcenter server and host data requests are read-only/);
  assert.match(dashboardSource, /function NginxProxyManagerServicePlugin/);
  assert.match(dashboardSource, /payload\.proxyHosts\.online/);
  assert.match(dashboardSource, /payload\.proxyHosts\.withSsl/);
  assert.match(dashboardSource, /payload\.redirectionHosts\.enabled/);
  assert.match(dashboardSource, /payload\.streams\.enabled/);
});

test("Steam wishlist deals are configured on a service and render polished deal cards", () => {
  assert.match(servicesSource, /<option value="steam-wishlist">Steam wishlist deals<\/option>/);
  assert.match(servicesSource, /SteamID64 or profile URL/);
  assert.match(servicesSource, /Minimum discount/);
  assert.match(servicesSource, /Public wishlist · no API key required/);
  assert.match(dashboardSource, /function SteamWishlistServicePlugin/);
  assert.match(dashboardSource, /steam-deal-card__art/);
  assert.match(dashboardSource, /payload\.highestDiscount/);
  assert.match(dashboardSource, /deal\.finalPrice/);
  assert.match(dashboardCss, /\.steam-deals-panel\s*\{/);
  assert.match(dashboardCss, /\.steam-deals-rail\s*\{/);
  assert.match(dashboardCss, /\.steam-deal-card\s*\{/);
});

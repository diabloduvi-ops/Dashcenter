import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Blocks,
  CalendarDays,
  Clapperboard,
  CloudSun,
  Clock3,
  Container,
  Gauge,
  Network,
  Plus,
  Rss,
  Search,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Webhook,
  X,
} from "lucide-react";
import { createClientId } from "../../../shared/id";
import type { DashboardData, DashboardWidget } from "../../../shared/types";
import {
  dashboardWidgetPlacement,
  defaultWidgetConfig,
  moveDashboardWidget,
  normalizeWidgetPositions,
  orderDashboardWidgets,
  SINGLETON_WIDGET_TYPES,
  synchronizeLegacyWidgetSettings,
  type DashboardWidgetType,
} from "../../../shared/widgets";
import { api } from "../../lib/api";
import { Button, EmptyState, Field, IconButton, Notice, Panel, SelectField, Switch, ToggleRow } from "./ui";

interface WidgetsTabProps {
  data: DashboardData;
  onCommit: (next: DashboardData, message?: string) => Promise<void>;
}

const widgetMeta: Record<DashboardWidgetType, { title: string; description: string; icon: typeof Search }> = {
  search: { title: "Search", description: "Instantly filter services or search the web.", icon: Search },
  clock: { title: "Clock & date", description: "A compact local date and time display.", icon: Clock3 },
  weather: { title: "Weather", description: "Current weather for a fixed location.", icon: CloudSun },
  "system-resources": { title: "This server", description: "CPU, memory, disk and uptime without another monitoring service.", icon: ServerCog },
  "service-availability": { title: "Service availability", description: "Online, down, checking and unknown service counts with a problem list.", icon: ShieldCheck },
  "server-health": { title: "Server health", description: "A detailed CPU, memory, disk and uptime card for the dashboard board.", icon: Gauge },
  "service-health": { title: "Service health", description: "Status totals and services that need attention, using the existing health checks.", icon: ShieldCheck },
  "media-activity": { title: "Now playing", description: "Detailed Jellyfin and Plex sessions with progress, client and optional artwork.", icon: Clapperboard },
  "network-traffic": { title: "Network traffic", description: "Live download, upload and bounded history from a configured MikroTik interface.", icon: Network },
  docker: { title: "Docker status", description: "A live summary of monitored Docker services.", icon: Container },
  "custom-api": { title: "Custom API", description: "Display a value from a JSON endpoint.", icon: Webhook },
  "calendar-agenda": { title: "Calendar agenda", description: "Upcoming events from a private iCalendar feed.", icon: CalendarDays },
  "feed-reader": { title: "RSS & releases", description: "News or software releases from an RSS or Atom feed.", icon: Rss },
  beszel: { title: "Beszel", description: "Live systems and resource metrics from Beszel.", icon: Activity },
};

const widgetTypes = (Object.keys(widgetMeta) as DashboardWidgetType[]).filter((type) => type !== "beszel");
const catalogGroups = [
  {
    placement: "topbar" as const,
    eyebrow: "Top bar",
    title: "Compact at-a-glance widgets",
    description: "Small modules that stay visible beside search, time and weather.",
  },
  {
    placement: "dashboard" as const,
    eyebrow: "Dashboard",
    title: "Larger content cards",
    description: "Rich cards that can be placed and resized beside service groups in the shared board.",
  },
];

function widgetTitle(widget: DashboardWidget): string {
  if (widget.type !== "custom-api" && widget.type !== "calendar-agenda" && widget.type !== "feed-reader" && widget.type !== "media-activity" && widget.type !== "network-traffic" && widget.type !== "beszel") return widgetMeta[widget.type].title;
  const label = widget.config.label;
  return typeof label === "string" && label.trim() ? label.trim() : widgetMeta[widget.type].title;
}

export function WidgetsTab({ data, onCommit }: WidgetsTabProps) {
  const orderedWidgets = useMemo(() => orderDashboardWidgets(data.widgets), [data.widgets]);
  const [selectedId, setSelectedId] = useState(orderedWidgets[0]?.id ?? "");
  const [configDraft, setConfigDraft] = useState<Record<string, unknown>>(orderedWidgets[0]?.config ?? {});
  const [showCatalog, setShowCatalog] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState("");
  const [busy, setBusy] = useState(false);
  const [beszelUsername, setBeszelUsername] = useState("");
  const [beszelPassword, setBeszelPassword] = useState("");
  const [beszelPasswordConfigured, setBeszelPasswordConfigured] = useState(false);
  const [beszelSystems, setBeszelSystems] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [beszelState, setBeszelState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [beszelMessage, setBeszelMessage] = useState("");
  const [calendarFeedUrl, setCalendarFeedUrl] = useState("");
  const [calendarFeedConfigured, setCalendarFeedConfigured] = useState(false);
  const [calendarState, setCalendarState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [calendarMessage, setCalendarMessage] = useState("");
  const [readerFeedUrl, setReaderFeedUrl] = useState("");
  const [readerFeedConfigured, setReaderFeedConfigured] = useState(false);
  const [readerState, setReaderState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [readerMessage, setReaderMessage] = useState("");
  const selected = orderedWidgets.find((widget) => widget.id === selectedId) ?? orderedWidgets[0];
  const selectedIndex = selected ? orderedWidgets.findIndex((widget) => widget.id === selected.id) : -1;
  const selectedPlacementWidgets = selected
    ? orderedWidgets.filter((widget) => dashboardWidgetPlacement(widget.type) === dashboardWidgetPlacement(selected.type))
    : [];
  const selectedPlacementIndex = selected
    ? selectedPlacementWidgets.findIndex((widget) => widget.id === selected.id)
    : -1;
  const mediaServices = useMemo(() => data.groups.flatMap((group) => group.services
    .filter((service) => service.visible && service.plugin?.enabled && (service.plugin.type === "jellyfin" || service.plugin.type === "plex"))
    .map((service) => ({ service, groupName: group.name }))), [data.groups]);
  const selectedMediaServiceIds = Array.isArray(configDraft.serviceIds)
    ? configDraft.serviceIds.filter((value): value is string => typeof value === "string")
    : [];
  const mikrotikServices = useMemo(() => data.groups.flatMap((group) => group.services
    .filter((service) => service.visible && service.plugin?.enabled && service.plugin.type === "mikrotik")
    .map((service) => ({ service, groupName: group.name }))), [data.groups]);
  const selectedMikrotikService = mikrotikServices.find(({ service }) => service.id === String(configDraft.serviceId ?? ""))?.service;

  useEffect(() => {
    if (!selectedId || data.widgets.some((widget) => widget.id === selectedId)) return;
    const next = orderDashboardWidgets(data.widgets)[0];
    setSelectedId(next?.id ?? "");
    setConfigDraft({ ...(next?.config ?? {}) });
  }, [data.widgets, selectedId]);

  useEffect(() => {
    if (!selected || selected.type !== "beszel") {
      setBeszelUsername("");
      setBeszelPassword("");
      setBeszelPasswordConfigured(false);
      setBeszelSystems([]);
      setBeszelState("idle");
      setBeszelMessage("");
      return;
    }
    let active = true;
    setBeszelPassword("");
    setBeszelState("loading");
    api<{ username: string; passwordConfigured: boolean }>(`/api/widgets/${encodeURIComponent(selected.id)}/credentials`)
      .then((credentials) => {
        if (!active) return;
        setBeszelUsername(credentials.username);
        setBeszelPasswordConfigured(credentials.passwordConfigured);
        setBeszelState("idle");
      })
      .catch((error) => {
        if (!active) return;
        setBeszelState("error");
        setBeszelMessage(error instanceof Error ? error.message : "Could not load Beszel credentials.");
      });
    return () => { active = false; };
  }, [selected?.id, selected?.type]);

  useEffect(() => {
    if (!selected || selected.type !== "feed-reader") {
      setReaderFeedUrl("");
      setReaderFeedConfigured(false);
      setReaderState("idle");
      setReaderMessage("");
      return;
    }
    let active = true;
    setReaderFeedUrl("");
    setReaderState("loading");
    api<{ feedConfigured: boolean }>(`/api/widgets/${encodeURIComponent(selected.id)}/credentials`)
      .then((credentials) => {
        if (!active) return;
        setReaderFeedConfigured(credentials.feedConfigured);
        setReaderState("idle");
      })
      .catch((error) => {
        if (!active) return;
        setReaderState("error");
        setReaderMessage(error instanceof Error ? error.message : "Could not load feed settings.");
      });
    return () => { active = false; };
  }, [selected?.id, selected?.type]);

  useEffect(() => {
    if (!selected || selected.type !== "calendar-agenda") {
      setCalendarFeedUrl("");
      setCalendarFeedConfigured(false);
      setCalendarState("idle");
      setCalendarMessage("");
      return;
    }
    let active = true;
    setCalendarFeedUrl("");
    setCalendarState("loading");
    api<{ feedConfigured: boolean }>(`/api/widgets/${encodeURIComponent(selected.id)}/credentials`)
      .then((credentials) => {
        if (!active) return;
        setCalendarFeedConfigured(credentials.feedConfigured);
        setCalendarState("idle");
      })
      .catch((error) => {
        if (!active) return;
        setCalendarState("error");
        setCalendarMessage(error instanceof Error ? error.message : "Could not load calendar settings.");
      });
    return () => { active = false; };
  }, [selected?.id, selected?.type]);

  async function commitWidgets(widgets: DashboardWidget[], message: string) {
    const normalized = normalizeWidgetPositions(widgets);
    setBusy(true);
    try {
      await onCommit({
        ...data,
        widgets: normalized,
        settings: synchronizeLegacyWidgetSettings(data.settings, normalized),
      }, message);
    } finally {
      setBusy(false);
    }
  }

  function choose(widget: DashboardWidget) {
    setSelectedId(widget.id);
    setConfigDraft({ ...widget.config });
    setPendingDeleteId("");
  }

  async function addWidget(type: DashboardWidgetType) {
    if (SINGLETON_WIDGET_TYPES.has(type) && data.widgets.some((widget) => widget.type === type)) return;
    const widget: DashboardWidget = {
      id: createClientId("widget"),
      type,
      enabled: true,
      position: data.widgets.length,
      config: defaultWidgetConfig(type, data.settings),
    };
    setSelectedId(widget.id);
    setConfigDraft({ ...widget.config });
    setShowCatalog(false);
    await commitWidgets([...data.widgets, widget], `${widgetMeta[type].title} widget added`);
  }

  async function toggleWidget(widget: DashboardWidget, enabled: boolean) {
    await commitWidgets(
      data.widgets.map((item) => item.id === widget.id ? { ...item, enabled } : item),
      `${widgetTitle(widget)} ${enabled ? "enabled" : "disabled"}`,
    );
  }

  async function saveConfig() {
    if (!selected) return;
    const widgets = data.widgets.map((widget) => (
      widget.id === selected.id ? { ...widget, config: { ...configDraft } } : widget
    ));
    await commitWidgets(widgets, `${widgetTitle({ ...selected, config: configDraft })} settings saved`);
    if (selected.type === "beszel") {
      setBeszelState("loading");
      try {
        const credentials = await api<{ username: string; passwordConfigured: boolean }>(
          `/api/widgets/${encodeURIComponent(selected.id)}/credentials`,
          {
            method: "PUT",
            body: JSON.stringify({ username: beszelUsername, ...(beszelPassword ? { password: beszelPassword } : {}) }),
          },
        );
        setBeszelPassword("");
        setBeszelPasswordConfigured(credentials.passwordConfigured);
        setBeszelState("success");
        setBeszelMessage("Beszel settings and credentials saved.");
      } catch (error) {
        setBeszelState("error");
        setBeszelMessage(error instanceof Error ? error.message : "Could not save Beszel credentials.");
      }
    }
    if (selected.type === "calendar-agenda") {
      setCalendarState("loading");
      try {
        const credentials = await api<{ feedConfigured: boolean }>(
          `/api/widgets/${encodeURIComponent(selected.id)}/credentials`,
          {
            method: "PUT",
            body: JSON.stringify(calendarFeedUrl ? { feedUrl: calendarFeedUrl } : {}),
          },
        );
        setCalendarFeedUrl("");
        setCalendarFeedConfigured(credentials.feedConfigured);
        setCalendarState("success");
        setCalendarMessage("Calendar settings saved.");
      } catch (error) {
        setCalendarState("error");
        setCalendarMessage(error instanceof Error ? error.message : "Could not save the calendar feed.");
      }
    }
    if (selected.type === "feed-reader") {
      setReaderState("loading");
      try {
        const credentials = await api<{ feedConfigured: boolean }>(
          `/api/widgets/${encodeURIComponent(selected.id)}/credentials`,
          {
            method: "PUT",
            body: JSON.stringify(readerFeedUrl ? { feedUrl: readerFeedUrl } : {}),
          },
        );
        setReaderFeedUrl("");
        setReaderFeedConfigured(credentials.feedConfigured);
        setReaderState("success");
        setReaderMessage("Feed settings saved.");
      } catch (error) {
        setReaderState("error");
        setReaderMessage(error instanceof Error ? error.message : "Could not save the feed.");
      }
    }
  }

  async function testBeszel() {
    if (!selected || selected.type !== "beszel") return;
    setBeszelState("loading");
    setBeszelMessage("");
    try {
      const result = await api<{ systems: Array<{ id: string; name: string; status: string }>; total: number; up: number }>(
        `/api/widgets/beszel/${encodeURIComponent(selected.id)}/test`,
        {
          method: "POST",
          body: JSON.stringify({
            config: {
              url: String(configDraft.url ?? ""),
              version: Number(configDraft.version ?? 2),
              systemId: String(configDraft.systemId ?? ""),
            },
            credentials: {
              username: beszelUsername,
              ...(beszelPassword ? { password: beszelPassword } : {}),
            },
          }),
        },
      );
      setBeszelSystems(result.systems);
      setBeszelState("success");
      setBeszelMessage(`Connected to Beszel: ${result.up} of ${result.total} systems are up.`);
    } catch (error) {
      setBeszelState("error");
      setBeszelMessage(error instanceof Error ? error.message : "Could not connect to Beszel.");
    }
  }

  async function testCalendar() {
    if (!selected || selected.type !== "calendar-agenda") return;
    setCalendarState("loading");
    setCalendarMessage("");
    try {
      const result = await api<{ calendarName: string; upcoming: number; hasMore: boolean }>(
        `/api/widgets/calendar-agenda/${encodeURIComponent(selected.id)}/test`,
        {
          method: "POST",
          body: JSON.stringify({
            config: {
              label: String(configDraft.label ?? "Agenda"),
              daysAhead: Number(configDraft.daysAhead ?? 14),
              maxEvents: Number(configDraft.maxEvents ?? 8),
            },
            credentials: calendarFeedUrl ? { feedUrl: calendarFeedUrl } : {},
          }),
        },
      );
      setCalendarState("success");
      const calendarName = result.calendarName ? ` “${result.calendarName}”` : "";
      const more = result.hasMore ? "+" : "";
      setCalendarMessage(`Connected to calendar${calendarName}: ${result.upcoming}${more} upcoming events loaded.`);
    } catch (error) {
      setCalendarState("error");
      setCalendarMessage(error instanceof Error ? error.message : "Could not connect to the calendar feed.");
    }
  }

  async function testFeedReader() {
    if (!selected || selected.type !== "feed-reader") return;
    setReaderState("loading");
    setReaderMessage("");
    try {
      const result = await api<{ feedTitle: string; items: number; hasMore: boolean }>(
        `/api/widgets/feed-reader/${encodeURIComponent(selected.id)}/test`,
        {
          method: "POST",
          body: JSON.stringify({
            config: {
              label: String(configDraft.label ?? "Latest news"),
              mode: configDraft.mode === "releases" ? "releases" : "articles",
              maxItems: Number(configDraft.maxItems ?? 6),
              maxAgeDays: Number(configDraft.maxAgeDays ?? 30),
              showImages: configDraft.showImages !== false,
            },
            credentials: readerFeedUrl ? { feedUrl: readerFeedUrl } : {},
          }),
        },
      );
      setReaderState("success");
      const feedTitle = result.feedTitle ? ` “${result.feedTitle}”` : "";
      const more = result.hasMore ? "+" : "";
      setReaderMessage(`Connected to feed${feedTitle}: ${result.items}${more} items loaded.`);
    } catch (error) {
      setReaderState("error");
      setReaderMessage(error instanceof Error ? error.message : "Could not connect to the feed.");
    }
  }

  async function moveSelected(direction: -1 | 1) {
    if (!selected) return;
    await commitWidgets(moveDashboardWidget(data.widgets, selected.id, direction), "Widget order updated");
  }

  async function deleteSelected() {
    if (!selected) return;
    const remaining = orderedWidgets.filter((widget) => widget.id !== selected.id);
    const next = remaining[Math.min(selectedIndex, Math.max(0, remaining.length - 1))];
    setSelectedId(next?.id ?? "");
    setConfigDraft({ ...(next?.config ?? {}) });
    setPendingDeleteId("");
    await commitWidgets(remaining, `${widgetTitle(selected)} widget deleted`);
  }

  function renderWidgetCard(widget: DashboardWidget) {
    const meta = widgetMeta[widget.type];
    const Icon = meta.icon;
    return (
      <article
        key={widget.id}
        className={`admin-widget-card ${selected?.id === widget.id ? "admin-widget-card--active" : ""}`}
      >
        <div className="admin-widget-card__top">
          <button type="button" className="admin-widget-card__select" onClick={() => choose(widget)} aria-pressed={selected?.id === widget.id}>
            <span className="admin-widget-card__icon"><Icon size={20} /></span>
          </button>
          <Switch checked={widget.enabled} onChange={(enabled) => void toggleWidget(widget, enabled)} label={`${widgetTitle(widget)} widget`} disabled={busy} />
        </div>
        <button type="button" className="admin-widget-card__body" onClick={() => choose(widget)} aria-label={`Configure ${widgetTitle(widget)}`}>
          <strong>{widgetTitle(widget)}</strong>
          <p>{meta.description}</p>
          <span className="admin-widget-card__configure"><SlidersHorizontal size={14} /> Configure</span>
        </button>
      </article>
    );
  }

  return (
    <div className="admin-widgets-workspace">
      <header className="admin-widgets-workspace__topbar">
        <span><h1>Widgets</h1><small>Configure information in the top bar and on the dashboard.</small></span>
        <Button variant={showCatalog ? "secondary" : "primary"} onClick={() => setShowCatalog((visible) => !visible)} disabled={busy}>
          {showCatalog ? <X size={16} /> : <Plus size={16} />}
          {showCatalog ? "Close catalog" : "Add widget"}
        </Button>
      </header>

      <div className="admin-widgets-content">
      <p className="admin-widgets-note">Native provider plugins now belong to Services. Use this workspace for top bar and dashboard widgets.</p>
      {showCatalog ? (
        <section className="admin-widget-catalog" aria-label="Widget catalog">
          <header><span><small>Widget catalog</small><strong>Choose where it belongs</strong></span><p>Top bar widgets stay compact. Dashboard widgets have room for richer visual cards.</p></header>
          <div className="admin-widget-catalog__groups">
            {catalogGroups.map((group) => (
              <section className="admin-widget-catalog__group" key={group.placement}>
                <header><span><small>{group.eyebrow}</small><strong>{group.title}</strong></span><p>{group.description}</p></header>
                <div className="admin-widget-catalog__grid">
                  {widgetTypes.filter((type) => dashboardWidgetPlacement(type) === group.placement).map((type) => {
                    const meta = widgetMeta[type];
                    const Icon = meta.icon;
                    const alreadyAdded = SINGLETON_WIDGET_TYPES.has(type) && data.widgets.some((widget) => widget.type === type);
                    return (
                      <button key={type} type="button" onClick={() => void addWidget(type)} disabled={busy || alreadyAdded}>
                        <span><Icon size={19} /></span>
                        <span><strong>{meta.title}</strong><small>{alreadyAdded ? "Already added" : meta.description}</small></span>
                        {alreadyAdded ? <span className="admin-widget-catalog__added">Added</span> : <Plus size={16} />}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </section>
      ) : null}

      <div className="admin-widget-layout">
        <div className="admin-widget-sections">
          {catalogGroups.map((group) => {
            const widgets = orderedWidgets.filter((widget) => dashboardWidgetPlacement(widget.type) === group.placement);
            return (
              <section className="admin-widget-section" key={group.placement} aria-labelledby={`widget-section-${group.placement}`}>
                <header>
                  <span><small>{group.eyebrow}</small><strong id={`widget-section-${group.placement}`}>{group.title}</strong></span>
                  <span>{widgets.length} configured</span>
                </header>
                <div className="admin-widget-grid">
                  {widgets.map(renderWidgetCard)}
                  {widgets.length === 0 ? (
                    <EmptyState icon={<Blocks size={20} />} title={`No ${group.eyebrow.toLocaleLowerCase()} widgets`}>
                      Open the catalog to add one.
                    </EmptyState>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>

        <Panel
          className="admin-widget-settings"
          title={selected ? widgetTitle(selected) : "Widget settings"}
          description={selected ? "Changes apply to this widget only." : "Select or add a widget to configure it."}
          action={selected ? (
            <span className="admin-widget-order-actions">
              <IconButton label="Move widget up" onClick={() => void moveSelected(-1)} disabled={busy || selectedPlacementIndex <= 0}><ArrowUp size={15} /></IconButton>
              <IconButton label="Move widget down" onClick={() => void moveSelected(1)} disabled={busy || selectedPlacementIndex >= selectedPlacementWidgets.length - 1}><ArrowDown size={15} /></IconButton>
            </span>
          ) : undefined}
        >
          {selected ? (
            <div className="admin-stacked-form">
              {selected.type === "weather" ? (
                <>
                  <Field label="Location label" value={String(configDraft.label ?? data.settings.weatherLabel)} onChange={(event) => setConfigDraft({ ...configDraft, label: event.target.value })} placeholder="Your city" />
                  <div className="admin-form-grid">
                    <Field label="Latitude" type="number" step="any" min={-90} max={90} value={String(configDraft.latitude ?? data.settings.weatherLatitude)} onChange={(event) => setConfigDraft({ ...configDraft, latitude: Number(event.target.value) })} />
                    <Field label="Longitude" type="number" step="any" min={-180} max={180} value={String(configDraft.longitude ?? data.settings.weatherLongitude)} onChange={(event) => setConfigDraft({ ...configDraft, longitude: Number(event.target.value) })} />
                  </div>
                </>
              ) : null}
              {selected.type === "search" ? (
                <SelectField label="Search provider" value={String(configDraft.provider ?? "internal")} onChange={(provider) => setConfigDraft({ ...configDraft, provider })}>
                  <option value="internal">Dashboard services</option>
                  <option value="google">Google</option>
                  <option value="duckduckgo">DuckDuckGo</option>
                </SelectField>
              ) : null}
              {selected.type === "clock" ? (
                <SelectField label="Clock format" value={String(configDraft.format ?? "24h")} onChange={(format) => setConfigDraft({ ...configDraft, format })}>
                  <option value="24h">24-hour</option>
                  <option value="12h">12-hour</option>
                </SelectField>
              ) : null}
              {selected.type === "system-resources" ? (
                <>
                  <SelectField label="Refresh interval" value={Number(configDraft.refreshSeconds ?? 5)} onChange={(refreshSeconds) => setConfigDraft({ ...configDraft, refreshSeconds: Number(refreshSeconds) })}>
                    <option value={5}>Every 5 seconds</option>
                    <option value={10}>Every 10 seconds</option>
                    <option value={30}>Every 30 seconds</option>
                  </SelectField>
                  <Notice kind="success">No connection or credentials needed. Dashcenter reads aggregate CPU, memory, disk and uptime values from its host.</Notice>
                </>
              ) : null}
              {selected.type === "service-availability" ? (
                <Notice kind="success">No connection or credentials needed. This widget summarizes visible services that have a status indicator enabled and opens a list of services that need attention.</Notice>
              ) : null}
              {selected.type === "server-health" ? (
                <>
                  <SelectField label="Refresh interval" value={Number(configDraft.refreshSeconds ?? 5)} onChange={(refreshSeconds) => setConfigDraft({ ...configDraft, refreshSeconds: Number(refreshSeconds) })}>
                    <option value={5}>Every 5 seconds</option>
                    <option value={10}>Every 10 seconds</option>
                    <option value={30}>Every 30 seconds</option>
                  </SelectField>
                  <SelectField label="Docker containers" value={String(configDraft.dockerConnectionId ?? "")} onChange={(dockerConnectionId) => setConfigDraft({ ...configDraft, dockerConnectionId })}>
                    <option value="">Automatic when one connection is enabled</option>
                    <option value="none">Do not include Docker containers</option>
                    {data.connections.filter((connection) => connection.enabled).map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}
                  </SelectField>
                  <Notice kind="success">No credentials needed. Host trends are kept in memory for up to 24 hours during the current Dashcenter run. Docker counts appear only when the selected connection responds.</Notice>
                </>
              ) : null}
              {selected.type === "service-health" ? (
                <Notice kind="success">No credentials or duplicate checks needed. This dashboard card uses the same monitored-service summary as the Service availability top-bar module.</Notice>
              ) : null}
              {selected.type === "media-activity" ? (
                <>
                  <Field label="Label" value={String(configDraft.label ?? "Now playing")} onChange={(event) => setConfigDraft({ ...configDraft, label: event.target.value })} placeholder="Now playing" />
                  <div className="admin-toggle-list" aria-label="Media services">
                    {mediaServices.map(({ service, groupName }) => (
                      <ToggleRow
                        key={service.id}
                        title={service.name}
                        description={`${groupName} · ${service.plugin?.type === "jellyfin" ? "Jellyfin" : "Plex"}`}
                        checked={selectedMediaServiceIds.includes(service.id)}
                        onChange={(checked) => setConfigDraft({
                          ...configDraft,
                          serviceIds: checked
                            ? [...selectedMediaServiceIds, service.id]
                            : selectedMediaServiceIds.filter((id) => id !== service.id),
                        })}
                      />
                    ))}
                  </div>
                  {mediaServices.length === 0 ? <Notice kind="warning">Add and enable a visible Jellyfin or Plex service plugin before selecting a source.</Notice> : null}
                  <div className="admin-form-grid">
                    <SelectField label="Maximum sessions" value={Number(configDraft.maxSessions ?? 4)} onChange={(maxSessions) => setConfigDraft({ ...configDraft, maxSessions: Number(maxSessions) })}>
                      <option value={1}>1 session</option>
                      <option value={2}>2 sessions</option>
                      <option value={4}>4 sessions</option>
                      <option value={6}>6 sessions</option>
                      <option value={8}>8 sessions</option>
                    </SelectField>
                    <SelectField label="Artwork" value={configDraft.showArtwork === false ? "hidden" : "shown"} onChange={(value) => setConfigDraft({ ...configDraft, showArtwork: value === "shown" })}>
                      <option value="shown">Show when available</option>
                      <option value="hidden">Hide artwork</option>
                    </SelectField>
                  </div>
                  <Notice kind="success">This widget reuses the read-only credentials stored on each selected service. No media server credentials are copied into the widget.</Notice>
                </>
              ) : null}
              {selected.type === "network-traffic" ? (
                <>
                  <Field label="Label" value={String(configDraft.label ?? "Network")} onChange={(event) => setConfigDraft({ ...configDraft, label: event.target.value })} placeholder="Network" />
                  <SelectField label="MikroTik source" value={String(configDraft.serviceId ?? "")} onChange={(serviceId) => setConfigDraft({ ...configDraft, serviceId })}>
                    <option value="">Choose a MikroTik service</option>
                    {mikrotikServices.map(({ service, groupName }) => (
                      <option key={service.id} value={service.id}>{service.name} · {groupName}</option>
                    ))}
                  </SelectField>
                  {mikrotikServices.length === 0 ? <Notice kind="warning">Add and enable a visible MikroTik service plugin before selecting a source.</Notice> : null}
                  {selectedMikrotikService && !String(selectedMikrotikService.plugin?.config.interfaceName ?? "").trim() ? (
                    <Notice kind="warning">Test this MikroTik service and select its traffic interface before using the widget.</Notice>
                  ) : null}
                  <Notice kind="success">This widget stores only the selected service ID. RouterOS credentials and the interface selection remain on the MikroTik service plugin.</Notice>
                </>
              ) : null}
              {selected.type === "docker" ? (
                <SelectField label="Display" value={String(configDraft.display ?? "summary")} onChange={(display) => setConfigDraft({ ...configDraft, display })}>
                  <option value="summary">Online summary</option>
                  <option value="detailed">Detailed health counts</option>
                </SelectField>
              ) : null}
              {selected.type === "custom-api" ? (
                <>
                  <Field label="Label" value={String(configDraft.label ?? "")} onChange={(event) => setConfigDraft({ ...configDraft, label: event.target.value })} placeholder="Builds" />
                  <Field label="JSON endpoint" type="url" value={String(configDraft.url ?? "")} onChange={(event) => setConfigDraft({ ...configDraft, url: event.target.value })} placeholder="https://…" />
                  <Field label="Value path" value={String(configDraft.path ?? "")} onChange={(event) => setConfigDraft({ ...configDraft, path: event.target.value })} placeholder="data.value" hint="Use dot notation; leave empty to display the full response." />
                </>
              ) : null}
              {selected.type === "calendar-agenda" ? (
                <>
                  <Field label="Label" value={String(configDraft.label ?? "Agenda")} onChange={(event) => setConfigDraft({ ...configDraft, label: event.target.value })} placeholder="Agenda" />
                  <Field
                    label="iCalendar feed URL"
                    type="url"
                    value={calendarFeedUrl}
                    onChange={(event) => setCalendarFeedUrl(event.target.value)}
                    placeholder={calendarFeedConfigured ? "Stored securely on the server" : "https://…/calendar.ics"}
                    hint={calendarFeedConfigured ? "Leave blank to keep the stored URL. Paste a new one to replace it." : "Use a private or public http(s) ICS feed. The URL stays on the Dashcenter server."}
                    autoComplete="off"
                  />
                  <div className="admin-form-grid">
                    <SelectField label="Show events for" value={Number(configDraft.daysAhead ?? 14)} onChange={(daysAhead) => setConfigDraft({ ...configDraft, daysAhead: Number(daysAhead) })}>
                      <option value={7}>Next 7 days</option>
                      <option value={14}>Next 14 days</option>
                      <option value={30}>Next 30 days</option>
                      <option value={60}>Next 60 days</option>
                    </SelectField>
                    <SelectField label="Maximum events" value={Number(configDraft.maxEvents ?? 8)} onChange={(maxEvents) => setConfigDraft({ ...configDraft, maxEvents: Number(maxEvents) })}>
                      <option value={5}>5 events</option>
                      <option value={8}>8 events</option>
                      <option value={12}>12 events</option>
                      <option value={20}>20 events</option>
                    </SelectField>
                  </div>
                  <div className="admin-widget-integration-actions">
                    <Button variant="secondary" onClick={() => void testCalendar()} disabled={busy || calendarState === "loading"}>{calendarState === "loading" ? "Connecting…" : "Test connection"}</Button>
                    <span>Read-only integration</span>
                  </div>
                  {calendarMessage ? <Notice kind={calendarState === "error" ? "danger" : "success"}>{calendarMessage}</Notice> : null}
                </>
              ) : null}
              {selected.type === "feed-reader" ? (
                <>
                  <Field label="Label" value={String(configDraft.label ?? "Latest news")} onChange={(event) => setConfigDraft({ ...configDraft, label: event.target.value })} placeholder={configDraft.mode === "releases" ? "New releases" : "Latest news"} />
                  <SelectField label="Content mode" value={String(configDraft.mode ?? "articles")} onChange={(mode) => setConfigDraft({ ...configDraft, mode })}>
                    <option value="articles">News and articles</option>
                    <option value="releases">Software releases</option>
                  </SelectField>
                  <Field
                    label="RSS or Atom feed URL"
                    type="url"
                    value={readerFeedUrl}
                    onChange={(event) => setReaderFeedUrl(event.target.value)}
                    placeholder={readerFeedConfigured ? "Stored securely on the server" : "https://…/feed.xml"}
                    hint={readerFeedConfigured ? "Leave blank to keep the stored URL. Paste a new one to replace it." : "Public and private http(s) feeds are supported. GitHub release feeds usually end in /releases.atom."}
                    autoComplete="off"
                  />
                  <div className="admin-form-grid">
                    <SelectField label="Maximum items" value={Number(configDraft.maxItems ?? 6)} onChange={(maxItems) => setConfigDraft({ ...configDraft, maxItems: Number(maxItems) })}>
                      <option value={4}>4 items</option>
                      <option value={6}>6 items</option>
                      <option value={8}>8 items</option>
                      <option value={12}>12 items</option>
                    </SelectField>
                    <SelectField label="Maximum age" value={Number(configDraft.maxAgeDays ?? 30)} onChange={(maxAgeDays) => setConfigDraft({ ...configDraft, maxAgeDays: Number(maxAgeDays) })}>
                      <option value={7}>7 days</option>
                      <option value={30}>30 days</option>
                      <option value={90}>90 days</option>
                      <option value={365}>1 year</option>
                      <option value={0}>Any date</option>
                    </SelectField>
                  </div>
                  <SelectField label="Feed images" value={configDraft.showImages === false ? "hidden" : "shown"} onChange={(value) => setConfigDraft({ ...configDraft, showImages: value === "shown" })}>
                    <option value="shown">Show when available</option>
                    <option value="hidden">Hide images</option>
                  </SelectField>
                  <div className="admin-widget-integration-actions">
                    <Button variant="secondary" onClick={() => void testFeedReader()} disabled={busy || readerState === "loading"}>{readerState === "loading" ? "Connecting…" : "Test connection"}</Button>
                    <span>Read-only RSS/Atom integration</span>
                  </div>
                  {readerMessage ? <Notice kind={readerState === "error" ? "danger" : "success"}>{readerMessage}</Notice> : null}
                </>
              ) : null}
              {selected.type === "beszel" ? (
                <>
                  <Field label="Label" value={String(configDraft.label ?? "Beszel")} onChange={(event) => setConfigDraft({ ...configDraft, label: event.target.value })} placeholder="Beszel" />
                  <Field label="Beszel URL" type="url" value={String(configDraft.url ?? "")} onChange={(event) => setConfigDraft({ ...configDraft, url: event.target.value })} placeholder="http://beszel:8090" hint="Use the URL reachable from the Dashcenter container. Do not add /api." />
                  <SelectField label="Beszel version" value={Number(configDraft.version ?? 2)} onChange={(version) => setConfigDraft({ ...configDraft, version: Number(version) })}>
                    <option value={2}>0.9.0 or newer</option>
                    <option value={1}>Older than 0.9.0</option>
                  </SelectField>
                  <Field label="Superuser email" type="email" value={beszelUsername} onChange={(event) => setBeszelUsername(event.target.value)} autoComplete="username" />
                  <Field
                    label="Password"
                    type="password"
                    value={beszelPassword}
                    onChange={(event) => setBeszelPassword(event.target.value)}
                    autoComplete="new-password"
                    placeholder={beszelPasswordConfigured ? "Stored securely on the server" : "Beszel superuser password"}
                    hint={beszelPasswordConfigured ? "Leave blank to keep the stored password." : "The password is stored server-side and never included in the public dashboard data."}
                  />
                  {beszelSystems.length > 0 ? (
                    <SelectField label="Display" value={String(configDraft.systemId ?? "")} onChange={(systemId) => setConfigDraft({ ...configDraft, systemId })}>
                      <option value="">All systems overview</option>
                      {beszelSystems.map((system) => <option key={system.id} value={system.id}>{system.name} · {system.status}</option>)}
                    </SelectField>
                  ) : (
                    <Field label="System ID or name" value={String(configDraft.systemId ?? "")} onChange={(event) => setConfigDraft({ ...configDraft, systemId: event.target.value })} placeholder="Leave blank for all systems" hint="Test the connection to load a dropdown of available systems." />
                  )}
                  <div className="admin-widget-integration-actions">
                    <Button variant="secondary" onClick={() => void testBeszel()} disabled={busy || beszelState === "loading"}>{beszelState === "loading" ? "Connecting…" : "Test connection"}</Button>
                    <span>Read-only integration</span>
                  </div>
                  {beszelMessage ? <Notice kind={beszelState === "error" ? "danger" : "success"}>{beszelMessage}</Notice> : null}
                </>
              ) : null}

              <div className="admin-widget-settings__actions">
                <Button variant="primary" onClick={() => void saveConfig()} disabled={busy}>{busy ? "Saving…" : "Save widget"}</Button>
                <Button variant="danger" onClick={() => setPendingDeleteId(selected.id)} disabled={busy}><Trash2 size={15} /> Delete</Button>
              </div>

              {pendingDeleteId === selected.id ? (
                <Notice kind="danger">
                  <div className="admin-widget-delete-confirmation">
                    <span><strong>Delete this widget?</strong><small>You can add the same type again from the catalog.</small></span>
                    <span><Button variant="ghost" onClick={() => setPendingDeleteId("")}>Cancel</Button><Button variant="danger" onClick={() => void deleteSelected()} disabled={busy}>Delete widget</Button></span>
                  </div>
                </Notice>
              ) : null}
            </div>
          ) : (
            <p className="admin-muted-copy">No widgets are configured.</p>
          )}
        </Panel>
      </div>
      </div>
    </div>
  );
}

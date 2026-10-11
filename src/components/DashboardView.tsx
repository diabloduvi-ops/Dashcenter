import {
  closestCenter,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  pointerWithin,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arraySwap,
  rectSwappingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BadgePercent,
  Blocks,
  CalendarDays,
  Captions,
  ChevronDown,
  Clapperboard,
  Cloud,
  CloudSun,
  Clock3,
  Command,
  Container,
  Cpu,
  Download,
  Disc3,
  ExternalLink,
  Film,
  Gamepad2,
  GripVertical,
  HardDrive,
  LayoutGrid,
  Maximize2,
  MemoryStick,
  MapPin,
  Network,
  Play,
  RefreshCw,
  Router,
  Rocket,
  Rss,
  Search,
  ServerCog,
  Settings2,
  ShieldCheck,
  Tv,
  Upload,
  RotateCcw,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createClockFormatter, normalizeClockFormat } from "../../shared/clock";
import { appearanceCssVariables } from "../../shared/appearance";
import type { MediaActivity, MediaActivitySession } from "../../shared/media-activity";
import { orderDashboardGroups } from "../../shared/layout";
import {
  AUTO_GRID_COLUMN_START,
  AUTO_GRID_ROW_SPAN,
  GRID_ROW_HEIGHT_PX,
  MAX_GRID_COLUMN_SPAN,
  MAX_GRID_ROW_SPAN,
  normalizeGridColumnSpan,
  normalizeGridColumnStart,
  normalizeGridRowSpan,
  reconcileDashboardGrid,
} from "../../shared/dashboard-grid";
import { summarizeServiceAvailability } from "../../shared/service-availability";
import type { DashboardData, DashboardGridItem, DashboardGroup, DashboardService, DashboardWidget, ServiceGroupDirection } from "../../shared/types";
import { DASHCENTER_RELEASE } from "../../shared/version";
import { dashboardWidgetPlacement, orderDashboardWidgets } from "../../shared/widgets";
import { DashcenterMark } from "./DashcenterMark";
import { ServiceIcon } from "./ServiceIcon";

interface DashboardViewProps {
  data: DashboardData;
  onOpenSettings: () => void;
  onManageServices?: () => void;
  onManageWidgets?: () => void;
  onRefresh: () => Promise<void>;
  mode?: "published" | "workspace" | "appearance";
  previewMode?: DashboardPreviewMode;
  editor?: {
    active: true;
    saving: boolean;
    dirty: boolean;
    canUndo: boolean;
    canRedo: boolean;
    error: string;
    onChange: (next: DashboardData) => void;
    onUndo: () => void;
    onRedo: () => void;
    onCancel: () => void;
    onSave: () => void;
  };
}

export type DashboardPreviewMode = "desktop" | "tablet" | "mobile";

const preciseSwapCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

type WeatherData = { temperature: number; description: string; weatherCode?: number };

const DASHBOARD_POLL_INTERVAL_MS = 7_000;
const DASHBOARD_GRID_TRACK_PX = 4;
const DASHBOARD_GRID_GAP_PX = 14;
const EDITOR_PREVIEW_COLUMN_WIDTH_PX = 300;

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function useResponsiveBoard(preferred: number) {
  const measure = () => {
    const viewportWidth = window.innerWidth;
    const columnCount = viewportWidth < 760
      ? 1
      : viewportWidth < 1180
        ? Math.min(2, preferred)
        : preferred;
    return { columnCount, viewportWidth };
  };
  const [layout, setLayout] = useState(measure);
  useEffect(() => {
    const update = () => setLayout(measure());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [preferred]);
  return layout;
}

function statusLabel(service: DashboardService) {
  if (!service.statusCheck) return "Status check disabled";
  switch (service.status) {
    case "healthy":
      return "Service is reachable";
    case "unhealthy":
      return service.statusMessage || "Service is unavailable";
    case "checking":
      return "Checking service";
    default:
      return "Status not checked yet";
  }
}

function serviceStatusText(service: DashboardService) {
  if (!service.statusCheck) return "";
  switch (service.status) {
    case "healthy":
      return "Online";
    case "unhealthy":
      return "Down";
    case "checking":
      return "Checking";
    default:
      return "Unknown";
  }
}

function ServiceRow({ service, openInNewTab }: { service: DashboardService; openInNewTab: boolean }) {
  return (
    <article className={`service-entry ${service.plugin?.enabled ? "service-entry--plugin" : ""}`}>
      <a
        className="service-row"
        href={service.href || undefined}
        target={openInNewTab ? "_blank" : undefined}
        rel={openInNewTab ? "noreferrer" : undefined}
        aria-label={`${service.name}: ${service.description}`}
      >
        <ServiceIcon icon={service.icon} name={service.name} />
        <span className="service-copy">
          <strong>{service.name}</strong>
          <small>{service.description || service.href}</small>
        </span>
        {service.statusCheck ? (
          <span className={`service-status service-status--${service.status}`} title={statusLabel(service)} aria-label={statusLabel(service)}>
            <i className={`status-dot status-${service.status}`} aria-hidden="true" />
            <span>{serviceStatusText(service)}</span>
          </span>
        ) : null}
        <ExternalLink className="service-open" size={16} aria-hidden="true" />
      </a>
      {service.plugin?.enabled && service.plugin.type === "beszel" ? <BeszelServicePlugin service={service} /> : null}
      {service.plugin?.enabled && service.plugin.type === "portainer" ? <PortainerServicePlugin service={service} /> : null}
      {service.plugin?.enabled && service.plugin.type === "proxmox" ? <ProxmoxServicePlugin service={service} /> : null}
      {service.plugin?.enabled && service.plugin.type === "uptime-kuma" ? <UptimeKumaServicePlugin service={service} /> : null}
      {service.plugin?.enabled && service.plugin.type === "jellyfin" ? <JellyfinServicePlugin service={service} /> : null}
      {service.plugin?.enabled && service.plugin.type === "plex" ? <PlexServicePlugin service={service} /> : null}
      {service.plugin?.enabled && service.plugin.type === "mikrotik" ? <MikrotikServicePlugin service={service} /> : null}
      {service.plugin?.enabled && (service.plugin.type === "radarr" || service.plugin.type === "sonarr") ? <ArrServicePlugin service={service} /> : null}
      {service.plugin?.enabled && service.plugin.type === "lidarr" ? <LidarrServicePlugin service={service} /> : null}
      {service.plugin?.enabled && service.plugin.type === "prowlarr" ? <ProwlarrServicePlugin service={service} /> : null}
      {service.plugin?.enabled && service.plugin.type === "bazarr" ? <BazarrServicePlugin service={service} /> : null}
      {service.plugin?.enabled && service.plugin.type === "qbittorrent" ? <QBittorrentServicePlugin service={service} /> : null}
      {service.plugin?.enabled && service.plugin.type === "nginx-proxy-manager" ? <NginxProxyManagerServicePlugin service={service} /> : null}
      {service.plugin?.enabled && service.plugin.type === "steam-wishlist" ? <SteamWishlistServicePlugin service={service} /> : null}
    </article>
  );
}

export function ServiceCardPreview({ service }: { service: DashboardService }) {
  return (
    <div
      className="service-group service-group--unknown service-group--vertical glass-panel service-card-preview"
      aria-label={`Live preview of ${service.name || "service"}`}
      onClickCapture={(event) => event.preventDefault()}
    >
      <div className="service-rail">
        <ServiceRow service={service} openInNewTab={false} />
      </div>
    </div>
  );
}

function GroupBlock({
  group,
  openInNewTab,
}: {
  group: DashboardGroup;
  openInNewTab: boolean;
}) {
  const monitored = group.services.filter((service) => service.statusCheck);
  const healthy = monitored.filter((service) => service.status === "healthy").length;
  const checking = monitored.filter((service) => service.status === "checking" || service.status === "unknown").length;
  const unhealthy = monitored.filter((service) => service.status === "unhealthy").length;
  const tone = unhealthy > 0 ? "unhealthy" : checking > 0 ? "checking" : monitored.length > 0 ? "healthy" : "unknown";
  const direction = group.direction === "vertical" ? "vertical" : "horizontal";
  const serviceCountLabel = `${group.services.length} ${group.services.length === 1 ? "service" : "services"}`;
  return (
    <section
      className={`service-group service-group--${tone} service-group--${direction}`}
      aria-labelledby={`group-${group.id}`}
    >
      <header className="service-group__header">
        <span className="service-group__icon">
          {group.icon.trim() ? (
            <ServiceIcon icon={group.icon} name={group.name} className="group-icon" />
          ) : <Container size={20} aria-hidden="true" />}
        </span>
        <span className="service-group__heading">
          <h2 id={`group-${group.id}`}>{group.name}</h2>
          <small>{serviceCountLabel}</small>
        </span>
        <span className="service-group__state">
          <i aria-hidden="true" />
          {monitored.length > 0 ? `${healthy}/${monitored.length} online` : "No checks"}
        </span>
      </header>
      <div className="service-rail">
        {group.services.map((service) => (
          <ServiceRow key={service.id} service={service} openInNewTab={openInNewTab} />
        ))}
      </div>
    </section>
  );
}

function dashboardWidgetName(widget: DashboardWidget): string {
  const configured = typeof widget.config.label === "string" ? widget.config.label.trim() : "";
  if (configured) return configured;
  if (widget.type === "server-health") return "Server health";
  if (widget.type === "service-health") return "Service health";
  if (widget.type === "media-activity") return "Now playing";
  if (widget.type === "network-traffic") return "Network traffic";
  if (widget.type === "docker") return "Docker status";
  if (widget.type === "calendar-agenda") return "Calendar agenda";
  if (widget.type === "feed-reader") return "News feed";
  if (widget.type === "custom-api") return "Custom API";
  return widget.type;
}

function gridItemStyle(
  item: DashboardGridItem,
  columnCount: number,
  preview?: { columnSpan: number; rowSpan: number },
  measuredGridRows?: number,
): React.CSSProperties {
  const columnSpan = normalizeGridColumnSpan(preview?.columnSpan ?? item.columnSpan, columnCount);
  const columnStart = normalizeGridColumnStart(item.columnStart, columnCount, columnSpan);
  const rowSpan = normalizeGridRowSpan(preview?.rowSpan ?? item.rowSpan);
  return {
    gridColumn: columnStart ? `${columnStart} / span ${columnSpan}` : `span ${columnSpan}`,
    gridRowEnd: measuredGridRows ? `span ${measuredGridRows}` : undefined,
    minHeight: rowSpan ? rowSpan * GRID_ROW_HEIGHT_PX : undefined,
  };
}

function useMeasuredGridItem(rowSpan: number) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const normalizedRows = normalizeGridRowSpan(rowSpan);
  const minimumHeight = normalizedRows ? normalizedRows * GRID_ROW_HEIGHT_PX : 0;

  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const contentHeight = Math.max(
        element.scrollHeight,
        element.firstElementChild?.scrollHeight ?? 0,
        element.getBoundingClientRect().height,
      );
      const nextHeight = Math.max(minimumHeight, contentHeight);
      setMeasuredHeight((current) => Math.abs(current - nextHeight) > 0.5 ? nextHeight : current);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const content = element.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [element, minimumHeight]);

  const height = Math.max(minimumHeight, measuredHeight);
  const gridRows = Math.max(1, Math.ceil((Math.max(1, height) + DASHBOARD_GRID_GAP_PX) / (DASHBOARD_GRID_TRACK_PX + DASHBOARD_GRID_GAP_PX)));
  return { setElement, gridRows };
}

interface DashboardGridItemFrameProps {
  item: DashboardGridItem;
  columnCount: number;
  children: React.ReactNode;
}

function DashboardGridItemFrame({ item, columnCount, children }: DashboardGridItemFrameProps) {
  const columnSpan = normalizeGridColumnSpan(item.columnSpan, columnCount);
  const columnStart = normalizeGridColumnStart(item.columnStart, columnCount, columnSpan);
  const rowSpan = normalizeGridRowSpan(item.rowSpan);
  const measurement = useMeasuredGridItem(rowSpan);
  return (
    <div
      ref={measurement.setElement}
      className={`dashboard-grid-item dashboard-grid-item--${item.kind}${rowSpan ? " dashboard-grid-item--fixed" : ""}`}
      style={gridItemStyle(item, columnCount, undefined, measurement.gridRows)}
      data-layout-item={item.id}
      data-column-start={columnStart || "auto"}
      data-column-span={columnSpan}
      data-row-span={rowSpan || "auto"}
    >
      {children}
    </div>
  );
}

interface EditableDashboardGridItemProps extends DashboardGridItemFrameProps {
  selected: boolean;
  label: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  onResize: (id: string, changes: Pick<DashboardGridItem, "columnSpan" | "rowSpan">) => void;
}

function EditableDashboardGridItem({
  item,
  columnCount,
  children,
  selected,
  label,
  disabled,
  onSelect,
  onResize,
}: EditableDashboardGridItemProps) {
  const sortable = useSortable({ id: item.id, disabled, animateLayoutChanges: () => false });
  const [resizePreview, setResizePreview] = useState<{ columnSpan: number; rowSpan: number } | undefined>();
  const resizePreviewRef = useRef<typeof resizePreview>(undefined);
  const resizeStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    cellWidth: number;
    columnSpan: number;
    rowSpan: number;
    automaticHeight: boolean;
  } | null>(null);
  const columnSpan = normalizeGridColumnSpan(resizePreview?.columnSpan ?? item.columnSpan, columnCount);
  const columnStart = normalizeGridColumnStart(item.columnStart, columnCount, columnSpan);
  const rowSpan = normalizeGridRowSpan(resizePreview?.rowSpan ?? item.rowSpan);
  const measurement = useMeasuredGridItem(rowSpan);
  const style = {
    ...gridItemStyle(item, columnCount, resizePreview, measurement.gridRows),
    transform: sortable.isDragging && sortable.transform
      ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)`
      : undefined,
    transition: "none",
  } as React.CSSProperties;

  const setPreview = (next: typeof resizePreview) => {
    resizePreviewRef.current = next;
    setResizePreview(next);
  };

  const startResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const itemElement = event.currentTarget.closest<HTMLElement>(".dashboard-grid-item");
    const gridElement = event.currentTarget.closest<HTMLElement>(".dashboard-grid");
    if (!itemElement || !gridElement) return;
    const itemRect = itemElement.getBoundingClientRect();
    const gridRect = gridElement.getBoundingClientRect();
    const gap = Number.parseFloat(window.getComputedStyle(gridElement).columnGap) || 0;
    const cellWidth = Math.max(1, (gridRect.width - gap * Math.max(0, columnCount - 1)) / columnCount);
    const savedRows = normalizeGridRowSpan(item.rowSpan);
    resizeStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      cellWidth,
      columnSpan: normalizeGridColumnSpan(item.columnSpan, columnCount),
      rowSpan: savedRows || Math.max(1, Math.min(MAX_GRID_ROW_SPAN, Math.round(itemRect.height / GRID_ROW_HEIGHT_PX))),
      automaticHeight: savedRows === AUTO_GRID_ROW_SPAN,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(item.id);
  };

  const moveResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = resizeStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaColumns = Math.round((event.clientX - start.x) / start.cellWidth);
    const deltaY = event.clientY - start.y;
    const deltaRows = Math.abs(deltaY) < GRID_ROW_HEIGHT_PX / 3 ? 0 : Math.round(deltaY / GRID_ROW_HEIGHT_PX);
    const nextColumnSpan = Math.max(1, Math.min(columnCount, MAX_GRID_COLUMN_SPAN, start.columnSpan + deltaColumns));
    const nextRowSpan = start.automaticHeight && deltaRows === 0
      ? AUTO_GRID_ROW_SPAN
      : Math.max(1, Math.min(MAX_GRID_ROW_SPAN, start.rowSpan + deltaRows));
    setPreview({ columnSpan: nextColumnSpan, rowSpan: nextRowSpan });
  };

  const finishResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = resizeStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const next = resizePreviewRef.current;
    resizeStartRef.current = null;
    setPreview(undefined);
    if (next && (next.columnSpan !== item.columnSpan || next.rowSpan !== item.rowSpan)) {
      onResize(item.id, next);
    }
  };

  return (
    <div
      ref={(node) => {
        sortable.setNodeRef(node);
        measurement.setElement(node);
      }}
      className={[
        "dashboard-grid-item",
        `dashboard-grid-item--${item.kind}`,
        rowSpan ? "dashboard-grid-item--fixed" : "",
        "dashboard-grid-item--editing",
        selected ? "dashboard-grid-item--selected" : "",
        sortable.isOver && !sortable.isDragging ? "dashboard-grid-item--drop-target" : "",
        sortable.isDragging ? "dashboard-grid-item--dragging" : "",
      ].filter(Boolean).join(" ")}
      style={style}
      data-layout-item={item.id}
      data-column-start={columnStart || "auto"}
      data-column-span={columnSpan}
      data-row-span={rowSpan || "auto"}
    >
      <div className="dashboard-grid-item__content">{children}</div>
      <div className="dashboard-grid-item__edit-controls">
        <button
          type="button"
          className="dashboard-grid-item__select"
          aria-label={`Select ${label}`}
          aria-pressed={selected}
          disabled={disabled}
          onClick={() => onSelect(item.id)}
        />
        <button
          type="button"
          className="dashboard-grid-item__drag-handle"
          aria-label={`Move ${label}`}
          title="Drag to swap position"
          disabled={disabled}
          onClick={(event) => event.stopPropagation()}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <GripVertical size={17} />
          <span>{label}</span>
        </button>
        <button
          type="button"
          className="dashboard-grid-item__resize-handle"
          aria-label={`Resize ${label}`}
          title="Drag to resize"
          disabled={disabled}
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
        >
          <Maximize2 size={15} />
        </button>
      </div>
    </div>
  );
}

function formatWidgetValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "Loading…";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 160 ? `${serialized.slice(0, 157)}…` : serialized;
  } catch {
    return "Unsupported value";
  }
}

function CustomApiWidget({ widget }: { widget: DashboardWidget }) {
  const [payload, setPayload] = useState<{ label?: string; value?: unknown; updatedAt?: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const endpoint = String(widget.config.url ?? widget.config.endpoint ?? "");
  const valuePath = String(widget.config.path ?? widget.config.valuePath ?? "");
  const configuredLabel = String(widget.config.label ?? "Custom API");

  useEffect(() => {
    let active = true;
    setPayload(null);
    setFailed(false);
    fetch(`/api/widgets/custom-api/${encodeURIComponent(widget.id)}`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((next) => { if (active) setPayload(next); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [widget.id, endpoint, valuePath, configuredLabel]);

  return (
    <div className="custom-widget glass-panel">
      <span className="custom-widget-icon"><Cloud size={18} /></span>
      <span>
        <small>{payload?.label || configuredLabel}</small>
        <strong>{failed ? "Unavailable" : formatWidgetValue(payload?.value)}</strong>
      </span>
    </div>
  );
}

type CalendarAgendaPayload = {
  label: string;
  calendarName: string;
  rangeStart: string;
  rangeEnd: string;
  events: Array<{
    id: string;
    title: string;
    start: string;
    end: string;
    allDay: boolean;
    location: string;
    url?: string;
  }>;
  hasMore: boolean;
  updatedAt: string;
};

function calendarDateLabel(event: CalendarAgendaPayload["events"][number], locale: string): string {
  const options: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
  if (event.allDay) options.timeZone = "UTC";
  try {
    return new Intl.DateTimeFormat(locale || undefined, options).format(new Date(event.start));
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(new Date(event.start));
  }
}

function calendarTimeLabel(event: CalendarAgendaPayload["events"][number], locale: string): string {
  if (event.allDay) return "All day";
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  try {
    const formatter = new Intl.DateTimeFormat(locale || undefined, options);
    return formatter.formatRange(new Date(event.start), new Date(event.end));
  } catch {
    const formatter = new Intl.DateTimeFormat(undefined, options);
    return formatter.formatRange(new Date(event.start), new Date(event.end));
  }
}

function CalendarAgendaWidget({ widget, locale }: { widget: DashboardWidget; locale: string }) {
  const [payload, setPayload] = useState<CalendarAgendaPayload | null>(null);
  const [error, setError] = useState("");
  const label = String(widget.config.label ?? "Agenda");
  const daysAhead = Number(widget.config.daysAhead ?? 14);
  const maxEvents = Number(widget.config.maxEvents ?? 8);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    setPayload(null);
    setError("");
    const load = async () => {
      try {
        const response = await fetch(`/api/widgets/calendar-agenda/${encodeURIComponent(widget.id)}`, { cache: "no-store" });
        const next = await response.json() as CalendarAgendaPayload & { error?: string };
        if (!response.ok) throw new Error(next.error || "Calendar unavailable");
        if (active) {
          setPayload(next);
          setError("");
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Calendar unavailable");
      } finally {
        if (active) timer = window.setTimeout(load, 5 * 60_000);
      }
    };
    void load();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [widget.id, label, daysAhead, maxEvents]);

  const events = payload?.events ?? [];
  const title = payload?.label || label;
  const status = error ? "Unavailable" : payload ? `${events.length}${payload.hasMore ? "+" : ""} upcoming` : "Loading";
  return (
    <section className={`calendar-agenda-card glass-panel${error ? " calendar-agenda-card--error" : ""}`} data-widget-type="calendar-agenda" aria-live="polite">
      <header className="calendar-agenda-card__header">
        <span className="calendar-agenda-card__icon"><CalendarDays size={21} /></span>
        <span className="calendar-agenda-card__heading">
          <small>{payload?.calendarName || "Calendar"}</small>
          <h2>{title}</h2>
        </span>
        <span className="calendar-agenda-card__count">{status}</span>
      </header>
      {!payload && !error ? (
        <div className="calendar-agenda-card__skeleton" aria-label="Loading upcoming events">
          {[0, 1, 2].map((item) => <span key={item}><i /><b /></span>)}
        </div>
      ) : null}
      {error && !payload ? (
        <div className="calendar-agenda-card__state">
          <CalendarDays size={23} />
          <span><strong>Calendar unavailable</strong><small>{error}</small></span>
        </div>
      ) : null}
      {payload && events.length === 0 ? (
        <div className="calendar-agenda-card__state">
          <CalendarDays size={23} />
          <span><strong>No upcoming events</strong><small>The next {daysAhead} days are clear.</small></span>
        </div>
      ) : null}
      {events.length > 0 ? (
        <div className="calendar-agenda-card__events">
          {events.map((event, index) => {
            const content = (
              <>
                <span className="calendar-agenda-event__date"><strong>{calendarDateLabel(event, locale)}</strong><small><Clock3 size={11} />{calendarTimeLabel(event, locale)}</small></span>
                <i className="calendar-agenda-event__marker" aria-hidden="true" />
                <span className="calendar-agenda-event__content"><strong>{event.title}</strong>{event.location ? <small><MapPin size={11} />{event.location}</small> : <small>Upcoming event</small>}</span>
                {event.url ? <ExternalLink className="calendar-agenda-event__open" size={14} aria-hidden="true" /> : null}
              </>
            );
            return event.url ? (
              <a className={`calendar-agenda-event${index === 0 ? " calendar-agenda-event--next" : ""}`} href={event.url} target="_blank" rel="noreferrer" key={event.id}>{content}</a>
            ) : (
              <article className={`calendar-agenda-event${index === 0 ? " calendar-agenda-event--next" : ""}`} key={event.id}>{content}</article>
            );
          })}
        </div>
      ) : null}
      {payload?.hasMore ? <footer>More events are available in this calendar</footer> : null}
    </section>
  );
}

type FeedReaderPayload = {
  label: string;
  mode: "articles" | "releases";
  feedTitle: string;
  homeUrl?: string;
  items: Array<{
    id: string;
    title: string;
    summary: string;
    url?: string;
    imageUrl?: string;
    author: string;
    publishedAt?: string;
    version?: string;
  }>;
  hasMore: boolean;
  updatedAt: string;
};

function feedDateLabel(value: string | undefined, locale: string): string {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  const dayDifference = Math.round((date.getTime() - Date.now()) / (24 * 60 * 60 * 1_000));
  try {
    if (Math.abs(dayDifference) <= 6) {
      return new Intl.RelativeTimeFormat(locale || undefined, { numeric: "auto" }).format(dayDifference, "day");
    }
    return new Intl.DateTimeFormat(locale || undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  }
}

function FeedReaderWidget({ widget, locale }: { widget: DashboardWidget; locale: string }) {
  const [payload, setPayload] = useState<FeedReaderPayload | null>(null);
  const [error, setError] = useState("");
  const label = String(widget.config.label ?? "Latest news");
  const mode = widget.config.mode === "releases" ? "releases" : "articles";
  const maxItems = Number(widget.config.maxItems ?? 6);
  const maxAgeDays = Number(widget.config.maxAgeDays ?? 30);
  const showImages = widget.config.showImages !== false;

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    setPayload(null);
    setError("");
    const load = async () => {
      try {
        const response = await fetch(`/api/widgets/feed-reader/${encodeURIComponent(widget.id)}`, { cache: "no-store" });
        const next = await response.json() as FeedReaderPayload & { error?: string };
        if (!response.ok) throw new Error(next.error || "Feed unavailable");
        if (active) {
          setPayload(next);
          setError("");
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Feed unavailable");
      } finally {
        if (active) timer = window.setTimeout(load, 10 * 60_000);
      }
    };
    void load();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [widget.id, label, mode, maxItems, maxAgeDays, showImages]);

  const items = payload?.items ?? [];
  const displayMode = payload?.mode ?? mode;
  const title = payload?.label || label;
  const status = error ? "Unavailable" : payload ? `${items.length}${payload.hasMore ? "+" : ""} ${displayMode === "releases" ? "releases" : "stories"}` : "Loading";
  const HeaderIcon = displayMode === "releases" ? Rocket : Rss;
  return (
    <section className={`feed-reader-card feed-reader-card--${displayMode} glass-panel${error ? " feed-reader-card--error" : ""}`} data-widget-type="feed-reader" aria-live="polite">
      <header className="feed-reader-card__header">
        <span className="feed-reader-card__icon"><HeaderIcon size={21} /></span>
        <span className="feed-reader-card__heading">
          <small>{payload?.feedTitle || (displayMode === "releases" ? "Release feed" : "RSS & Atom")}</small>
          <h2>{title}</h2>
        </span>
        <span className="feed-reader-card__count">{status}</span>
      </header>
      {!payload && !error ? (
        <div className="feed-reader-card__skeleton" aria-label="Loading feed items">
          {[0, 1, 2].map((item) => <span key={item}><i /><b /></span>)}
        </div>
      ) : null}
      {error && !payload ? (
        <div className="feed-reader-card__state">
          <HeaderIcon size={23} />
          <span><strong>Feed unavailable</strong><small>{error}</small></span>
        </div>
      ) : null}
      {payload && items.length === 0 ? (
        <div className="feed-reader-card__state">
          <HeaderIcon size={23} />
          <span><strong>No recent {displayMode === "releases" ? "releases" : "stories"}</strong><small>{maxAgeDays > 0 ? `Nothing was published in the last ${maxAgeDays} days.` : "The feed does not contain any items yet."}</small></span>
        </div>
      ) : null}
      {items.length > 0 ? (
        <div className="feed-reader-card__items">
          {items.map((item, index) => {
            const content = (
              <>
                <span className="feed-reader-item__art" aria-hidden="true">
                  {displayMode === "releases" ? <Rocket size={18} /> : <Rss size={18} />}
                  {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; }} /> : null}
                </span>
                <span className="feed-reader-item__copy">
                  <span className="feed-reader-item__meta">
                    {displayMode === "releases" && item.version ? <strong>{item.version}</strong> : null}
                    <small>{[item.author, feedDateLabel(item.publishedAt, locale)].filter(Boolean).join(" · ")}</small>
                  </span>
                  <b>{item.title}</b>
                  {item.summary ? <p>{item.summary}</p> : null}
                </span>
                {item.url ? <ExternalLink className="feed-reader-item__open" size={14} aria-hidden="true" /> : null}
              </>
            );
            const className = `feed-reader-item${index === 0 ? " feed-reader-item--featured" : ""}`;
            return item.url ? <a className={className} href={item.url} target="_blank" rel="noreferrer" key={item.id}>{content}</a> : <article className={className} key={item.id}>{content}</article>;
          })}
        </div>
      ) : null}
      {payload?.hasMore || payload?.homeUrl ? (
        <footer>
          <span>{payload.hasMore ? "More items are available" : "Source feed"}</span>
          {payload.homeUrl ? <a href={payload.homeUrl} target="_blank" rel="noreferrer">Open source <ExternalLink size={11} /></a> : null}
        </footer>
      ) : null}
    </section>
  );
}

function DockerStatusWidget({ widget, groups }: { widget: DashboardWidget; groups: DashboardGroup[] }) {
  const services = groups
    .flatMap((group) => group.services)
    .filter((service) => service.statusCheck && Boolean(service.dockerServer));
  const healthy = services.filter((service) => service.status === "healthy").length;
  const unhealthy = services.filter((service) => service.status === "unhealthy").length;
  const checking = services.filter((service) => service.status === "checking" || service.status === "unknown").length;
  const detailed = widget.config.display === "detailed";
  const value = services.length === 0
    ? "No monitored containers"
    : detailed
      ? `${healthy} up · ${unhealthy} down · ${checking} pending`
      : `${healthy}/${services.length} online`;

  return (
    <div className="custom-widget docker-status-widget glass-panel">
      <span className="custom-widget-icon"><Container size={18} /></span>
      <span>
        <small>Docker status</small>
        <strong>{value}</strong>
      </span>
    </div>
  );
}

type BeszelPayload =
  | { mode: "overview"; systems: number; up: number }
  | { mode: "system"; system: { name: string; status: string; cpu: number; memory: number; disk: number; network: number } };

function percent(value: number): string {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`;
}

function byteRate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value / 1024 ** index)} ${units[index]}`;
}

function bitRate(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
  if (value < 1_000) return `${Math.round(value)} bit/s`;
  const units = ["kbit/s", "Mbit/s", "Gbit/s", "Tbit/s"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1_000)) - 1, units.length - 1);
  const amount = value / 1_000 ** (exponent + 1);
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: amount >= 100 ? 0 : 1 }).format(amount)} ${units[exponent]}`;
}

function byteSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** exponent;
  return `${amount >= 100 || exponent === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[exponent]}`;
}

function useBeszelPayload(id: string, endpoint: string, systemId: string, route: "service" | "widget") {
  const [payload, setPayload] = useState<BeszelPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const path = route === "service"
          ? `/api/services/${encodeURIComponent(id)}/plugin`
          : `/api/widgets/beszel/${encodeURIComponent(id)}`;
        const response = await fetch(path);
        if (!response.ok) throw new Error();
        const next = await response.json() as BeszelPayload;
        if (active) {
          setPayload(next);
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        if (active) timer = window.setTimeout(load, 30_000);
      }
    };
    void load();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [id, endpoint, systemId, route]);

  return { payload, failed };
}

function BeszelServicePlugin({ service }: { service: DashboardService }) {
  const plugin = service.plugin;
  const endpoint = String(plugin?.config.url ?? "");
  const systemId = String(plugin?.config.systemId ?? "");
  const { payload, failed } = useBeszelPayload(service.id, endpoint, systemId, "service");
  const summary = payload?.mode === "overview"
    ? `${payload.up}/${payload.systems} systems online`
    : payload?.mode === "system"
      ? `CPU ${percent(payload.system.cpu)} · RAM ${percent(payload.system.memory)} · Disk ${percent(payload.system.disk)}`
      : failed ? "Beszel unavailable" : "Loading Beszel metrics…";

  if (plugin?.presentation === "summary") {
    return <div className={`service-plugin-summary ${failed ? "service-plugin-summary--error" : ""}`}><Activity size={13} /><span>{summary}</span></div>;
  }

  const metrics = payload?.mode === "system"
    ? [["Status", payload.system.status], ["CPU", percent(payload.system.cpu)], ["Memory", percent(payload.system.memory)], ["Disk", percent(payload.system.disk)]]
    : payload?.mode === "overview"
      ? [["Systems", String(payload.systems)], ["Online", `${payload.up} / ${payload.systems}`]]
      : [];

  return (
    <div className={`service-plugin-panel ${failed ? "service-plugin-panel--error" : ""}`}>
      {metrics.length ? (
        <div className="service-plugin-panel__metrics">
          {metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}
        </div>
      ) : <span className="service-plugin-panel__state"><Activity size={14} />{summary}</span>}
      {payload?.mode === "system" && payload.system.network > 0 ? <small className="service-plugin-panel__network">Network {byteRate(payload.system.network)}</small> : null}
    </div>
  );
}

type PortainerPayload =
  | {
      mode: "overview";
      endpoints: number;
      online: number;
      inspected: number;
      containers: { total: number; running: number; healthy: number; stopped: number };
      stacks: number;
    }
  | {
      mode: "endpoint";
      endpoint: { name: string; status: string };
      containers: { total: number; running: number; healthy: number; stopped: number };
      stacks: number;
    };

function usePortainerPayload(id: string, endpoint: string, endpointId: string) {
  const [payload, setPayload] = useState<PortainerPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const response = await fetch(`/api/services/${encodeURIComponent(id)}/plugin`);
        if (!response.ok) throw new Error();
        const next = await response.json() as PortainerPayload;
        if (active) {
          setPayload(next);
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        if (active) timer = window.setTimeout(load, 30_000);
      }
    };
    void load();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [id, endpoint, endpointId]);

  return { payload, failed };
}

function PortainerServicePlugin({ service }: { service: DashboardService }) {
  const plugin = service.plugin;
  const endpoint = String(plugin?.config.url ?? "");
  const endpointId = String(plugin?.config.endpointId ?? "");
  const { payload, failed } = usePortainerPayload(service.id, endpoint, endpointId);
  const summary = payload?.mode === "overview"
    ? `${payload.online}/${payload.endpoints} environments online`
    : payload?.mode === "endpoint"
      ? `${payload.containers.running}/${payload.containers.total} containers running · ${payload.stacks} stacks`
      : failed ? "Portainer unavailable" : "Loading Portainer data…";

  if (plugin?.presentation === "summary") {
    return <div className={`service-plugin-summary ${failed ? "service-plugin-summary--error" : ""}`}><Container size={13} /><span>{summary}</span></div>;
  }

  const metrics = payload?.mode === "endpoint"
    ? [
        ["Status", payload.endpoint.status],
        ["Containers", `${payload.containers.running} / ${payload.containers.total}`],
        ["Healthy", String(payload.containers.healthy)],
        ["Stacks", String(payload.stacks)],
      ]
    : payload?.mode === "overview"
      ? [
          ["Environments", `${payload.online} / ${payload.endpoints}`],
          ["Containers", `${payload.containers.running} / ${payload.containers.total}`],
          ["Healthy", String(payload.containers.healthy)],
          ["Stacks", String(payload.stacks)],
        ]
      : [];

  const overviewNotes = payload?.mode === "overview"
    ? [
        payload.containers.stopped > 0 ? `${payload.containers.stopped} stopped` : "",
        payload.inspected < payload.online ? `${payload.online - payload.inspected} environment${payload.online - payload.inspected === 1 ? "" : "s"} unavailable` : "",
      ].filter(Boolean).join(" · ")
    : "";

  return (
    <div className={`service-plugin-panel ${failed ? "service-plugin-panel--error" : ""}`}>
      {metrics.length ? (
        <div className="service-plugin-panel__metrics">
          {metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}
        </div>
      ) : <span className="service-plugin-panel__state"><Container size={14} />{summary}</span>}
      {payload?.mode === "endpoint" && payload.containers.stopped > 0 ? <small className="service-plugin-panel__network">Stopped containers {payload.containers.stopped}</small> : null}
      {overviewNotes ? <small className="service-plugin-panel__network">{overviewNotes}</small> : null}
    </div>
  );
}

type JellyfinPayload = {
  server: { name: string; version: string; operatingSystem: string; pendingRestart: boolean };
  sessions: { connected: number; playing: number; paused: number; transcoding: number };
  library: { movies: number; series: number; episodes: number; songs: number };
};

function useJellyfinPayload(id: string, endpoint: string) {
  const [payload, setPayload] = useState<JellyfinPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const response = await fetch(`/api/services/${encodeURIComponent(id)}/plugin`);
        if (!response.ok) throw new Error();
        const next = await response.json() as JellyfinPayload;
        if (active) {
          setPayload(next);
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        if (active) timer = window.setTimeout(load, 30_000);
      }
    };
    void load();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [id, endpoint]);

  return { payload, failed };
}

function JellyfinServicePlugin({ service }: { service: DashboardService }) {
  const plugin = service.plugin;
  const endpoint = String(plugin?.config.url ?? "");
  const { payload, failed } = useJellyfinPayload(service.id, endpoint);
  const summary = payload
    ? `${payload.sessions.playing} playing · ${payload.library.movies} movies · ${payload.library.series} series`
    : failed ? "Jellyfin unavailable" : "Loading Jellyfin data…";

  if (plugin?.presentation === "summary") {
    return <div className={`service-plugin-summary ${failed ? "service-plugin-summary--error" : ""}`}><Film size={13} /><span>{summary}</span></div>;
  }

  const metrics = payload ? [
    ["Playing", String(payload.sessions.playing)],
    ["Movies", String(payload.library.movies)],
    ["Series", String(payload.library.series)],
    ["Episodes", String(payload.library.episodes)],
  ] : [];
  const details = payload ? [
    payload.server.name,
    payload.server.version ? `v${payload.server.version}` : "",
    payload.sessions.connected > 0 ? `${payload.sessions.connected} connected` : "",
    payload.sessions.paused > 0 ? `${payload.sessions.paused} paused` : "",
    payload.sessions.transcoding > 0 ? `${payload.sessions.transcoding} transcoding` : "",
    payload.server.pendingRestart ? "restart pending" : "",
  ].filter(Boolean).join(" · ") : "";

  return (
    <div className={`service-plugin-panel ${failed ? "service-plugin-panel--error" : ""}`}>
      {metrics.length ? (
        <div className="service-plugin-panel__metrics">
          {metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}
        </div>
      ) : <span className="service-plugin-panel__state"><Film size={14} />{summary}</span>}
      {details ? <small className="service-plugin-panel__network">{details}</small> : null}
    </div>
  );
}

type ArrPayload = {
  provider: "radarr" | "sonarr";
  server: { name: string; version: string };
  queue: number;
  wanted: number;
  library: { items: number; monitored: number; files: number; episodes: number };
};

function useArrPayload(id: string, endpoint: string, provider: "radarr" | "sonarr") {
  const [payload, setPayload] = useState<ArrPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const response = await fetch(`/api/services/${encodeURIComponent(id)}/plugin`);
        if (!response.ok) throw new Error();
        const next = await response.json() as ArrPayload;
        if (active) {
          setPayload(next);
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        if (active) timer = window.setTimeout(load, 30_000);
      }
    };
    void load();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [id, endpoint, provider]);

  return { payload, failed };
}

function ArrServicePlugin({ service }: { service: DashboardService }) {
  const plugin = service.plugin;
  const provider = plugin?.type === "sonarr" ? "sonarr" : "radarr";
  const name = provider === "radarr" ? "Radarr" : "Sonarr";
  const itemLabel = provider === "radarr" ? "movies" : "series";
  const endpoint = String(plugin?.config.url ?? "");
  const { payload, failed } = useArrPayload(service.id, endpoint, provider);
  const summary = payload
    ? `${payload.wanted} wanted · ${payload.queue} queued · ${payload.library.items} ${itemLabel}`
    : failed ? `${name} unavailable` : `Loading ${name} data…`;
  const Icon = provider === "radarr" ? Film : Tv;

  if (plugin?.presentation === "summary") {
    return <div className={`service-plugin-summary ${failed ? "service-plugin-summary--error" : ""}`}><Icon size={13} /><span>{summary}</span></div>;
  }

  const metrics = payload ? [
    ["Wanted", String(payload.wanted)],
    ["Queued", String(payload.queue)],
    [provider === "radarr" ? "Movies" : "Series", String(payload.library.items)],
    [provider === "radarr" ? "Downloaded" : "Episodes", String(provider === "radarr" ? payload.library.files : payload.library.episodes)],
  ] : [];
  const details = payload ? [
    payload.server.name,
    payload.server.version ? `v${payload.server.version}` : "",
    `${payload.library.monitored} monitored`,
    provider === "sonarr" ? `${payload.library.files} episode files` : "",
  ].filter(Boolean).join(" · ") : "";

  return (
    <div className={`service-plugin-panel ${failed ? "service-plugin-panel--error" : ""}`}>
      {metrics.length ? (
        <div className="service-plugin-panel__metrics">
          {metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}
        </div>
      ) : <span className="service-plugin-panel__state"><Icon size={14} />{summary}</span>}
      {details ? <small className="service-plugin-panel__network">{details}</small> : null}
    </div>
  );
}

function useServicePluginPayload<T>(id: string, endpoint: string, provider: string) {
  const [payload, setPayload] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const response = await fetch(`/api/services/${encodeURIComponent(id)}/plugin`);
        if (!response.ok) throw new Error();
        const next = await response.json() as T;
        if (active) { setPayload(next); setFailed(false); }
      } catch { if (active) setFailed(true); }
      finally { if (active) timer = window.setTimeout(load, 30_000); }
    };
    void load();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [id, endpoint, provider]);
  return { payload, failed };
}

type LidarrPayload = {
  server: { name: string; version: string };
  queue: number;
  wanted: number;
  library: {
    artists: number;
    monitoredArtists: number;
    albums: number;
    tracks: number;
    trackFiles: number;
  };
};

function LidarrServicePlugin({ service }: { service: DashboardService }) {
  const plugin = service.plugin;
  const endpoint = String(plugin?.config.url ?? "");
  const { payload, failed } = useServicePluginPayload<LidarrPayload>(service.id, endpoint, "lidarr");
  const summary = payload
    ? `${payload.wanted} wanted · ${payload.queue} queued · ${payload.library.artists} artists · ${payload.library.albums} albums`
    : failed ? "Lidarr unavailable" : "Loading Lidarr data…";
  if (plugin?.presentation === "summary") {
    return <div className={`service-plugin-summary ${failed ? "service-plugin-summary--error" : ""}`}><Disc3 size={13} /><span>{summary}</span></div>;
  }
  const metrics = payload ? [
    ["Wanted", String(payload.wanted)],
    ["Queued", String(payload.queue)],
    ["Artists", String(payload.library.artists)],
    ["Albums", String(payload.library.albums)],
  ] : [];
  const details = payload ? [
    payload.server.name,
    payload.server.version ? `v${payload.server.version}` : "",
    `${payload.library.monitoredArtists} monitored artists`,
    `${payload.library.trackFiles} / ${payload.library.tracks} tracks downloaded`,
  ].filter(Boolean).join(" · ") : "";

  return (
    <div className={`service-plugin-panel ${failed ? "service-plugin-panel--error" : ""}`}>
      {metrics.length ? (
        <div className="service-plugin-panel__metrics">
          {metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}
        </div>
      ) : <span className="service-plugin-panel__state"><Disc3 size={14} />{summary}</span>}
      {details ? <small className="service-plugin-panel__network">{details}</small> : null}
    </div>
  );
}

type ProxmoxPayload = {
  cluster: { name: string; version: string };
  scope: { node: string };
  nodes: { total: number; online: number; offline: number };
  guests: { total: number; running: number; stopped: number; virtualMachines: number; containers: number };
  resources: {
    cpuUsedPercent: number;
    memoryUsed: number;
    memoryTotal: number;
    memoryUsedPercent: number;
    storageUsed: number;
    storageTotal: number;
    storageUsedPercent: number;
  };
};

function ProxmoxServicePlugin({ service }: { service: DashboardService }) {
  const plugin = service.plugin;
  const endpoint = `${String(plugin?.config.url ?? "")}\u0000${String(plugin?.config.node ?? "")}`;
  const { payload, failed } = useServicePluginPayload<ProxmoxPayload>(service.id, endpoint, "proxmox");
  const summary = payload
    ? `${payload.nodes.online}/${payload.nodes.total} nodes · ${payload.guests.running}/${payload.guests.total} guests · CPU ${percent(payload.resources.cpuUsedPercent)} · RAM ${percent(payload.resources.memoryUsedPercent)}`
    : failed ? "Proxmox unavailable" : "Loading Proxmox data…";
  if (plugin?.presentation === "summary") {
    return <div className={`service-plugin-summary ${failed ? "service-plugin-summary--error" : ""}`}><Cpu size={13} /><span>{summary}</span></div>;
  }
  const metrics = payload ? [
    ["Nodes", `${payload.nodes.online} / ${payload.nodes.total}`],
    ["Guests", `${payload.guests.running} / ${payload.guests.total}`],
    ["CPU", percent(payload.resources.cpuUsedPercent)],
    ["Memory", percent(payload.resources.memoryUsedPercent)],
  ] : [];
  const details = payload ? [
    payload.scope.node || payload.cluster.name,
    payload.cluster.version ? `PVE ${payload.cluster.version}` : "",
    `${payload.guests.virtualMachines} VMs`,
    `${payload.guests.containers} containers`,
    payload.guests.stopped > 0 ? `${payload.guests.stopped} stopped` : "all guests running",
    `storage ${percent(payload.resources.storageUsedPercent)} (${byteSize(payload.resources.storageUsed)} / ${byteSize(payload.resources.storageTotal)})`,
    payload.nodes.offline > 0 ? `${payload.nodes.offline} nodes offline` : "",
  ].filter(Boolean).join(" · ") : "";
  return <div className={`service-plugin-panel ${failed ? "service-plugin-panel--error" : ""}`}>
    {metrics.length ? <div className="service-plugin-panel__metrics">{metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div> : <span className="service-plugin-panel__state"><Cpu size={14} />{summary}</span>}
    {details ? <small className="service-plugin-panel__network">{details}</small> : null}
  </div>;
}

type UptimeKumaPayload = {
  scope: { monitorId: string };
  monitors: { total: number; up: number; down: number; pending: number; maintenance: number; unknown: number };
  monitor?: {
    id: string;
    name: string;
    type: string;
    status: "up" | "down" | "pending" | "maintenance" | "unknown";
    responseTime: number | null;
    certificateDaysRemaining: number | null;
  };
};

function UptimeKumaServicePlugin({ service }: { service: DashboardService }) {
  const plugin = service.plugin;
  const endpoint = `${String(plugin?.config.url ?? "")}\u0000${String(plugin?.config.monitorId ?? "")}`;
  const { payload, failed } = useServicePluginPayload<UptimeKumaPayload>(service.id, endpoint, "uptime-kuma");
  const degraded = Boolean(payload && (payload.monitor ? payload.monitor.status === "down" : payload.monitors.down > 0));
  const summary = payload
    ? payload.monitor
      ? `${payload.monitor.name} · ${payload.monitor.status}${payload.monitor.responseTime === null ? "" : ` · ${payload.monitor.responseTime} ms`}`
      : `${payload.monitors.up}/${payload.monitors.total} monitors up${payload.monitors.down ? ` · ${payload.monitors.down} down` : ""}`
    : failed ? "Uptime Kuma unavailable" : "Loading Uptime Kuma data…";
  if (plugin?.presentation === "summary") {
    return <div className={`service-plugin-summary ${failed || degraded ? "service-plugin-summary--error" : ""}`}><Activity size={13} /><span>{summary}</span></div>;
  }
  const metrics = payload ? payload.monitor ? [
    ["Status", payload.monitor.status],
    ["Response", payload.monitor.responseTime === null ? "—" : `${payload.monitor.responseTime} ms`],
    ["Type", payload.monitor.type],
    ["Certificate", payload.monitor.certificateDaysRemaining === null ? "—" : `${payload.monitor.certificateDaysRemaining} days`],
  ] : [
    ["Up", `${payload.monitors.up} / ${payload.monitors.total}`],
    ["Down", String(payload.monitors.down)],
    ["Pending", String(payload.monitors.pending)],
    ["Maintenance", String(payload.monitors.maintenance)],
  ] : [];
  const details = payload
    ? payload.monitor
      ? payload.monitor.name
      : `${payload.monitors.total} monitors${payload.monitors.unknown ? ` · ${payload.monitors.unknown} unknown` : ""}`
    : "";
  return <div className={`service-plugin-panel ${failed || degraded ? "service-plugin-panel--error" : ""}`}>
    {metrics.length ? <div className="service-plugin-panel__metrics">{metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div> : <span className="service-plugin-panel__state"><Activity size={14} />{summary}</span>}
    {details ? <small className="service-plugin-panel__network">{details}</small> : null}
  </div>;
}

type PlexPayload = {
  server: { name: string; version: string; platform: string };
  sessions: { total: number; playing: number; paused: number; transcoding: number };
  library: { movies: number; shows: number; albums: number };
};

function PlexServicePlugin({ service }: { service: DashboardService }) {
  const plugin = service.plugin;
  const endpoint = String(plugin?.config.url ?? "");
  const { payload, failed } = useServicePluginPayload<PlexPayload>(service.id, endpoint, "plex");
  const summary = payload
    ? `${payload.sessions.playing} playing · ${payload.library.movies} movies · ${payload.library.shows} shows`
    : failed ? "Plex unavailable" : "Loading Plex data…";
  if (plugin?.presentation === "summary") {
    return <div className={`service-plugin-summary ${failed ? "service-plugin-summary--error" : ""}`}><Play size={13} /><span>{summary}</span></div>;
  }
  const metrics = payload ? [
    ["Streams", `${payload.sessions.playing} / ${payload.sessions.total}`],
    ["Transcoding", String(payload.sessions.transcoding)],
    ["Movies", String(payload.library.movies)],
    ["Shows", String(payload.library.shows)],
  ] : [];
  const details = payload ? [
    payload.server.name,
    payload.server.version ? `v${payload.server.version}` : "",
    payload.server.platform,
    payload.sessions.paused > 0 ? `${payload.sessions.paused} paused` : "",
    `${payload.library.albums} albums`,
  ].filter(Boolean).join(" · ") : "";
  return <div className={`service-plugin-panel ${failed ? "service-plugin-panel--error" : ""}`}>
    {metrics.length ? <div className="service-plugin-panel__metrics">{metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div> : <span className="service-plugin-panel__state"><Play size={14} />{summary}</span>}
    {details ? <small className="service-plugin-panel__network">{details}</small> : null}
  </div>;
}

type MikrotikPayload = {
  router: { name: string; boardName: string; platform: string; version: string; architecture: string };
  system: {
    uptime: string;
    cpuLoad: number;
    cpuCount: number;
    memoryUsedPercent: number;
    storageUsedPercent: number;
  };
  dhcp: { leases: number; active: number };
  interfaces: { total: number; running: number; disabled: number };
  traffic: {
    interfaceName: string;
    interfaceType: string;
    running: boolean;
    status: "unconfigured" | "warming-up" | "ready" | "unavailable";
    downloadBitsPerSecond: number | null;
    uploadBitsPerSecond: number | null;
    samples: Array<{ at: string; downloadBitsPerSecond: number; uploadBitsPerSecond: number }>;
    maxSamples: number;
    sampleIntervalSeconds: number;
  };
  updatedAt: string;
};

function MikrotikServicePlugin({ service }: { service: DashboardService }) {
  const plugin = service.plugin;
  const endpoint = String(plugin?.config.url ?? "");
  const { payload, failed } = useServicePluginPayload<MikrotikPayload>(service.id, endpoint, "mikrotik");
  const trafficSummary = payload?.traffic.status === "ready"
    ? ` · ↓ ${bitRate(payload.traffic.downloadBitsPerSecond)} · ↑ ${bitRate(payload.traffic.uploadBitsPerSecond)}`
    : "";
  const summary = payload
    ? `CPU ${percent(payload.system.cpuLoad)} · RAM ${percent(payload.system.memoryUsedPercent)} · ${payload.dhcp.active} leases · ${payload.system.uptime}${trafficSummary}`
    : failed ? "MikroTik unavailable" : "Loading MikroTik data…";
  if (plugin?.presentation === "summary") {
    return <div className={`service-plugin-summary ${failed ? "service-plugin-summary--error" : ""}`}><Router size={13} /><span>{summary}</span></div>;
  }
  const metrics = payload ? [
    ["Uptime", payload.system.uptime || "—"],
    ["CPU", percent(payload.system.cpuLoad)],
    ["Memory", percent(payload.system.memoryUsedPercent)],
    ["Interfaces", `${payload.interfaces.running} / ${payload.interfaces.total}`],
  ] : [];
  const details = payload ? [
    payload.router.name,
    payload.router.boardName,
    payload.router.version ? `RouterOS ${payload.router.version}` : "",
    payload.router.architecture,
    `${payload.dhcp.active}/${payload.dhcp.leases} active leases`,
    payload.traffic.status === "ready" ? `${payload.traffic.interfaceName} ↓ ${bitRate(payload.traffic.downloadBitsPerSecond)} ↑ ${bitRate(payload.traffic.uploadBitsPerSecond)}` : "",
    `storage ${percent(payload.system.storageUsedPercent)}`,
    payload.interfaces.disabled > 0 ? `${payload.interfaces.disabled} interfaces disabled` : "",
  ].filter(Boolean).join(" · ") : "";
  return <div className={`service-plugin-panel ${failed ? "service-plugin-panel--error" : ""}`}>
    {metrics.length ? <div className="service-plugin-panel__metrics">{metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div> : <span className="service-plugin-panel__state"><Router size={14} />{summary}</span>}
    {details ? <small className="service-plugin-panel__network">{details}</small> : null}
  </div>;
}

type ProwlarrPayload = { indexers: number; queries: number; grabs: number; failedQueries: number; failedGrabs: number };

function ProwlarrServicePlugin({ service }: { service: DashboardService }) {
  const plugin = service.plugin;
  const endpoint = String(plugin?.config.url ?? "");
  const { payload, failed } = useServicePluginPayload<ProwlarrPayload>(service.id, endpoint, "prowlarr");
  const failures = payload ? payload.failedQueries + payload.failedGrabs : 0;
  const summary = payload ? `${payload.grabs} grabs · ${payload.queries} queries · ${payload.indexers} indexers` : failed ? "Prowlarr unavailable" : "Loading Prowlarr data…";
  if (plugin?.presentation === "summary") return <div className={`service-plugin-summary ${failed ? "service-plugin-summary--error" : ""}`}><Search size={13} /><span>{summary}</span></div>;
  const metrics = payload ? [["Indexers", String(payload.indexers)], ["Grabs", String(payload.grabs)], ["Queries", String(payload.queries)], ["Failed", String(failures)]] : [];
  return <div className={`service-plugin-panel ${failed ? "service-plugin-panel--error" : ""}`}>
    {metrics.length ? <div className="service-plugin-panel__metrics">{metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div> : <span className="service-plugin-panel__state"><Search size={14} />{summary}</span>}
    {payload && failures > 0 ? <small className="service-plugin-panel__network">{payload.failedGrabs} failed grabs · {payload.failedQueries} failed queries</small> : null}
  </div>;
}

type BazarrPayload = { missingEpisodes: number; missingMovies: number };

function BazarrServicePlugin({ service }: { service: DashboardService }) {
  const plugin = service.plugin;
  const endpoint = String(plugin?.config.url ?? "");
  const { payload, failed } = useServicePluginPayload<BazarrPayload>(service.id, endpoint, "bazarr");
  const summary = payload ? `${payload.missingEpisodes} episodes · ${payload.missingMovies} movies missing subtitles` : failed ? "Bazarr unavailable" : "Loading Bazarr data…";
  if (plugin?.presentation === "summary") return <div className={`service-plugin-summary ${failed ? "service-plugin-summary--error" : ""}`}><Captions size={13} /><span>{summary}</span></div>;
  const metrics = payload ? [["Episodes", String(payload.missingEpisodes)], ["Movies", String(payload.missingMovies)], ["Missing", String(payload.missingEpisodes + payload.missingMovies)]] : [];
  return <div className={`service-plugin-panel ${failed ? "service-plugin-panel--error" : ""}`}>
    {metrics.length ? <div className="service-plugin-panel__metrics">{metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div> : <span className="service-plugin-panel__state"><Captions size={14} />{summary}</span>}
  </div>;
}

type QBittorrentPayload = { version: string; connectionStatus: string; downloadSpeed: number; uploadSpeed: number; torrents: { total: number; active: number; downloading: number; seeding: number; paused: number; errored: number } };

function QBittorrentServicePlugin({ service }: { service: DashboardService }) {
  const plugin = service.plugin;
  const endpoint = String(plugin?.config.url ?? "");
  const { payload, failed } = useServicePluginPayload<QBittorrentPayload>(service.id, endpoint, "qbittorrent");
  const summary = payload ? `↓ ${byteRate(payload.downloadSpeed)} · ↑ ${byteRate(payload.uploadSpeed)} · ${payload.torrents.active}/${payload.torrents.total} active` : failed ? "qBittorrent unavailable" : "Loading qBittorrent data…";
  if (plugin?.presentation === "summary") return <div className={`service-plugin-summary ${failed ? "service-plugin-summary--error" : ""}`}><Download size={13} /><span>{summary}</span></div>;
  const metrics = payload ? [["Download", byteRate(payload.downloadSpeed)], ["Upload", byteRate(payload.uploadSpeed)], ["Active", `${payload.torrents.active} / ${payload.torrents.total}`], ["Errors", String(payload.torrents.errored)]] : [];
  const details = payload ? [`${payload.torrents.downloading} downloading`, `${payload.torrents.seeding} seeding`, `${payload.torrents.paused} paused`, payload.version, payload.connectionStatus].filter(Boolean).join(" · ") : "";
  return <div className={`service-plugin-panel ${failed ? "service-plugin-panel--error" : ""}`}>
    {metrics.length ? <div className="service-plugin-panel__metrics">{metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div> : <span className="service-plugin-panel__state"><Download size={14} />{summary}</span>}
    {details ? <small className="service-plugin-panel__network">{details}</small> : null}
  </div>;
}

type NginxProxyManagerPayload = {
  proxyHosts: { total: number; enabled: number; online: number; offline: number; withSsl: number };
  redirectionHosts: { total: number; enabled: number; online: number };
  deadHosts: { total: number; enabled: number; online: number };
  streams: { total: number; enabled: number; online: number };
};

function NginxProxyManagerServicePlugin({ service }: { service: DashboardService }) {
  const plugin = service.plugin;
  const endpoint = String(plugin?.config.url ?? "");
  const { payload, failed } = useServicePluginPayload<NginxProxyManagerPayload>(service.id, endpoint, "nginx-proxy-manager");
  const summary = payload
    ? `${payload.proxyHosts.online}/${payload.proxyHosts.enabled} proxy hosts online · ${payload.proxyHosts.withSsl} SSL`
    : failed ? "Nginx Proxy Manager unavailable" : "Loading Nginx Proxy Manager data…";
  if (plugin?.presentation === "summary") {
    return <div className={`service-plugin-summary ${failed ? "service-plugin-summary--error" : ""}`}><ShieldCheck size={13} /><span>{summary}</span></div>;
  }
  const metrics = payload ? [
    ["Proxy hosts", `${payload.proxyHosts.online} / ${payload.proxyHosts.enabled}`],
    ["SSL", String(payload.proxyHosts.withSsl)],
    ["Redirects", `${payload.redirectionHosts.enabled} / ${payload.redirectionHosts.total}`],
    ["Streams", `${payload.streams.enabled} / ${payload.streams.total}`],
  ] : [];
  const details = payload ? [
    payload.proxyHosts.offline > 0 ? `${payload.proxyHosts.offline} proxy hosts offline` : "all enabled proxy hosts online",
    `${payload.redirectionHosts.online}/${payload.redirectionHosts.enabled} redirects online`,
    `${payload.streams.online}/${payload.streams.enabled} streams online`,
    `${payload.deadHosts.enabled} 404 hosts`,
  ].join(" · ") : "";
  return <div className={`service-plugin-panel ${failed ? "service-plugin-panel--error" : ""}`}>
    {metrics.length ? <div className="service-plugin-panel__metrics">{metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div> : <span className="service-plugin-panel__state"><ShieldCheck size={14} />{summary}</span>}
    {details ? <small className="service-plugin-panel__network">{details}</small> : null}
  </div>;
}

type SteamWishlistPayload = {
  totalWishlist: number;
  onSale: number;
  matching: number;
  shown: number;
  highestDiscount: number;
  deals: Array<{
    appId: number;
    name: string;
    storeUrl: string;
    imageUrl: string;
    finalPrice: string;
    originalPrice: string;
    discountPercent: number;
    reviewPercent?: number;
    reviewLabel?: string;
  }>;
  truncated: boolean;
  updatedAt: string;
};

function SteamWishlistServicePlugin({ service }: { service: DashboardService }) {
  const plugin = service.plugin;
  const configKey = JSON.stringify(plugin?.config ?? {});
  const { payload, failed } = useServicePluginPayload<SteamWishlistPayload>(service.id, configKey, "steam-wishlist");
  const summary = payload
    ? payload.matching > 0
      ? `${payload.matching} wishlist ${payload.matching === 1 ? "deal" : "deals"} match your filter${payload.highestDiscount ? ` · up to ${payload.highestDiscount}% off` : ""}`
      : payload.onSale > 0
        ? `No deals match your filter · ${payload.onSale} on sale`
        : `No wishlist deals right now · ${payload.totalWishlist} games checked`
    : failed ? "Steam wishlist unavailable" : "Checking Steam wishlist…";

  if (plugin?.presentation === "summary") {
    return <div className={`service-plugin-summary steam-deals-summary ${failed ? "service-plugin-summary--error" : ""}`}><BadgePercent size={13} /><span>{summary}</span></div>;
  }

  return (
    <div className={`steam-deals-panel ${failed ? "steam-deals-panel--error" : ""}`} aria-label="Steam wishlist deals">
      <header className="steam-deals-panel__header">
        <span className="steam-deals-panel__title"><Gamepad2 size={15} /><strong>Wishlist deals</strong></span>
        {payload?.highestDiscount ? <span className="steam-deals-panel__peak">up to −{payload.highestDiscount}%</span> : null}
      </header>
      {payload?.deals.length ? (
        <div className="steam-deals-rail">
          {payload.deals.map((deal) => (
            <a
              className="steam-deal-card"
              href={deal.storeUrl}
              target="_blank"
              rel="noreferrer"
              key={deal.appId}
              aria-label={`${deal.name}, ${deal.discountPercent}% off, now ${deal.finalPrice}`}
            >
              <span className="steam-deal-card__art">
                <img src={deal.imageUrl} alt="" width="460" height="215" loading="lazy" referrerPolicy="no-referrer" />
                <strong>−{deal.discountPercent}%</strong>
              </span>
              <span className="steam-deal-card__body">
                <b title={deal.name}>{deal.name}</b>
                <span className="steam-deal-card__price"><strong>{deal.finalPrice}</strong><s>{deal.originalPrice}</s></span>
                {deal.reviewPercent ? <small title={deal.reviewLabel}>{deal.reviewPercent}% positive</small> : <small>View on Steam</small>}
              </span>
            </a>
          ))}
        </div>
      ) : (
        <div className="steam-deals-panel__state">
          <BadgePercent size={16} />
          <span><strong>{failed ? "Wishlist unavailable" : payload ? "No matching deals" : "Finding your best deals…"}</strong><small>{summary}</small></span>
        </div>
      )}
      {payload ? <small className="steam-deals-panel__footer">Showing {payload.shown} of {payload.matching} matching deals · {payload.onSale} on sale · {payload.totalWishlist} on wishlist{payload.truncated ? " · first 500 checked" : ""}</small> : null}
    </div>
  );
}

function BeszelWidget({ widget }: { widget: DashboardWidget }) {
  const endpoint = String(widget.config.url ?? "");
  const systemId = String(widget.config.systemId ?? "");
  const label = String(widget.config.label ?? "Beszel");
  const { payload, failed } = useBeszelPayload(widget.id, endpoint, systemId, "widget");

  const metrics = payload?.mode === "system"
    ? [
        ["Status", payload.system.status],
        ["CPU", percent(payload.system.cpu)],
        ["Memory", percent(payload.system.memory)],
        ["Disk", percent(payload.system.disk)],
      ]
    : payload?.mode === "overview"
      ? [["Systems", String(payload.systems)], ["Up", `${payload.up} / ${payload.systems}`]]
      : [];

  return (
    <article className="beszel-widget glass-panel">
      <header>
        <span className="custom-widget-icon"><Activity size={18} /></span>
        <span><small>{label}</small><strong>{payload?.mode === "system" ? payload.system.name : "System overview"}</strong></span>
      </header>
      {failed ? <p className="beszel-widget__state">Beszel unavailable</p> : null}
      {!failed && !payload ? <p className="beszel-widget__state">Loading metrics…</p> : null}
      {metrics.length > 0 ? (
        <div className="beszel-widget__metrics">
          {metrics.map(([metric, value]) => <span key={metric}><small>{metric}</small><strong>{value}</strong></span>)}
        </div>
      ) : null}
      {payload?.mode === "system" && payload.system.network > 0 ? <footer>Network {byteRate(payload.system.network)}</footer> : null}
    </article>
  );
}

type SystemResourcesPayload = {
  cpu: { usedPercent: number; cores: number };
  memory: { usedBytes: number; totalBytes: number; usedPercent: number };
  disk: { usedBytes: number; totalBytes: number; usedPercent: number };
  loadAverage: { oneMinute: number; fiveMinutes: number; fifteenMinutes: number } | null;
  uptimeSeconds: number;
  updatedAt: string;
  history?: {
    scope: "process";
    retentionSeconds: number;
    sampleIntervalSeconds: number;
    samples: Array<{ sampledAt: string; cpuUsedPercent: number; memoryUsedPercent: number }>;
  };
  containers?: { total: number; running: number; stopped: number; healthy: number; unhealthy: number };
};

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "Uptime unavailable";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor(seconds % 86_400 / 3_600);
  if (days > 0) return `Up ${days}d ${hours}h`;
  const minutes = Math.floor(seconds % 3_600 / 60);
  return `Up ${hours}h ${minutes}m`;
}

function SystemResourceMetric({ icon, label, value, title }: { icon: React.ReactNode; label: string; value?: number; title: string }) {
  const normalized = typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : undefined;
  return (
    <span className="system-resource-metric" title={title}>
      <span>{icon}<small>{label}</small><strong>{normalized === undefined ? "—" : percent(normalized)}</strong></span>
      <i aria-hidden="true"><span style={{ width: `${normalized ?? 0}%` }} /></i>
    </span>
  );
}

function useSystemResources(widget: DashboardWidget, detailed = false) {
  const [payload, setPayload] = useState<SystemResourcesPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const refreshSeconds = [5, 10, 30].includes(Number(widget.config.refreshSeconds))
    ? Number(widget.config.refreshSeconds)
    : 5;
  const dockerConnectionId = detailed ? String(widget.config.dockerConnectionId ?? "") : "";

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const parameters = new URLSearchParams();
        if (detailed) {
          parameters.set("includeHistory", "1");
          parameters.set("includeContainers", "1");
          if (dockerConnectionId) parameters.set("dockerConnectionId", dockerConnectionId);
        }
        const response = await fetch(`/api/system/resources${parameters.size ? `?${parameters}` : ""}`, { cache: "no-store" });
        if (!response.ok) throw new Error();
        const next = await response.json() as SystemResourcesPayload;
        if (active) { setPayload(next); setFailed(false); }
      } catch {
        if (active) setFailed(true);
      } finally {
        if (active) timer = window.setTimeout(load, refreshSeconds * 1_000);
      }
    };
    void load();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [detailed, dockerConnectionId, refreshSeconds]);

  return { payload, failed };
}

function trendPoints(samples: NonNullable<SystemResourcesPayload["history"]>["samples"], key: "cpuUsedPercent" | "memoryUsedPercent"): string {
  if (samples.length === 0) return "";
  if (samples.length === 1) {
    const value = Math.min(100, Math.max(0, samples[0][key]));
    const y = 47 - value / 100 * 42;
    return `0,${y.toFixed(1)} 156,${y.toFixed(1)}`;
  }
  return samples.map((sample, index) => {
    const x = index / (samples.length - 1) * 156;
    const value = Math.min(100, Math.max(0, sample[key]));
    const y = 47 - value / 100 * 42;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function ServerHealthTrend({
  payload,
  metric,
  label,
  value,
  detail,
  icon,
}: {
  payload: SystemResourcesPayload;
  metric: "cpuUsedPercent" | "memoryUsedPercent";
  label: string;
  value: number;
  detail: string;
  icon: React.ReactNode;
}) {
  const points = trendPoints(payload.history?.samples ?? [], metric);
  return (
    <article className={`server-health-card__trend server-health-card__trend--${metric === "memoryUsedPercent" ? "memory" : "cpu"}`}>
      <header><span>{icon}{label}</span><strong>{percent(value)}</strong></header>
      <svg viewBox="0 0 156 52" role="img" aria-label={`${label} trend collected during the current Dashcenter run, with up to 24 hours retained`}>
        <path d="M0 47 H156 M0 26 H156 M0 5 H156" className="server-health-card__trend-grid" />
        {points ? <polyline points={points} className="server-health-card__trend-line" /> : null}
      </svg>
      <small>{detail}</small>
    </article>
  );
}

function SystemResourcesWidget({ widget }: { widget: DashboardWidget }) {
  const { payload, failed } = useSystemResources(widget);

  return (
    <div className={`system-resource-widget${failed ? " system-resource-widget--error" : ""}`} data-widget-type="system-resources" aria-live="polite">
      <span className="system-resource-widget__identity">
        <ServerCog size={19} aria-hidden="true" />
        <span><small>This server</small><strong>{failed ? "Unavailable" : payload ? formatUptime(payload.uptimeSeconds) : "Loading…"}</strong></span>
      </span>
      <span className="system-resource-widget__metrics">
        <SystemResourceMetric icon={<Cpu size={13} />} label="CPU" value={payload?.cpu.usedPercent} title={payload ? `${payload.cpu.cores} CPU cores` : "CPU usage"} />
        <SystemResourceMetric icon={<MemoryStick size={13} />} label="RAM" value={payload?.memory.usedPercent} title={payload ? `${byteSize(payload.memory.usedBytes)} of ${byteSize(payload.memory.totalBytes)} used` : "Memory usage"} />
        <SystemResourceMetric icon={<HardDrive size={13} />} label="Disk" value={payload?.disk.totalBytes ? payload.disk.usedPercent : undefined} title={payload?.disk.totalBytes ? `${byteSize(payload.disk.usedBytes)} of ${byteSize(payload.disk.totalBytes)} used` : "Disk usage unavailable"} />
      </span>
    </div>
  );
}

function ServerHealthFact({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="server-health-card__metric">
      <span>{icon}</span>
      <span><small>{label}</small><strong>{value}</strong><em>{detail}</em></span>
    </article>
  );
}

function ServerHealthWidget({ widget }: { widget: DashboardWidget }) {
  const { payload, failed } = useSystemResources(widget, true);
  const available = Boolean(payload && !failed);
  return (
    <section className={`server-health-card glass-panel${failed ? " server-health-card--error" : ""}`} data-widget-type="server-health" aria-live="polite">
      <header className="server-health-card__header">
        <span className="server-health-card__icon"><ServerCog size={22} /></span>
        <span><small>Your server at a glance</small><h2>Server health</h2></span>
        <span className={`server-health-card__state${available ? " server-health-card__state--online" : ""}`}>
          <i />{failed ? "Unavailable" : payload ? "Online" : "Loading"}
        </span>
      </header>
      {payload ? (
        <div className="server-health-card__charts">
          <ServerHealthTrend payload={payload} metric="cpuUsedPercent" label="CPU" value={payload.cpu.usedPercent} detail={`${payload.cpu.cores} logical cores${payload.loadAverage ? ` · load ${payload.loadAverage.oneMinute.toFixed(2)}` : ""}`} icon={<Cpu size={14} />} />
          <ServerHealthTrend payload={payload} metric="memoryUsedPercent" label="Memory" value={payload.memory.usedPercent} detail={`${byteSize(payload.memory.usedBytes)} of ${byteSize(payload.memory.totalBytes)}`} icon={<MemoryStick size={14} />} />
        </div>
      ) : <div className="server-health-card__loading"><Activity size={24} aria-hidden="true" /><span>{failed ? "System data is unavailable" : "Loading system data…"}</span></div>}
      <div className="server-health-card__metrics">
        <ServerHealthFact icon={<HardDrive size={16} />} label="Disk" value={payload?.disk.totalBytes ? percent(payload.disk.usedPercent) : "—"} detail={payload?.disk.totalBytes ? `${byteSize(payload.disk.usedBytes)} / ${byteSize(payload.disk.totalBytes)}` : "Unavailable"} />
        <ServerHealthFact icon={<Clock3 size={16} />} label="Uptime" value={payload ? formatUptime(payload.uptimeSeconds).replace(/^Up /, "") : "—"} detail="Since last reboot" />
        <ServerHealthFact icon={<Container size={16} />} label="Containers" value={payload?.containers ? String(payload.containers.total) : "—"} detail={payload?.containers ? `${payload.containers.running} running` : "Choose Docker source"} />
      </div>
    </section>
  );
}

function ServiceAvailabilityWidget({
  widget,
  groups,
  openInNewTab,
}: {
  widget: DashboardWidget;
  groups: DashboardGroup[];
  openInNewTab: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const summary = useMemo(() => summarizeServiceAvailability(groups), [groups]);
  const pending = summary.checking + summary.unknown;
  const attention = summary.unhealthy + pending;
  const tone = summary.unhealthy > 0
    ? "unhealthy"
    : pending > 0
      ? "checking"
      : summary.total > 0
        ? "healthy"
        : "unknown";
  const statusText = summary.total === 0
    ? "No checks"
    : [
      summary.healthy ? `${summary.healthy} online` : "",
      summary.unhealthy ? `${summary.unhealthy} down` : "",
      summary.checking ? `${summary.checking} checking` : "",
      summary.unknown ? `${summary.unknown} unknown` : "",
    ].filter(Boolean).join(" · ");
  const mobileCount = summary.unhealthy || pending || summary.healthy;
  const panelId = `service-availability-${widget.id}`;

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`service-availability-widget service-availability-widget--${tone}`} data-widget-type="service-availability">
      <button
        type="button"
        className="service-availability-widget__trigger"
        aria-label={`Services: ${statusText}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <Activity size={19} aria-hidden="true" />
        <span className="service-availability-widget__copy"><small>Services</small><strong>{statusText}</strong></span>
        <span className="service-availability-widget__mobile-count" aria-hidden="true">{mobileCount}</span>
        <ChevronDown className={open ? "is-open" : ""} size={14} aria-hidden="true" />
      </button>

      {open ? (
        <section id={panelId} className="service-availability-panel glass-panel" role="dialog" aria-label="Service availability details">
          <header>
            <span><small>Service availability</small><strong>{attention > 0 ? `${attention} need attention` : summary.total > 0 ? "Everything looks good" : "No monitored services"}</strong></span>
            <span>{summary.total} monitored</span>
          </header>
          <div className="service-availability-panel__counts" aria-label="Status counts">
            <span data-status="healthy"><strong>{summary.healthy}</strong><small>Online</small></span>
            <span data-status="unhealthy"><strong>{summary.unhealthy}</strong><small>Down</small></span>
            <span data-status="checking"><strong>{summary.checking}</strong><small>Checking</small></span>
            <span data-status="unknown"><strong>{summary.unknown}</strong><small>Unknown</small></span>
          </div>
          {summary.total === 0 ? (
            <p className="service-availability-panel__empty"><strong>No status checks yet</strong><span>Enable a status indicator on a service to include it here.</span></p>
          ) : summary.issues.length === 0 ? (
            <p className="service-availability-panel__empty service-availability-panel__empty--healthy"><ShieldCheck size={18} /><strong>All monitored services are online</strong></p>
          ) : (
            <div className="service-availability-panel__issues">
              <small>Needs attention</small>
              <div>
                {summary.issues.map(({ groupName, service }) => (
                  <a
                    key={service.id}
                    href={service.href || undefined}
                    target={openInNewTab ? "_blank" : undefined}
                    rel={openInNewTab ? "noreferrer" : undefined}
                    onClick={() => setOpen(false)}
                  >
                    <span className={`status-dot status-${service.status}`} aria-hidden="true" />
                    <span><strong>{service.name}</strong><small>{groupName} · {statusLabel(service)}</small></span>
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function ServiceHealthWidget({
  groups,
  openInNewTab,
}: {
  groups: DashboardGroup[];
  openInNewTab: boolean;
}) {
  const summary = useMemo(() => summarizeServiceAvailability(groups), [groups]);
  const attention = summary.unhealthy + summary.checking + summary.unknown;
  const tone = summary.unhealthy > 0
    ? "unhealthy"
    : attention > 0
      ? "checking"
      : summary.total > 0
        ? "healthy"
        : "unknown";
  return (
    <section className={`service-health-card service-health-card--${tone} glass-panel`} data-widget-type="service-health">
      <header className="service-health-card__header">
        <span className="service-health-card__icon"><ShieldCheck size={22} /></span>
        <span><small>Service overview</small><h2>Service health</h2></span>
        <span className="service-health-card__state"><i />{summary.total ? `${summary.healthy}/${summary.total} online` : "No checks"}</span>
      </header>
      <div className="service-health-card__counts" aria-label="Service health totals">
        <span data-status="healthy"><strong>{summary.healthy}</strong><small>Online</small></span>
        <span data-status="unhealthy"><strong>{summary.unhealthy}</strong><small>Down</small></span>
        <span data-status="checking"><strong>{summary.checking}</strong><small>Checking</small></span>
        <span data-status="unknown"><strong>{summary.unknown}</strong><small>Unknown</small></span>
      </div>
      {summary.total === 0 ? (
        <p className="service-health-card__empty"><strong>No monitored services</strong><span>Enable a status indicator on a service to include it here.</span></p>
      ) : summary.issues.length === 0 ? (
        <p className="service-health-card__empty service-health-card__empty--healthy"><ShieldCheck size={19} /><strong>All monitored services are online</strong></p>
      ) : (
        <div className="service-health-card__issues">
          <small>{attention} {attention === 1 ? "service needs" : "services need"} attention</small>
          <div>
            {summary.issues.slice(0, 4).map(({ groupName, service }) => (
              <a
                key={service.id}
                href={service.href || undefined}
                target={openInNewTab ? "_blank" : undefined}
                rel={openInNewTab ? "noreferrer" : undefined}
              >
                <span className={`status-dot status-${service.status}`} aria-hidden="true" />
                <span><strong>{service.name}</strong><small>{groupName} · {statusLabel(service)}</small></span>
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            ))}
          </div>
          {summary.issues.length > 4 ? <small>+{summary.issues.length - 4} more in the Service availability details</small> : null}
        </div>
      )}
    </section>
  );
}

type MediaPluginPayload = { activity: MediaActivity };
type MediaActivityDisplaySession = MediaActivitySession & {
  serviceId: string;
  serviceName: string;
  provider: "Jellyfin" | "Plex";
};

function mediaTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remainder = safe % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function mediaEpisodeLabel(session: MediaActivityDisplaySession): string {
  if (session.seasonNumber === undefined && session.episodeNumber === undefined) return "";
  const season = session.seasonNumber === undefined ? "" : `S${session.seasonNumber}`;
  const episode = session.episodeNumber === undefined ? "" : `E${session.episodeNumber}`;
  return `${season}${episode}`;
}

function mediaPlayMethodLabel(session: MediaActivityDisplaySession): string {
  if (session.state === "paused") return "Paused";
  if (session.playMethod === "transcode") return "Transcoding";
  if (session.playMethod === "direct-play") return "Direct play";
  if (session.playMethod === "direct-stream") return "Direct stream";
  return "Playing";
}

function MediaActivityWidget({ widget, groups }: { widget: DashboardWidget; groups: DashboardGroup[] }) {
  const configuredIds = Array.isArray(widget.config.serviceIds)
    ? widget.config.serviceIds.filter((value): value is string => typeof value === "string")
    : [];
  const configuredKey = configuredIds.join("\u0000");
  const services = useMemo(() => {
    const allowed = new Set(configuredKey ? configuredKey.split("\u0000") : []);
    return groups.flatMap((group) => group.services).filter((service) => (
      allowed.has(service.id) && service.visible && service.plugin?.enabled && (service.plugin.type === "jellyfin" || service.plugin.type === "plex")
    ));
  }, [configuredKey, groups]);
  const serviceKey = services.map((service) => `${service.id}:${service.name}:${service.plugin?.type}:${String(service.plugin?.config.url ?? "")}`).join("\u0000");
  const [sessions, setSessions] = useState<MediaActivityDisplaySession[]>([]);
  const [totalActive, setTotalActive] = useState(0);
  const [failedSources, setFailedSources] = useState(0);
  const [providerTruncated, setProviderTruncated] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    if (services.length === 0) {
      setSessions([]);
      setTotalActive(0);
      setFailedSources(0);
      setProviderTruncated(false);
      setLoaded(true);
      return () => { active = false; };
    }
    setLoaded(false);
    const load = async () => {
      const results = await Promise.allSettled(services.map(async (service) => {
        const response = await fetch(`/api/services/${encodeURIComponent(service.id)}/plugin`);
        if (!response.ok) throw new Error("Media service unavailable");
        const payload = await response.json() as MediaPluginPayload;
        return { service, payload };
      }));
      if (!active) return;
      const successful = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      setFailedSources(results.length - successful.length);
      setTotalActive(successful.reduce((total, result) => total + Math.max(0, result.payload.activity?.active ?? 0), 0));
      setProviderTruncated(successful.some((result) => result.payload.activity?.truncated));
      setSessions(successful.flatMap(({ service, payload }) => (payload.activity?.sessions ?? []).map((session) => ({
        ...session,
        serviceId: service.id,
        serviceName: service.name,
        provider: service.plugin?.type === "plex" ? "Plex" as const : "Jellyfin" as const,
      }))));
      setLoaded(true);
      timer = window.setTimeout(load, 30_000);
    };
    void load();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [serviceKey]);

  const maximum = Math.min(8, Math.max(1, Math.round(Number(widget.config.maxSessions) || 4)));
  const visibleSessions = [...sessions]
    .sort((left, right) => Number(left.state === "paused") - Number(right.state === "paused"))
    .slice(0, maximum);
  const label = typeof widget.config.label === "string" && widget.config.label.trim() ? widget.config.label.trim() : "Now playing";
  const showArtwork = widget.config.showArtwork !== false;
  const missingSelection = configuredIds.length === 0;
  const allFailed = loaded && services.length > 0 && failedSources === services.length;
  const hiddenSessions = providerTruncated || totalActive > visibleSessions.length;

  return (
    <section className={`media-activity-card glass-panel${allFailed ? " media-activity-card--error" : ""}`} data-widget-type="media-activity" aria-live="polite">
      <header className="media-activity-card__header">
        <span className="media-activity-card__icon"><Clapperboard size={22} /></span>
        <span><small>Media overview</small><h2>{label}</h2></span>
        <span className="media-activity-card__state"><i />{loaded ? `${totalActive} active` : "Loading"}</span>
      </header>
      {!loaded ? (
        <p className="media-activity-card__empty"><strong>Loading media activity…</strong><span>Checking the selected Jellyfin and Plex services.</span></p>
      ) : missingSelection ? (
        <p className="media-activity-card__empty"><strong>Choose a media service</strong><span>Select one or more Jellyfin or Plex services in this widget’s settings.</span></p>
      ) : services.length === 0 ? (
        <p className="media-activity-card__empty"><strong>Media sources unavailable</strong><span>The selected services are hidden, disabled or no longer exist.</span></p>
      ) : allFailed ? (
        <p className="media-activity-card__empty"><strong>Could not load media activity</strong><span>Check the selected service plugins and their stored credentials.</span></p>
      ) : visibleSessions.length === 0 ? (
        <p className="media-activity-card__empty"><strong>Nothing is playing</strong><span>The selected media servers are online and ready.</span></p>
      ) : (
        <div className="media-activity-card__sessions">
          {visibleSessions.map((session) => {
            const context = [session.seriesTitle, mediaEpisodeLabel(session), session.quality, session.provider].filter(Boolean).join(" · ");
            const client = [session.username, session.client, session.device, mediaPlayMethodLabel(session)].filter(Boolean).join(" · ");
            return (
              <article className="media-activity-session" key={`${session.serviceId}:${session.id}`}>
                {showArtwork ? (
                  <span className="media-activity-session__art" aria-hidden="true">
                    <Film size={22} />
                    {session.artworkId ? (
                      <img
                        src={`/api/services/${encodeURIComponent(session.serviceId)}/plugin/artwork/${encodeURIComponent(session.artworkId)}`}
                        alt=""
                        loading="lazy"
                        onError={(event) => { event.currentTarget.hidden = true; }}
                      />
                    ) : null}
                  </span>
                ) : null}
                <span className="media-activity-session__copy">
                  <span className="media-activity-session__title"><strong>{session.title}</strong><small>{context || session.serviceName}</small></span>
                  <span className="media-activity-session__client">{client}</span>
                  <span className="media-activity-session__progress">
                    <span role="progressbar" aria-label={`${session.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={session.progressPercent}><i style={{ width: `${session.progressPercent}%` }} /></span>
                    <small>{mediaTime(session.positionSeconds)}{session.durationSeconds > 0 ? ` / ${mediaTime(session.durationSeconds)}` : ""}</small>
                  </span>
                </span>
              </article>
            );
          })}
        </div>
      )}
      {loaded && (failedSources > 0 || hiddenSessions) ? (
        <footer>{[
          failedSources > 0 ? `${failedSources} ${failedSources === 1 ? "source" : "sources"} unavailable` : "",
          hiddenSessions ? `${Math.max(0, totalActive - visibleSessions.length)} more active` : "",
        ].filter(Boolean).join(" · ")}</footer>
      ) : null}
    </section>
  );
}

function networkTrendPoints(
  samples: MikrotikPayload["traffic"]["samples"],
  key: "downloadBitsPerSecond" | "uploadBitsPerSecond",
): string {
  if (samples.length === 0) return "";
  const maximum = Math.max(1, ...samples.map((sample) => sample[key]));
  if (samples.length === 1) {
    const y = 44 - samples[0][key] / maximum * 36;
    return `0,${y.toFixed(1)} 176,${y.toFixed(1)}`;
  }
  return samples.map((sample, index) => {
    const x = index / (samples.length - 1) * 176;
    const y = 44 - sample[key] / maximum * 36;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function NetworkTrafficSparkline({
  samples,
  series,
}: {
  samples: MikrotikPayload["traffic"]["samples"];
  series: "downloadBitsPerSecond" | "uploadBitsPerSecond";
}) {
  const points = networkTrendPoints(samples, series);
  const label = series === "downloadBitsPerSecond" ? "Download rate history" : "Upload rate history";
  return (
    <svg viewBox="0 0 176 50" role="img" aria-label={`${label}, collected during the current Dashcenter run`}>
      <path d="M0 44 H176 M0 26 H176 M0 8 H176" className="network-traffic-card__chart-grid" />
      {points ? <polyline points={points} className="network-traffic-card__chart-line" /> : null}
    </svg>
  );
}

function NetworkTrafficShell({
  label,
  status,
  error = false,
  children,
}: {
  label: string;
  status: string;
  error?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`network-traffic-card glass-panel${error ? " network-traffic-card--error" : ""}`} data-widget-type="network-traffic" aria-live="polite">
      <header className="network-traffic-card__header">
        <span className="network-traffic-card__icon"><Network size={22} /></span>
        <span><small>MikroTik router</small><h2>{label}</h2></span>
        <span className="network-traffic-card__state"><i />{status}</span>
      </header>
      {children}
    </section>
  );
}

function ConnectedNetworkTrafficWidget({
  widget,
  service,
}: {
  widget: DashboardWidget;
  service: DashboardService;
}) {
  const label = typeof widget.config.label === "string" && widget.config.label.trim() ? widget.config.label.trim() : "Network";
  const endpoint = String(service.plugin?.config.url ?? "");
  const { payload, failed } = useServicePluginPayload<MikrotikPayload>(service.id, endpoint, "mikrotik-network-traffic");
  const traffic = payload?.traffic;
  const status = failed
    ? "Unavailable"
    : !payload
      ? "Loading"
      : traffic?.status === "ready"
        ? traffic.running ? "Live" : "Interface down"
        : traffic?.status === "warming-up"
          ? "Collecting"
          : traffic?.status === "unavailable"
            ? "Unavailable"
            : "Setup needed";

  if (!payload || !traffic || failed || traffic.status !== "ready") {
    const state = failed
      ? ["Could not load network traffic", "Check the selected MikroTik service and its stored credentials."]
      : !payload || !traffic
        ? ["Loading network traffic…", "Reading the selected RouterOS interface counters."]
        : traffic.status === "unconfigured"
          ? ["Choose a traffic interface", "Test the MikroTik service and select the WAN interface in its plugin settings."]
          : traffic.status === "unavailable"
            ? ["Traffic interface unavailable", "The saved interface is missing, disabled or does not expose byte counters."]
            : ["Collecting the first sample…", `Rates appear after the next ${traffic.sampleIntervalSeconds}-second sample from ${traffic.interfaceName}.`];
    return (
      <NetworkTrafficShell label={label} status={status} error={failed || traffic?.status === "unavailable"}>
        <p className="network-traffic-card__empty"><strong>{state[0]}</strong><span>{state[1]}</span></p>
      </NetworkTrafficShell>
    );
  }

  const updated = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(payload.updatedAt));
  return (
    <NetworkTrafficShell label={label} status={status} error={!traffic.running}>
      <div className="network-traffic-card__source"><span>{service.name}</span><strong>{traffic.interfaceName}{traffic.interfaceType ? ` · ${traffic.interfaceType}` : ""}</strong></div>
      <div className="network-traffic-card__metrics">
        <article className="network-traffic-card__metric">
          <span><Download size={15} /><small>WAN down</small></span>
          <NetworkTrafficSparkline samples={traffic.samples} series="downloadBitsPerSecond" />
          <strong>{bitRate(traffic.downloadBitsPerSecond)}</strong>
        </article>
        <article className="network-traffic-card__metric">
          <span><Upload size={15} /><small>WAN up</small></span>
          <NetworkTrafficSparkline samples={traffic.samples} series="uploadBitsPerSecond" />
          <strong>{bitRate(traffic.uploadBitsPerSecond)}</strong>
        </article>
        <article className="network-traffic-card__metric network-traffic-card__metric--devices">
          <span><Router size={15} /><small>Devices</small></span>
          <i aria-hidden="true"><span style={{ width: `${payload.dhcp.leases ? Math.min(100, payload.dhcp.active / payload.dhcp.leases * 100) : 0}%` }} /></i>
          <strong>{payload.dhcp.active} / {payload.dhcp.leases}</strong>
        </article>
      </div>
      <footer>{traffic.samples.length} of {traffic.maxSamples} samples · this run · updated {updated}</footer>
    </NetworkTrafficShell>
  );
}

function NetworkTrafficWidget({ widget, groups }: { widget: DashboardWidget; groups: DashboardGroup[] }) {
  const label = typeof widget.config.label === "string" && widget.config.label.trim() ? widget.config.label.trim() : "Network";
  const serviceId = typeof widget.config.serviceId === "string" ? widget.config.serviceId : "";
  const service = groups.flatMap((group) => group.services).find((candidate) => (
    candidate.id === serviceId && candidate.visible && candidate.plugin?.enabled && candidate.plugin.type === "mikrotik"
  ));
  if (service) return <ConnectedNetworkTrafficWidget widget={widget} service={service} />;
  return (
    <NetworkTrafficShell label={label} status="Setup needed">
      <p className="network-traffic-card__empty">
        <strong>{serviceId ? "MikroTik source unavailable" : "Choose a MikroTik service"}</strong>
        <span>{serviceId ? "The selected service is hidden, disabled or no longer exists." : "Select a visible MikroTik service in this widget’s settings."}</span>
      </p>
    </NetworkTrafficShell>
  );
}

export function DashboardView({
  data,
  onOpenSettings,
  onManageServices,
  onManageWidgets,
  onRefresh,
  mode = "published",
  previewMode = "desktop",
  editor,
}: DashboardViewProps) {
  const { settings } = data;
  const editing = Boolean(editor?.active);
  const workspace = mode === "workspace";
  const appearancePreview = mode === "appearance";
  const workspacePreviewOnly = workspace && previewMode !== "desktop";
  const orderedWidgets = useMemo(() => orderDashboardWidgets(data.widgets), [data.widgets]);
  const searchWidget = orderedWidgets.find((widget) => widget.type === "search");
  const clockWidget = orderedWidgets.find((widget) => widget.type === "clock");
  const weatherWidget = orderedWidgets.find((widget) => widget.type === "weather");
  const headerWidgets = orderedWidgets.filter((widget) => widget.enabled && dashboardWidgetPlacement(widget.type) === "topbar");
  const showSearch = Boolean(searchWidget?.enabled);
  const showWeather = Boolean(weatherWidget?.enabled);
  const weatherLabel = String(weatherWidget?.config.label ?? settings.weatherLabel ?? "Weather");
  const weatherLatitude = Number(weatherWidget?.config.latitude ?? settings.weatherLatitude);
  const weatherLongitude = Number(weatherWidget?.config.longitude ?? settings.weatherLongitude);
  const [query, setQuery] = useState("");
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedLayoutId, setSelectedLayoutId] = useState("");
  const [inspectorTab, setInspectorTab] = useState<"add" | "selected">("selected");
  const searchRef = useRef<HTMLInputElement>(null);
  const now = useClock();
  const { columnCount } = useResponsiveBoard(Math.max(1, Math.min(6, settings.columns || 3)));
  const boardColumnCount = editing || appearancePreview
    ? previewMode === "mobile" ? 1 : previewMode === "tablet" ? Math.min(2, Math.max(1, settings.columns || 3)) : Math.max(1, Math.min(6, settings.columns || 3))
    : columnCount;
  const editorDesktopMinWidth = boardColumnCount * EDITOR_PREVIEW_COLUMN_WIDTH_PX
    + Math.max(0, boardColumnCount - 1) * DASHBOARD_GRID_GAP_PX;
  const editSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!editing && !appearancePreview && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        editor?.onSave();
      }
      if (editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) editor?.onRedo();
        else editor?.onUndo();
      }
      if (event.key === "Escape") {
        setQuery("");
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [appearancePreview, editing, editor]);

  useEffect(() => {
    if (editing) setQuery("");
  }, [editing]);

  useEffect(() => {
    if (!showWeather) return;
    const params = new URLSearchParams({
      lat: String(weatherLatitude),
      lon: String(weatherLongitude),
      label: weatherLabel,
    });
    fetch(`/api/weather?${params}`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((payload: WeatherData) => setWeather(payload))
      .catch(() => setWeather(null));
  }, [showWeather, weatherLabel, weatherLatitude, weatherLongitude]);

  useEffect(() => {
    if (editing || appearancePreview) return;
    let cancelled = false;
    let timer: number | undefined;

    const schedule = () => {
      timer = window.setTimeout(async () => {
        if (document.visibilityState === "visible") {
          try {
            await onRefresh();
          } catch {
            // Keep showing the last known dashboard state during a transient failure.
          }
        }
        if (!cancelled) schedule();
      }, DASHBOARD_POLL_INTERVAL_MS);
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [appearancePreview, editing, onRefresh]);

  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return orderDashboardGroups(data.groups)
      .filter((group) => group.visible)
      .map((group) => ({
        ...group,
        services: group.services.filter((service) => {
          if (!service.visible) return false;
          if (!needle) return true;
          return [service.name, service.description, service.href, group.name]
            .join(" ")
            .toLocaleLowerCase()
            .includes(needle);
        })
      }))
      .filter((group) => group.services.length > 0);
  }, [data.groups, query]);

  const contentWidgets = orderedWidgets.filter((widget) => (
    widget.enabled && (
      widget.type === "server-health" ||
      widget.type === "service-health" ||
      widget.type === "media-activity" ||
      widget.type === "network-traffic" ||
      widget.type === "docker" ||
      widget.type === "calendar-agenda" ||
      widget.type === "feed-reader" ||
      ((widget.type === "custom-api" || widget.type === "beszel") && widget.config.url)
    )
  ));
  const dashboardLayout = useMemo(
    () => reconcileDashboardGrid(data.layout, data.groups, data.widgets, boardColumnCount),
    [boardColumnCount, data.groups, data.layout, data.widgets],
  );
  const dashboardItems = useMemo(() => {
    const groups = new Map(visibleGroups.map((group) => [group.id, group]));
    const widgets = new Map(contentWidgets.map((widget) => [widget.id, widget]));
    const result: Array<{
      item: DashboardGridItem;
      group?: DashboardGroup;
      widget?: DashboardWidget;
    }> = [];
    for (const item of dashboardLayout) {
      if (item.kind === "group") {
        const group = groups.get(item.referenceId);
        if (group) result.push({ item, group });
        continue;
      }
      const widget = widgets.get(item.referenceId);
      if (widget) result.push({ item, widget });
    }
    return result;
  }, [contentWidgets, dashboardLayout, visibleGroups]);
  const selectedLayoutItem = dashboardLayout.find((item) => item.id === selectedLayoutId)
    ?? dashboardItems[0]?.item;
  const selectedGroup = selectedLayoutItem?.kind === "group"
    ? data.groups.find((group) => group.id === selectedLayoutItem.referenceId)
    : undefined;
  const selectedWidget = selectedLayoutItem?.kind === "widget"
    ? data.widgets.find((widget) => widget.id === selectedLayoutItem.referenceId)
    : undefined;
  const selectedName = selectedGroup?.name ?? (selectedWidget ? dashboardWidgetName(selectedWidget) : "Board item");
  const selectedWidth = selectedLayoutItem ? normalizeGridColumnSpan(selectedLayoutItem.columnSpan, boardColumnCount) : 1;
  const selectedStart = selectedLayoutItem ? normalizeGridColumnStart(selectedLayoutItem.columnStart, boardColumnCount, selectedWidth) : 0;
  const selectedHeight = selectedLayoutItem ? normalizeGridRowSpan(selectedLayoutItem.rowSpan) : 0;

  useEffect(() => {
    if (!editing) {
      setSelectedLayoutId("");
      return;
    }
    if (!dashboardItems.some(({ item }) => item.id === selectedLayoutId)) {
      setSelectedLayoutId(dashboardItems[0]?.item.id ?? "");
    }
  }, [dashboardItems, editing, selectedLayoutId]);

  const updateLayout = (next: DashboardGridItem[]) => {
    if (!editor) return;
    editor.onChange({
      ...data,
      layout: next.map((item, position) => ({ ...item, position })),
    });
  };

  const changeSelectedLayout = (changes: Partial<Pick<DashboardGridItem, "columnSpan" | "columnStart" | "rowSpan">>) => {
    if (!selectedLayoutItem) return;
    updateLayout(dashboardLayout.map((item) => item.id === selectedLayoutItem.id ? { ...item, ...changes } : item));
  };

  const resizeLayoutItem = (id: string, changes: Pick<DashboardGridItem, "columnSpan" | "rowSpan">) => {
    updateLayout(dashboardLayout.map((item) => {
      if (item.id !== id) return item;
      const columnSpan = normalizeGridColumnSpan(changes.columnSpan, boardColumnCount);
      return {
        ...item,
        columnSpan,
        columnStart: normalizeGridColumnStart(item.columnStart, boardColumnCount, columnSpan),
        rowSpan: normalizeGridRowSpan(changes.rowSpan),
      };
    }));
  };

  const reorderLayout = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = dashboardLayout.findIndex((item) => item.id === event.active.id);
    const newIndex = dashboardLayout.findIndex((item) => item.id === event.over?.id);
    if (oldIndex < 0 || newIndex < 0) return;
    updateLayout(arraySwap(dashboardLayout, oldIndex, newIndex));
    setSelectedLayoutId(String(event.active.id));
  };

  const changeBoardColumns = (nextColumns: number) => {
    if (!editor) return;
    const columns = Math.max(1, Math.min(6, nextColumns));
    const layout = dashboardLayout.map((item) => {
      const columnSpan = normalizeGridColumnSpan(item.columnSpan, columns);
      return {
        ...item,
        columnSpan,
        columnStart: normalizeGridColumnStart(item.columnStart, columns, columnSpan),
      };
    });
    editor.onChange({ ...data, settings: { ...data.settings, columns }, layout });
  };

  const changeGroupDirection = (direction: ServiceGroupDirection) => {
    if (!editor || !selectedGroup) return;
    editor.onChange({
      ...data,
      groups: data.groups.map((group) => group.id === selectedGroup.id ? { ...group, direction } : group),
    });
  };

  const moveSelected = (offset: -1 | 1) => {
    if (!selectedLayoutItem) return;
    const currentIndex = dashboardLayout.findIndex((item) => item.id === selectedLayoutItem.id);
    const nextIndex = currentIndex + offset;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= dashboardLayout.length) return;
    updateLayout(arraySwap(dashboardLayout, currentIndex, nextIndex));
  };

  const resetSelectedPlacement = () => {
    if (!selectedLayoutItem) return;
    changeSelectedLayout({
      columnStart: AUTO_GRID_COLUMN_START,
      rowSpan: AUTO_GRID_ROW_SPAN,
    });
  };

  const selectReference = (kind: DashboardGridItem["kind"], referenceId: string) => {
    const match = dashboardLayout.find((item) => item.kind === kind && item.referenceId === referenceId);
    if (!match) return;
    setSelectedLayoutId(match.id);
    setInspectorTab("selected");
  };
  const searchProvider = String(searchWidget?.config.provider ?? "internal");
  const clockFormat = normalizeClockFormat(clockWidget?.config.format);
  const background = settings.backgroundUrl || "/assets/dashcenter-forest.png";
  const locale = settings.language || "en-GB";
  const clockFormatter = useMemo(() => createClockFormatter(locale, clockFormat), [locale, clockFormat]);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }),
    [locale],
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/health/refresh", { method: "POST", credentials: "same-origin" });
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const renderDashboardItem = ({
    item,
    group,
    widget,
  }: {
    item: DashboardGridItem;
    group?: DashboardGroup;
    widget?: DashboardWidget;
  }) => {
    const content = (
      <>
        {group ? <GroupBlock group={group} openInNewTab={settings.openInNewTab} /> : null}
        {widget?.type === "server-health" ? <ServerHealthWidget widget={widget} /> : null}
        {widget?.type === "service-health" ? <ServiceHealthWidget groups={data.groups} openInNewTab={settings.openInNewTab} /> : null}
        {widget?.type === "media-activity" ? <MediaActivityWidget widget={widget} groups={data.groups} /> : null}
        {widget?.type === "network-traffic" ? <NetworkTrafficWidget widget={widget} groups={data.groups} /> : null}
        {widget?.type === "docker" ? <DockerStatusWidget widget={widget} groups={data.groups} /> : null}
        {widget?.type === "beszel" ? <BeszelWidget widget={widget} /> : null}
        {widget?.type === "custom-api" ? <CustomApiWidget widget={widget} /> : null}
        {widget?.type === "calendar-agenda" ? <CalendarAgendaWidget widget={widget} locale={settings.language} /> : null}
        {widget?.type === "feed-reader" ? <FeedReaderWidget widget={widget} locale={settings.language} /> : null}
      </>
    );
    if (!editing || !editor) {
      return (
        <DashboardGridItemFrame key={item.id} item={item} columnCount={boardColumnCount}>
          {content}
        </DashboardGridItemFrame>
      );
    }
    const label = group?.name ?? (widget ? dashboardWidgetName(widget) : "Board item");
    return (
      <EditableDashboardGridItem
        key={item.id}
        item={item}
        columnCount={boardColumnCount}
        selected={selectedLayoutItem?.id === item.id}
        label={label}
        disabled={editor.saving || (workspace && previewMode !== "desktop")}
        onSelect={setSelectedLayoutId}
        onResize={resizeLayoutItem}
      >
        {content}
      </EditableDashboardGridItem>
    );
  };

  const dashboardGrid = (
    <div className="dashboard-grid" style={{ gridTemplateColumns: `repeat(${boardColumnCount}, minmax(0, 1fr))` }}>
      {dashboardItems.map(renderDashboardItem)}
    </div>
  );

  const renderedBoard = dashboardItems.length ? (
    editing ? (
      <DndContext sensors={editSensors} collisionDetection={preciseSwapCollision} onDragEnd={reorderLayout}>
        <SortableContext items={dashboardItems.map(({ item }) => item.id)} strategy={rectSwappingStrategy}>
          {dashboardGrid}
        </SortableContext>
      </DndContext>
    ) : dashboardGrid
  ) : (
    <section className="empty-search glass-panel">
      <Search size={24} />
      <h2>No matching services</h2>
      <p>Press Enter to search the web for “{query}”.</p>
    </section>
  );

  const DashboardRoot = workspace || appearancePreview ? "div" : "main";

  return (
    <DashboardRoot
      className={[
        "dashboard-shell",
        `density-${settings.density}`,
        workspace ? "dashboard-shell--editor-workspace" : "",
        appearancePreview ? "dashboard-shell--appearance-preview" : "",
        workspace || appearancePreview ? `dashboard-shell--preview-${previewMode}` : "",
      ].filter(Boolean).join(" ")}
      data-icon-treatment={settings.appearance.icons.treatment}
      data-icon-frame={settings.appearance.icons.frameStyle}
      style={
        {
          ...appearanceCssVariables(settings.appearance),
          "--dashboard-bg": `url(${JSON.stringify(background)})`,
          "--dashboard-editor-preview-min-width": `${editorDesktopMinWidth}px`,
        } as React.CSSProperties
      }
    >
      {!workspace ? <div className="dashboard-bg" aria-hidden="true" /> : null}
      {!workspace ? (
      <header className={`dashboard-topbar glass-panel${headerWidgets.length > 0 ? "" : " dashboard-topbar--no-modules"}`}>
        <div className="brand-lockup">
          <DashcenterMark className="brand-mark" size={37} />
          <strong>{settings.title || "Dashcenter"}</strong>
        </div>

        {headerWidgets.length > 0 ? (
          <div className="topbar-modules" aria-label="Dashboard header widgets">
            {headerWidgets.map((widget) => {
              if (widget.type === "search") {
                return (
                  <form
                    key={widget.id}
                    className="search-box"
                    data-widget-type="search"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (query && (visibleGroups.length === 0 || searchProvider !== "internal")) {
                        const base = searchProvider === "duckduckgo" ? "https://duckduckgo.com/?q=" : "https://www.google.com/search?q=";
                        window.open(`${base}${encodeURIComponent(query)}`, "_blank", "noopener,noreferrer");
                      }
                    }}
                  >
                    <Search size={18} aria-hidden="true" />
                    <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search services…" aria-label="Search services" />
                    <span className="key-hint"><Command size={12} /> K</span>
                  </form>
                );
              }
              if (widget.type === "clock") {
                return (
                  <div key={widget.id} className="time-widget" data-widget-type="clock">
                    <CalendarDays size={19} aria-hidden="true" />
                    <span>
                      <strong>{clockFormatter.format(now)}</strong>
                      <small>{dateFormatter.format(now)}</small>
                    </span>
                  </div>
                );
              }
              if (widget.type === "system-resources") return <SystemResourcesWidget key={widget.id} widget={widget} />;
              if (widget.type === "service-availability") {
                return <ServiceAvailabilityWidget key={widget.id} widget={widget} groups={data.groups} openInNewTab={settings.openInNewTab} />;
              }
              if (widget.type === "weather") return (
                <div key={widget.id} className="weather-widget" data-widget-type="weather">
                  <CloudSun size={21} aria-hidden="true" />
                  <span>
                    <strong>{weather ? `${Math.round(weather.temperature)}°C` : "—°C"}</strong>
                    <small>{weather?.description || weatherLabel}</small>
                  </span>
                </div>
              );
              return null;
            })}
          </div>
        ) : null}

        <div className="topbar-tools">
          <button className="icon-button" type="button" onClick={refresh} title="Refresh service status" aria-label="Refresh service status">
            <RefreshCw size={18} className={refreshing ? "is-spinning" : ""} />
          </button>
          <button className="edit-button settings-button" type="button" onClick={onOpenSettings} aria-label="Dashboard settings" title="Dashboard settings">
            <Settings2 size={17} />
            <span>Settings</span>
          </button>
        </div>
      </header>
      ) : null}

      {workspace && editor ? (
        <div className="dashboard-editor-workspace">
          <section className="dashboard-editor-canvas" aria-label={previewMode + " dashboard canvas"}>
            <div className="dashboard-editor-preview-surface">
              <div className="dashboard-editor-header-preview" aria-hidden="true">
                <span className="dashboard-editor-header-preview__brand"><DashcenterMark size={31} /><strong>{settings.title || "Dashcenter"}</strong></span>
                {showSearch ? <span className="dashboard-editor-header-preview__search"><Search size={15} /> Search services…</span> : null}
                <span className="dashboard-editor-header-preview__modules">
                  {Boolean(clockWidget?.enabled) ? <span><CalendarDays size={14} /> {clockFormatter.format(now)}</span> : null}
                  {showWeather ? <span><CloudSun size={15} /> {weather ? `${Math.round(weather.temperature)}°C` : weatherLabel}</span> : null}
                </span>
              </div>
              <div className="dashboard-content">{renderedBoard}</div>
            </div>
          </section>

          <aside className="dashboard-workspace-inspector" aria-label="Dashboard layout inspector">
            <nav className="dashboard-workspace-inspector__tabs" aria-label="Inspector mode">
              <button type="button" className={inspectorTab === "add" ? "is-active" : ""} onClick={() => setInspectorTab("add")}>Add</button>
              <button type="button" className={inspectorTab === "selected" ? "is-active" : ""} onClick={() => setInspectorTab("selected")}>Selected</button>
            </nav>

            {inspectorTab === "add" ? (
              <div className="dashboard-workspace-library">
                <header>
                  <Blocks size={18} />
                  <span><strong>Dashboard modules</strong><small>Select an existing module or open its owning settings.</small></span>
                </header>
                <section>
                  <h3>Dashboard widgets</h3>
                  {contentWidgets.map((widget) => (
                    <button key={widget.id} type="button" onClick={() => selectReference("widget", widget.id)}>
                      <span><strong>{dashboardWidgetName(widget)}</strong><small>Dashboard widget</small></span>
                      <span>Select</span>
                    </button>
                  ))}
                  <button className="dashboard-workspace-library__manage" type="button" onClick={onManageWidgets ?? onOpenSettings}>Manage widgets</button>
                </section>
                <section>
                  <h3>Service groups</h3>
                  {visibleGroups.map((group) => (
                    <button key={group.id} type="button" onClick={() => selectReference("group", group.id)}>
                      <span><strong>{group.name}</strong><small>{group.services.length} services</small></span>
                      <span>Select</span>
                    </button>
                  ))}
                  <button className="dashboard-workspace-library__manage" type="button" onClick={onManageServices}>Manage services</button>
                </section>
                <p className="dashboard-workspace-library__note">Topbar widgets are configured separately and never enter the dashboard grid.</p>
              </div>
            ) : (
              <div className="dashboard-workspace-selection">
                <header>
                  <span className="dashboard-workspace-selection__icon"><LayoutGrid size={20} /></span>
                  <span><strong>{selectedName}</strong><small>{selectedLayoutItem?.kind === "group" ? "Service group" : "Dashboard widget"}</small></span>
                </header>
                {workspacePreviewOnly ? <p className="dashboard-workspace-selection__preview-note">Tablet and mobile are preview modes. Switch to Desktop to resize or change placement.</p> : null}
                <fieldset className="dashboard-workspace-control">
                  <legend>Board columns</legend>
                  <div role="radiogroup" aria-label="Board columns">
                    {Array.from({ length: 6 }, (_, index) => index + 1).map((columns) => (
                      <button key={columns} type="button" role="radio" aria-checked={settings.columns === columns} onClick={() => changeBoardColumns(columns)} disabled={editor.saving || workspacePreviewOnly}>{columns}</button>
                    ))}
                  </div>
                </fieldset>
                {selectedLayoutItem ? (
                  <>
                    <div className="dashboard-workspace-control-grid">
                      <fieldset className="dashboard-workspace-control">
                        <legend>Width (columns)</legend>
                        <div role="radiogroup" aria-label="Selected module width">
                          {Array.from({ length: Math.min(boardColumnCount, MAX_GRID_COLUMN_SPAN) }, (_, index) => index + 1).map((width) => (
                            <button key={width} type="button" role="radio" aria-checked={selectedWidth === width} onClick={() => changeSelectedLayout({ columnSpan: width, columnStart: normalizeGridColumnStart(selectedStart, boardColumnCount, width) })} disabled={editor.saving || workspacePreviewOnly}>{width}</button>
                          ))}
                        </div>
                      </fieldset>
                      <fieldset className="dashboard-workspace-control">
                        <legend>Minimum height</legend>
                        <div role="radiogroup" aria-label="Selected module minimum height">
                          {[AUTO_GRID_ROW_SPAN, 1, 2, 3].map((height) => (
                            <button key={height} type="button" role="radio" aria-checked={selectedHeight === height} onClick={() => changeSelectedLayout({ rowSpan: height })} disabled={editor.saving || workspacePreviewOnly}>{height || "Auto"}</button>
                          ))}
                        </div>
                      </fieldset>
                    </div>
                    <fieldset className="dashboard-workspace-control">
                      <legend>Start column</legend>
                      <div role="radiogroup" aria-label="Selected module start column">
                        {[AUTO_GRID_COLUMN_START, ...Array.from({ length: Math.max(1, boardColumnCount - selectedWidth + 1) }, (_, index) => index + 1)].map((start) => (
                          <button key={start} type="button" role="radio" aria-checked={selectedStart === start} onClick={() => changeSelectedLayout({ columnStart: start })} disabled={editor.saving || workspacePreviewOnly}>{start || "Auto"}</button>
                        ))}
                      </div>
                    </fieldset>
                    {selectedGroup ? (
                      <fieldset className="dashboard-workspace-control">
                        <legend>Service flow</legend>
                        <div role="radiogroup" aria-label="Service group direction">
                          {([
                            { value: "horizontal", label: "Horizontal" },
                            { value: "vertical", label: "Vertical" },
                          ] as Array<{ value: ServiceGroupDirection; label: string }>).map((option) => (
                            <button key={option.value} type="button" role="radio" aria-checked={(selectedGroup.direction ?? "horizontal") === option.value} onClick={() => changeGroupDirection(option.value)} disabled={editor.saving || workspacePreviewOnly}>{option.label}</button>
                          ))}
                        </div>
                      </fieldset>
                    ) : null}
                    <div className="dashboard-workspace-selection__move">
                      <button type="button" onClick={() => moveSelected(-1)} disabled={editor.saving || dashboardLayout[0]?.id === selectedLayoutItem.id}><ArrowUp size={16} /> Move earlier</button>
                      <button type="button" onClick={() => moveSelected(1)} disabled={editor.saving || dashboardLayout[dashboardLayout.length - 1]?.id === selectedLayoutItem.id}><ArrowDown size={16} /> Move later</button>
                    </div>
                    <button className="dashboard-workspace-selection__reset" type="button" onClick={resetSelectedPlacement} disabled={editor.saving || workspacePreviewOnly}><RotateCcw size={16} /> Reset placement</button>
                  </>
                ) : null}
                {editor.error ? <p className="dashboard-workspace-selection__error" role="alert">{editor.error}</p> : null}
              </div>
            )}
          </aside>
        </div>
      ) : (
        <>
          <div className="dashboard-content">{renderedBoard}</div>
          <footer className="dashboard-footer">
            <span><DashcenterMark className="footer-brand-mark" size={13} /> Dashcenter {DASHCENTER_RELEASE}</span>
          </footer>
        </>
      )}
    </DashboardRoot>
  );
}

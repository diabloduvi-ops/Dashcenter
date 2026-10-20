import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  Activity,
  ArrowLeft,
  BadgePercent,
  Box,
  ChevronRight,
  CircleDot,
  Cpu,
  Captions,
  Disc3,
  Download,
  Eye,
  EyeOff,
  Film,
  GripVertical,
  LayoutGrid,
  Layers3,
  Play,
  Plus,
  Plug,
  Router,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  Tv,
} from "lucide-react";
import { normalizeIconReference } from "../../../shared/icons";
import { createClientId } from "../../../shared/id";
import { orderDashboardGroups } from "../../../shared/layout";
import type { DashboardData, DashboardGroup, DashboardService, ServiceStatusSource } from "../../../shared/types";
import { ServiceCardPreview } from "../../components/DashboardView";
import { ServiceIcon } from "../../components/ServiceIcon";
import { api } from "../../lib/api";
import { IconPickerField } from "./IconPickerField";
import { Button, ConfirmDialog, EmptyState, Field, IconButton, Notice, SelectField, ToggleRow } from "./ui";

type CommitDashboard = (next: DashboardData, successMessage?: string) => Promise<void>;

interface ServicesTabProps {
  data: DashboardData;
  onCommit: CommitDashboard;
}

interface SortableItemProps {
  id: string;
  children: (attributes: ReturnType<typeof useSortable>["attributes"], listeners: ReturnType<typeof useSortable>["listeners"]) => React.ReactNode;
}

function SortableItem({ id, children }: SortableItemProps) {
  const sortable = useSortable({ id });
  const style = {
    "--admin-sort-x": `${sortable.transform?.x ?? 0}px`,
    "--admin-sort-y": `${sortable.transform?.y ?? 0}px`,
  } as React.CSSProperties;

  return (
    <div
      ref={sortable.setNodeRef}
      className={`admin-sortable ${sortable.isDragging ? "admin-sortable--dragging" : ""}`}
      style={style}
    >
      {children(sortable.attributes, sortable.listeners)}
    </div>
  );
}

function reindexGroups(groups: DashboardGroup[]) {
  return groups.map((group, index) => ({ ...group, position: index }));
}

function reindexServices(services: DashboardService[]) {
  return services.map((service, index) => ({ ...service, position: index }));
}

function blankService(groupId: string, position: number): DashboardService {
  return {
    id: createClientId("service"),
    groupId,
    name: "",
    href: "",
    description: "",
    icon: "",
    dockerServer: "",
    container: "",
    position,
    visible: true,
    statusCheck: false,
    statusSource: "http",
    status: "unknown",
  };
}

type ServiceEditorSection = "general" | "status" | "plugin" | "layout";
type MobileServicesView = "groups" | "services" | "inspector";

function serviceStatusLabel(service: DashboardService) {
  if (!service.statusCheck) return "No check";
  if (service.status === "healthy") return "Online";
  if (service.status === "unhealthy") return "Down";
  if (service.status === "checking") return "Checking";
  return "Unknown";
}

export function ServicesTab({ data, onCommit }: ServicesTabProps) {
  const sortedGroups = useMemo(() => orderDashboardGroups(data.groups), [data.groups]);
  const [selectedGroupId, setSelectedGroupId] = useState(sortedGroups[0]?.id ?? "");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupIcon, setGroupIcon] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [showGroupEditor, setShowGroupEditor] = useState(false);
  const [groupQuery, setGroupQuery] = useState("");
  const [query, setQuery] = useState("");
  const [serviceForm, setServiceForm] = useState<DashboardService | null>(null);
  const [creatingService, setCreatingService] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ type: "group" | "service"; name: string } | null>(null);
  const [serviceSection, setServiceSection] = useState<ServiceEditorSection>("general");
  const [mobileView, setMobileView] = useState<MobileServicesView>("groups");
  const [pluginUsername, setPluginUsername] = useState("");
  const [pluginStoredUsername, setPluginStoredUsername] = useState("");
  const [pluginPassword, setPluginPassword] = useState("");
  const [pluginPasswordConfigured, setPluginPasswordConfigured] = useState(false);
  const [pluginSystems, setPluginSystems] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [pluginEndpoints, setPluginEndpoints] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [pluginNodes, setPluginNodes] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [pluginMonitors, setPluginMonitors] = useState<Array<{ id: string; name: string; type: string; status: string }>>([]);
  const [pluginInterfaces, setPluginInterfaces] = useState<Array<{ name: string; type: string; running: boolean; disabled: boolean }>>([]);
  const [pluginState, setPluginState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [pluginMessage, setPluginMessage] = useState("");
  const [groupIconUploading, setGroupIconUploading] = useState(false);
  const [serviceIconUploading, setServiceIconUploading] = useState(false);
  const groupSaveInFlightRef = useRef<{ signature: string; promise: Promise<void> } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const selectedGroup = sortedGroups.find((group) => group.id === selectedGroupId) ?? sortedGroups[0];
  const filteredGroups = useMemo(() => {
    const needle = groupQuery.trim().toLocaleLowerCase();
    if (!needle) return sortedGroups;
    return sortedGroups.filter((group) => group.name.toLocaleLowerCase().includes(needle));
  }, [groupQuery, sortedGroups]);
  const sortedServices = useMemo(
    () => [...(selectedGroup?.services ?? [])].sort((a, b) => a.position - b.position),
    [selectedGroup],
  );
  const filteredServices = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return sortedServices;
    return sortedServices.filter((service) =>
      `${service.name} ${service.description} ${service.href}`.toLocaleLowerCase().includes(needle),
    );
  }, [query, sortedServices]);
  const selectedService = sortedServices.find((service) => service.id === selectedServiceId);
  const selectedDockerConnection = serviceForm
    ? data.connections.find((connection) =>
        connection.id === serviceForm.dockerServer ||
        connection.name.toLocaleLowerCase() === serviceForm.dockerServer.toLocaleLowerCase(),
      )
    : undefined;
  const dockerConnectionValue = selectedDockerConnection?.id ?? serviceForm?.dockerServer ?? "";
  const hasMissingDockerConnection = Boolean(serviceForm?.dockerServer && !selectedDockerConnection);
  const statusSource: ServiceStatusSource = serviceForm?.statusSource
    ?? (serviceForm?.dockerServer || serviceForm?.container ? "docker" : "http");
  const hasUptimeKumaMonitor = serviceForm?.plugin?.type === "uptime-kuma"
    && typeof serviceForm.plugin.config.monitorId === "string"
    && Boolean(serviceForm.plugin.config.monitorId.trim());
  const previewHasSavedProvider = Boolean(
    !creatingService
    && serviceForm?.plugin
    && selectedService?.plugin?.type === serviceForm.plugin.type,
  );
  const previewService = serviceForm?.plugin && !previewHasSavedProvider
    ? { ...serviceForm, plugin: { ...serviceForm.plugin, enabled: false } }
    : serviceForm;

  useEffect(() => {
    const selectionExists = sortedGroups.some((group) => group.id === selectedGroupId);
    if (!selectionExists) setSelectedGroupId(sortedGroups[0]?.id ?? "");
  }, [selectedGroupId, sortedGroups]);

  useEffect(() => {
    setGroupName(selectedGroup?.name ?? "");
    setGroupIcon(selectedGroup?.icon ?? "");
  }, [selectedGroup?.id, selectedGroup?.name, selectedGroup?.icon]);

  useEffect(() => {
    if (creatingService) return;
    const nextService = selectedService ?? sortedServices[0] ?? null;
    setSelectedServiceId(nextService?.id ?? "");
    setServiceForm(nextService ? { ...nextService } : null);
  }, [selectedGroup?.id, selectedService?.id, selectedService?.name, sortedServices.length, creatingService]);

  useEffect(() => {
    setPluginUsername("");
    setPluginStoredUsername("");
    setPluginPassword("");
    setPluginPasswordConfigured(false);
    setPluginSystems([]);
    setPluginEndpoints([]);
    setPluginNodes([]);
    setPluginMonitors([]);
    setPluginInterfaces([]);
    setPluginState("idle");
    setPluginMessage("");
    if (!serviceForm?.id || creatingService || !serviceForm.plugin) return;
    let active = true;
    api<{ username: string; passwordConfigured: boolean }>(
      `/api/services/${encodeURIComponent(serviceForm.id)}/plugin/credentials`,
    ).then((credentials) => {
      if (!active) return;
      setPluginUsername(credentials.username);
      setPluginStoredUsername(credentials.username);
      setPluginPasswordConfigured(credentials.passwordConfigured);
    }).catch((error) => {
      if (!active) return;
      setPluginState("error");
      setPluginMessage(error instanceof Error ? error.message : "Could not load plugin credentials.");
    });
    return () => { active = false; };
  }, [serviceForm?.id, serviceForm?.plugin?.type, creatingService]);

  function selectGroup(id: string) {
    setSelectedGroupId(id);
    setSelectedServiceId("");
    setCreatingService(false);
    setServiceForm(null);
    setQuery("");
    setServiceSection("general");
    setShowGroupEditor(false);
    setMobileView("services");
  }

  function selectService(service: DashboardService) {
    setSelectedServiceId(service.id);
    setServiceForm({ ...service });
    setCreatingService(false);
    setServiceSection("general");
    setMobileView("inspector");
  }

  async function commit(next: DashboardData, message: string) {
    setBusy(true);
    try {
      await onCommit(next, message);
    } finally {
      setBusy(false);
    }
  }

  async function addGroup(event: FormEvent) {
    event.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    const group: DashboardGroup = {
      id: createClientId("group"),
      name,
      icon: "",
      columnSpan: 1,
      columnStart: 0,
      gapBefore: 0,
      position: data.groups.length,
      visible: true,
      visibility: "everyone",
      services: [],
    };
    await commit({ ...data, groups: [...data.groups, group] }, "Group added");
    setNewGroupName("");
    setShowAddGroup(false);
    setSelectedGroupId(group.id);
    setMobileView("services");
  }

  async function saveGroup(iconOverride?: string) {
    if (!selectedGroup || !groupName.trim()) return;
    const nextIcon = normalizeIconReference(iconOverride ?? groupIcon);
    const signature = [selectedGroup.id, groupName.trim(), nextIcon].join("\u0000");
    if (groupSaveInFlightRef.current?.signature === signature) {
      await groupSaveInFlightRef.current.promise;
      return;
    }
    const groups = data.groups.map((group) =>
      group.id === selectedGroup.id
        ? {
            ...group,
            name: groupName.trim(),
            icon: nextIcon,
          }
        : group,
    );
    const promise = commit({ ...data, groups }, "Group saved");
    groupSaveInFlightRef.current = { signature, promise };
    try {
      await promise;
      setShowGroupEditor(false);
    } finally {
      if (groupSaveInFlightRef.current?.promise === promise) groupSaveInFlightRef.current = null;
    }
  }

  async function setGroupVisibility(visibility: "everyone" | "signed-in" | "hidden") {
    if (!selectedGroup) return;
    const groups = data.groups.map((group) => group.id === selectedGroup.id ? { ...group, visibility, visible: visibility !== "hidden" } : group);
    await commit({ ...data, groups }, "Group visibility saved");
  }

  async function deleteGroup() {
    if (!selectedGroup) return;
    const groups = reindexGroups(data.groups.filter((group) => group.id !== selectedGroup.id));
    await commit({ ...data, groups }, "Group deleted");
    setSelectedGroupId(groups[0]?.id ?? "");
    setSelectedServiceId("");
    setServiceForm(null);
    setShowGroupEditor(false);
    setMobileView("groups");
    setPendingDelete(null);
  }

  function startService() {
    if (!selectedGroup) return;
    const draft = blankService(selectedGroup.id, sortedServices.length);
    setServiceForm(draft);
    setCreatingService(true);
    setSelectedServiceId("");
    setServiceSection("general");
    setMobileView("inspector");
  }

  function discardServiceChanges() {
    if (creatingService) {
      setCreatingService(false);
      const fallback = selectedService ?? sortedServices[0] ?? null;
      setSelectedServiceId(fallback?.id ?? "");
      setServiceForm(fallback ? { ...fallback } : null);
      setMobileView(fallback ? "inspector" : "services");
      return;
    }
    setServiceForm(selectedService ? { ...selectedService } : null);
    setServiceSection("general");
    setPluginUsername(pluginStoredUsername);
    setPluginPassword("");
    setPluginState("idle");
    setPluginMessage("");
  }

  function choosePlugin(type: string) {
    if (!serviceForm) return;
    if (!["beszel", "portainer", "proxmox", "uptime-kuma", "jellyfin", "plex", "mikrotik", "radarr", "sonarr", "lidarr", "prowlarr", "bazarr", "qbittorrent", "nginx-proxy-manager", "steam-wishlist"].includes(type)) {
      setServiceForm({
        ...serviceForm,
        plugin: undefined,
        ...(statusSource === "uptime-kuma" ? { statusSource: "http" as const } : {}),
      });
      setPluginUsername("");
      setPluginStoredUsername("");
      setPluginPassword("");
      setPluginPasswordConfigured(false);
      setPluginSystems([]);
      setPluginEndpoints([]);
      setPluginNodes([]);
      setPluginMonitors([]);
      setPluginInterfaces([]);
      setPluginState("idle");
      setPluginMessage("");
      return;
    }
    const existing = serviceForm.plugin?.type === type ? serviceForm.plugin : undefined;
    setServiceForm({
      ...serviceForm,
      ...(type !== "uptime-kuma" && statusSource === "uptime-kuma" ? { statusSource: "http" as const } : {}),
      plugin: existing ?? (type === "beszel"
        ? { type: "beszel", enabled: true, presentation: "expanded", config: { url: "", version: 2, systemId: "" } }
        : type === "portainer"
          ? { type: "portainer", enabled: true, presentation: "summary", config: { url: "", endpointId: "" } }
          : type === "proxmox"
            ? { type: "proxmox", enabled: true, presentation: "summary", config: { url: "", node: "" } }
          : type === "uptime-kuma"
            ? { type: "uptime-kuma", enabled: true, presentation: "summary", config: { url: "", monitorId: "" } }
          : type === "mikrotik"
            ? { type: "mikrotik", enabled: true, presentation: "summary", config: { url: "", interfaceName: "" } }
          : type === "steam-wishlist"
            ? { type: "steam-wishlist", enabled: true, presentation: "expanded", config: { countryCode: "SK", language: "english", minDiscount: 20, maxItems: 3, sortBy: "discount", refreshMinutes: 360 } }
            : { type: type as "jellyfin" | "plex" | "mikrotik" | "radarr" | "sonarr" | "lidarr" | "prowlarr" | "bazarr" | "qbittorrent" | "nginx-proxy-manager", enabled: true, presentation: "summary", config: { url: "" } }),
    });
    if (!existing) {
      setPluginUsername("");
      setPluginStoredUsername("");
      setPluginPassword("");
      setPluginPasswordConfigured(false);
      setPluginSystems([]);
      setPluginEndpoints([]);
      setPluginNodes([]);
      setPluginMonitors([]);
      setPluginInterfaces([]);
      setPluginState("idle");
      setPluginMessage("");
    }
  }

  function updatePluginConfig(changes: Record<string, unknown>) {
    if (!serviceForm?.plugin) return;
    const clearsUptimeMonitor = serviceForm.plugin.type === "uptime-kuma"
      && "monitorId" in changes
      && (typeof changes.monitorId !== "string" || !changes.monitorId.trim());
    setServiceForm({
      ...serviceForm,
      ...(clearsUptimeMonitor && statusSource === "uptime-kuma" ? { statusSource: "http" as const } : {}),
      plugin: { ...serviceForm.plugin, config: { ...serviceForm.plugin.config, ...changes } },
    });
  }

  async function testPluginConnection() {
    if (!serviceForm?.plugin || creatingService) return;
    setPluginState("loading");
    setPluginMessage("");
    try {
      if (serviceForm.plugin.type === "beszel") {
        const result = await api<{ systems: Array<{ id: string; name: string; status: string }>; total: number; up: number }>(
          `/api/services/${encodeURIComponent(serviceForm.id)}/plugin/test`,
          {
            method: "POST",
            body: JSON.stringify({
              type: "beszel",
              config: {
                url: String(serviceForm.plugin.config.url ?? ""),
                version: Number(serviceForm.plugin.config.version ?? 2),
                systemId: String(serviceForm.plugin.config.systemId ?? ""),
              },
              credentials: {
                username: pluginUsername,
                ...(pluginPassword ? { password: pluginPassword } : {}),
              },
            }),
          },
        );
        setPluginSystems(result.systems);
        setPluginMessage(`Connected to Beszel: ${result.up} of ${result.total} systems are up.`);
      } else if (serviceForm.plugin.type === "portainer") {
        const result = await api<{ endpoints: Array<{ id: string; name: string; status: string }>; total: number; online: number }>(
          `/api/services/${encodeURIComponent(serviceForm.id)}/plugin/test`,
          {
            method: "POST",
            body: JSON.stringify({
              type: "portainer",
              config: {
                url: String(serviceForm.plugin.config.url ?? ""),
                endpointId: String(serviceForm.plugin.config.endpointId ?? ""),
              },
              credentials: { ...(pluginPassword ? { apiKey: pluginPassword } : {}) },
            }),
          },
        );
        setPluginEndpoints(result.endpoints);
        setPluginMessage(`Connected to Portainer: ${result.online} of ${result.total} environments are online.`);
      } else if (serviceForm.plugin.type === "proxmox") {
        const result = await api<{
          cluster: { name: string; version: string };
          availableNodes: Array<{ id: string; name: string; status: string }>;
          nodes: { total: number; online: number };
          guests: { total: number; running: number };
        }>(
          `/api/services/${encodeURIComponent(serviceForm.id)}/plugin/test`,
          {
            method: "POST",
            body: JSON.stringify({
              type: "proxmox",
              config: {
                url: String(serviceForm.plugin.config.url ?? ""),
                node: String(serviceForm.plugin.config.node ?? ""),
              },
              credentials: { username: pluginUsername, ...(pluginPassword ? { password: pluginPassword } : {}) },
            }),
          },
        );
        setPluginNodes(result.availableNodes);
        const version = result.cluster.version ? ` ${result.cluster.version}` : "";
        setPluginMessage(`Connected to ${result.cluster.name}${version}: ${result.nodes.online} of ${result.nodes.total} nodes online and ${result.guests.running} of ${result.guests.total} guests running.`);
      } else if (serviceForm.plugin.type === "uptime-kuma") {
        const result = await api<{
          availableMonitors: Array<{ id: string; name: string; type: string; status: string }>;
          monitors: { total: number; up: number; down: number; pending: number; maintenance: number };
        }>(
          `/api/services/${encodeURIComponent(serviceForm.id)}/plugin/test`,
          {
            method: "POST",
            body: JSON.stringify({
              type: "uptime-kuma",
              config: {
                url: String(serviceForm.plugin.config.url ?? ""),
                monitorId: String(serviceForm.plugin.config.monitorId ?? ""),
              },
              credentials: { ...(pluginPassword ? { apiKey: pluginPassword } : {}) },
            }),
          },
        );
        setPluginMonitors(result.availableMonitors);
        setPluginMessage(`Connected to Uptime Kuma: ${result.monitors.up} of ${result.monitors.total} monitors are up${result.monitors.down ? ` and ${result.monitors.down} are down` : ""}.`);
      } else if (serviceForm.plugin.type === "jellyfin") {
        const result = await api<{
          server: { name: string; version: string };
          sessions: { connected: number; playing: number };
          library: { movies: number; series: number };
        }>(
          `/api/services/${encodeURIComponent(serviceForm.id)}/plugin/test`,
          {
            method: "POST",
            body: JSON.stringify({
              type: "jellyfin",
              config: { url: String(serviceForm.plugin.config.url ?? "") },
              credentials: { ...(pluginPassword ? { apiKey: pluginPassword } : {}) },
            }),
          },
        );
        const version = result.server.version ? ` ${result.server.version}` : "";
        setPluginMessage(`Connected to ${result.server.name}${version}: ${result.sessions.playing} playing, ${result.library.movies} movies, ${result.library.series} series.`);
      } else if (serviceForm.plugin.type === "plex") {
        const result = await api<{
          server: { name: string; version: string };
          sessions: { total: number; playing: number; transcoding: number };
          library: { movies: number; shows: number; albums: number };
        }>(
          `/api/services/${encodeURIComponent(serviceForm.id)}/plugin/test`,
          {
            method: "POST",
            body: JSON.stringify({
              type: "plex",
              config: { url: String(serviceForm.plugin.config.url ?? "") },
              credentials: { ...(pluginPassword ? { token: pluginPassword } : {}) },
            }),
          },
        );
        const version = result.server.version ? ` ${result.server.version}` : "";
        setPluginMessage(`Connected to ${result.server.name}${version}: ${result.sessions.playing} playing, ${result.library.movies} movies, ${result.library.shows} shows and ${result.library.albums} albums.`);
      } else if (serviceForm.plugin.type === "mikrotik") {
        const result = await api<{
          router: { name: string; version: string; boardName: string };
          system: { uptime: string; cpuLoad: number; memoryUsedPercent: number };
          dhcp: { leases: number; active: number };
          interfaces: { total: number; running: number };
          interfaceOptions: Array<{ name: string; type: string; running: boolean; disabled: boolean }>;
        }>(
          `/api/services/${encodeURIComponent(serviceForm.id)}/plugin/test`,
          {
            method: "POST",
            body: JSON.stringify({
              type: "mikrotik",
              config: {
                url: String(serviceForm.plugin.config.url ?? ""),
                interfaceName: String(serviceForm.plugin.config.interfaceName ?? ""),
              },
              credentials: { username: pluginUsername, ...(pluginPassword ? { password: pluginPassword } : {}) },
            }),
          },
        );
        setPluginInterfaces(result.interfaceOptions);
        const version = result.router.version ? ` ${result.router.version}` : "";
        setPluginMessage(`Connected to ${result.router.name}${version}: CPU ${result.system.cpuLoad}%, RAM ${result.system.memoryUsedPercent}%, ${result.dhcp.active} active leases and ${result.interfaces.running} running interfaces. Choose the WAN interface used by the Network traffic widget.`);
      } else if (serviceForm.plugin.type === "radarr" || serviceForm.plugin.type === "sonarr") {
        const provider = serviceForm.plugin.type;
        const result = await api<{
          server: { name: string; version: string };
          queue: number;
          wanted: number;
          library: { items: number; monitored: number; files: number; episodes: number };
        }>(
          `/api/services/${encodeURIComponent(serviceForm.id)}/plugin/test`,
          {
            method: "POST",
            body: JSON.stringify({
              type: provider,
              config: { url: String(serviceForm.plugin.config.url ?? "") },
              credentials: { ...(pluginPassword ? { apiKey: pluginPassword } : {}) },
            }),
          },
        );
        const version = result.server.version ? ` ${result.server.version}` : "";
        const itemLabel = provider === "radarr" ? "movies" : "series";
        setPluginMessage(`Connected to ${result.server.name}${version}: ${result.library.items} ${itemLabel}, ${result.wanted} wanted, ${result.queue} queued.`);
      } else if (serviceForm.plugin.type === "lidarr") {
        const result = await api<{
          server: { name: string; version: string };
          queue: number;
          wanted: number;
          library: { artists: number; monitoredArtists: number; albums: number; tracks: number; trackFiles: number };
        }>(
          `/api/services/${encodeURIComponent(serviceForm.id)}/plugin/test`,
          {
            method: "POST",
            body: JSON.stringify({
              type: "lidarr",
              config: { url: String(serviceForm.plugin.config.url ?? "") },
              credentials: { ...(pluginPassword ? { apiKey: pluginPassword } : {}) },
            }),
          },
        );
        const version = result.server.version ? ` ${result.server.version}` : "";
        setPluginMessage(`Connected to ${result.server.name}${version}: ${result.library.artists} artists, ${result.library.albums} albums, ${result.wanted} wanted, ${result.queue} queued.`);
      } else if (serviceForm.plugin.type === "prowlarr") {
        const result = await api<{ indexers: number; queries: number; grabs: number; failedQueries: number; failedGrabs: number }>(
          `/api/services/${encodeURIComponent(serviceForm.id)}/plugin/test`,
          { method: "POST", body: JSON.stringify({ type: "prowlarr", config: { url: String(serviceForm.plugin.config.url ?? "") }, credentials: { ...(pluginPassword ? { apiKey: pluginPassword } : {}) } }) },
        );
        setPluginMessage(`Connected to Prowlarr: ${result.indexers} indexers, ${result.queries} queries and ${result.grabs} grabs.`);
      } else if (serviceForm.plugin.type === "bazarr") {
        const result = await api<{ missingEpisodes: number; missingMovies: number }>(
          `/api/services/${encodeURIComponent(serviceForm.id)}/plugin/test`,
          { method: "POST", body: JSON.stringify({ type: "bazarr", config: { url: String(serviceForm.plugin.config.url ?? "") }, credentials: { ...(pluginPassword ? { apiKey: pluginPassword } : {}) } }) },
        );
        setPluginMessage(`Connected to Bazarr: ${result.missingEpisodes} missing episodes and ${result.missingMovies} missing movies.`);
      } else if (serviceForm.plugin.type === "qbittorrent") {
        const result = await api<{ version: string; connectionStatus: string; downloadSpeed: number; uploadSpeed: number; torrents: { total: number; active: number } }>(
          `/api/services/${encodeURIComponent(serviceForm.id)}/plugin/test`,
          { method: "POST", body: JSON.stringify({ type: "qbittorrent", config: { url: String(serviceForm.plugin.config.url ?? "") }, credentials: { username: pluginUsername, ...(pluginPassword ? { password: pluginPassword } : {}) } }) },
        );
        setPluginMessage(`Connected to qBittorrent ${result.version}: ${result.torrents.active} of ${result.torrents.total} torrents active.`);
      } else if (serviceForm.plugin.type === "steam-wishlist") {
        const result = await api<{ totalWishlist: number; onSale: number; shown: number; highestDiscount: number }>(
          `/api/services/${encodeURIComponent(serviceForm.id)}/plugin/test`,
          {
            method: "POST",
            body: JSON.stringify({
              type: "steam-wishlist",
              config: {
                countryCode: String(serviceForm.plugin.config.countryCode ?? "SK"),
                language: String(serviceForm.plugin.config.language ?? "english"),
                minDiscount: Number(serviceForm.plugin.config.minDiscount ?? 20),
                maxItems: Number(serviceForm.plugin.config.maxItems ?? 3),
                sortBy: String(serviceForm.plugin.config.sortBy ?? "discount"),
                refreshMinutes: Number(serviceForm.plugin.config.refreshMinutes ?? 360),
              },
              credentials: { username: pluginUsername },
            }),
          },
        );
        setPluginMessage(`Connected to Steam: ${result.onSale} of ${result.totalWishlist} wishlist games are on sale${result.highestDiscount ? `, up to ${result.highestDiscount}% off` : ""}.`);
      } else {
        const result = await api<{ proxyHosts: { total: number; enabled: number; online: number; offline: number; withSsl: number }; redirectionHosts: { total: number; enabled: number; online: number }; deadHosts: { total: number; enabled: number; online: number }; streams: { total: number; enabled: number; online: number } }>(
          `/api/services/${encodeURIComponent(serviceForm.id)}/plugin/test`,
          { method: "POST", body: JSON.stringify({ type: "nginx-proxy-manager", config: { url: String(serviceForm.plugin.config.url ?? "") }, credentials: { username: pluginUsername, ...(pluginPassword ? { password: pluginPassword } : {}) } }) },
        );
        setPluginMessage(`Connected to Nginx Proxy Manager: ${result.proxyHosts.online} of ${result.proxyHosts.enabled} proxy hosts online, ${result.proxyHosts.withSsl} using SSL.`);
      }
      setPluginState("success");
    } catch (error) {
      setPluginState("error");
      setPluginMessage(error instanceof Error ? error.message : "Could not connect to the service plugin.");
    }
  }

  async function saveService(event: FormEvent) {
    event.preventDefault();
    if (!selectedGroup || !serviceForm || !serviceForm.name.trim() || !serviceForm.href.trim()) return;
    const targetGroup = data.groups.find((group) => group.id === serviceForm.groupId) ?? selectedGroup;
    const movedToAnotherGroup = targetGroup.id !== selectedGroup.id;
    const cleanService: DashboardService = {
      ...serviceForm,
      groupId: targetGroup.id,
      name: serviceForm.name.trim(),
      href: serviceForm.href.trim(),
      description: serviceForm.description.trim(),
      icon: normalizeIconReference(serviceForm.icon),
      dockerServer: selectedDockerConnection?.id ?? serviceForm.dockerServer.trim(),
      container: serviceForm.container.trim(),
      position: movedToAnotherGroup ? targetGroup.services.length : serviceForm.position,
      statusSource,
    };
    const groups = data.groups.map((group) => {
      const withoutEditedService = group.services.filter((service) => service.id !== cleanService.id);
      if (group.id !== targetGroup.id) {
        return withoutEditedService.length === group.services.length
          ? group
          : { ...group, services: reindexServices(withoutEditedService) };
      }
      const services = movedToAnotherGroup || creatingService
        ? [...withoutEditedService, cleanService]
        : group.services.map((service) => service.id === cleanService.id ? cleanService : service);
      return { ...group, services: reindexServices(services) };
    });
    await commit({ ...data, groups }, creatingService ? "Service added" : "Service saved");
    setSelectedGroupId(targetGroup.id);
    setSelectedServiceId(cleanService.id);
    setCreatingService(false);
    if (cleanService.plugin) {
      setPluginState("loading");
      try {
        const credentials = await api<{ username: string; passwordConfigured: boolean }>(
          `/api/services/${encodeURIComponent(cleanService.id)}/plugin/credentials`,
          {
            method: "PUT",
            body: JSON.stringify(cleanService.plugin.type === "steam-wishlist"
              ? { username: pluginUsername }
              : cleanService.plugin.type === "beszel" || cleanService.plugin.type === "proxmox" || cleanService.plugin.type === "mikrotik" || cleanService.plugin.type === "qbittorrent" || cleanService.plugin.type === "nginx-proxy-manager"
              ? { username: pluginUsername, ...(pluginPassword ? { password: pluginPassword } : {}) }
              : cleanService.plugin.type === "plex"
                ? { ...(pluginPassword ? { token: pluginPassword } : {}) }
                : { ...(pluginPassword ? { apiKey: pluginPassword } : {}) }),
          },
        );
        setPluginPassword("");
        setPluginUsername(credentials.username);
        setPluginStoredUsername(credentials.username);
        setPluginPasswordConfigured(credentials.passwordConfigured);
        setPluginState("success");
        setPluginMessage("Service and plugin settings saved.");
      } catch (error) {
        setPluginState("error");
        setPluginMessage(error instanceof Error ? error.message : "Service saved, but plugin credentials could not be saved.");
      }
    }
  }

  async function deleteService() {
    if (!selectedGroup || !serviceForm) return;
    if (creatingService) {
      setCreatingService(false);
      setServiceForm(selectedService ? { ...selectedService } : null);
      return;
    }
    const services = reindexServices(selectedGroup.services.filter((service) => service.id !== serviceForm.id));
    const groups = data.groups.map((group) => group.id === selectedGroup.id ? { ...group, services } : group);
    await commit({ ...data, groups }, "Service deleted");
    setSelectedServiceId(services[0]?.id ?? "");
    setServiceForm(services[0] ? { ...services[0] } : null);
    setPendingDelete(null);
  }

  async function reorderGroups(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = sortedGroups.findIndex((group) => `group:${group.id}` === event.active.id);
    const newIndex = sortedGroups.findIndex((group) => `group:${group.id}` === event.over?.id);
    if (oldIndex < 0 || newIndex < 0) return;
    await commit({ ...data, groups: reindexGroups(arrayMove(sortedGroups, oldIndex, newIndex)) }, "Order saved");
  }

  async function reorderServices(event: DragEndEvent) {
    if (!selectedGroup || !event.over || event.active.id === event.over.id) return;
    const oldIndex = sortedServices.findIndex((service) => `service:${service.id}` === event.active.id);
    const newIndex = sortedServices.findIndex((service) => `service:${service.id}` === event.over?.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const services = reindexServices(arrayMove(sortedServices, oldIndex, newIndex));
    const groups = data.groups.map((group) => group.id === selectedGroup.id ? { ...group, services } : group);
    await commit({ ...data, groups }, "Order saved");
  }

  return (
    <div className={`admin-services-layout admin-services-layout--${mobileView}`}>
      <section className="admin-list-pane admin-list-pane--groups" aria-label="Service groups">
        <header className="admin-pane-heading">
          <span><small>Dashboard structure</small><h2>Service groups</h2></span>
          <IconButton label="Add group" onClick={() => setShowAddGroup((value) => !value)}>
            <Plus size={17} />
          </IconButton>
        </header>
        {showAddGroup ? (
          <form className="admin-quick-add" onSubmit={addGroup}>
            <input
              className="ui-input"
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              placeholder="Group name"
              autoFocus
            />
            <Button variant="primary" type="submit" disabled={!newGroupName.trim() || busy}>Add</Button>
          </form>
        ) : null}
        <label className="admin-list-search">
          <Search size={16} />
          <input value={groupQuery} onChange={(event) => setGroupQuery(event.target.value)} placeholder="Search groups…" />
        </label>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorderGroups}>
          <SortableContext items={filteredGroups.map((group) => `group:${group.id}`)} strategy={verticalListSortingStrategy}>
            <div className="admin-group-list">
              {filteredGroups.map((group) => (
                <SortableItem key={group.id} id={`group:${group.id}`}>
                  {(attributes, listeners) => (
                    <div className={`admin-group-row ${selectedGroup?.id === group.id ? "admin-group-row--active" : ""}`}>
                      <button className="admin-drag-handle" {...attributes} {...listeners} aria-label={`Reorder ${group.name}`}>
                        <GripVertical size={16} />
                      </button>
                      <button className="admin-group-row__select" onClick={() => selectGroup(group.id)}>
                        {group.icon.trim() ? (
                          <ServiceIcon icon={group.icon} name={group.name} className="admin-group-icon" />
                        ) : (
                          <Layers3 size={16} />
                        )}
                        <span>
                          <strong>{group.name}</strong>
                          <small>{group.services.length} {group.services.length === 1 ? "service" : "services"} · {group.visibility === "signed-in" ? "Signed-in only" : group.visible ? "Everyone" : "Hidden"}</small>
                        </span>
                      </button>
                      {group.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                      <ChevronRight size={15} />
                    </div>
                  )}
                </SortableItem>
              ))}
            </div>
          </SortableContext>
        </DndContext>
        {sortedGroups.length === 0 ? (
          <EmptyState icon={<Layers3 size={22} />} title="No groups yet" action={<Button onClick={() => setShowAddGroup(true)}>Add a group</Button>}>
            Groups keep related services together on your dashboard.
          </EmptyState>
        ) : null}
        {sortedGroups.length > 0 && filteredGroups.length === 0 ? (
          <EmptyState icon={<Search size={22} />} title="No matching groups">
            Try a different search.
          </EmptyState>
        ) : null}
        {selectedGroup && showGroupEditor ? (
          <div className="admin-group-editor">
            <header>
              <span><small>Group settings</small><strong>{selectedGroup.name}</strong></span>
              <button type="button" onClick={() => setShowGroupEditor(false)} aria-label="Close group settings">×</button>
            </header>
            <Field label="Group name" value={groupName} onChange={(event) => setGroupName(event.target.value)} />
            <IconPickerField
              key={`group-icon-${selectedGroup.id}`}
              value={groupIcon}
              name={groupName || selectedGroup.name}
              label="Group icon"
              onChange={setGroupIcon}
              onApply={(icon) => saveGroup(icon)}
              onUploadingChange={setGroupIconUploading}
            />
            <SelectField label="Group visibility" value={selectedGroup.visibility ?? (selectedGroup.visible ? "everyone" : "hidden")} onChange={(value) => void setGroupVisibility(value as "everyone" | "signed-in" | "hidden")} disabled={busy || groupIconUploading}>
              <option value="everyone">Everyone</option>
              <option value="signed-in">Signed-in only</option>
              <option value="hidden">Hidden</option>
            </SelectField>
            <div className="admin-inline-actions admin-inline-actions--spread">
              <Button variant="danger" type="button" onClick={() => selectedGroup && setPendingDelete({ type: "group", name: selectedGroup.name })} disabled={busy || groupIconUploading}><Trash2 size={15} /> Delete</Button>
              <Button variant="primary" type="button" onClick={() => void saveGroup()} disabled={!groupName.trim() || busy || groupIconUploading}>Save group</Button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="admin-list-pane admin-list-pane--services" aria-label="Services in selected group">
        <header className="admin-pane-heading">
          <button className="admin-pane-back" type="button" onClick={() => setMobileView("groups")} aria-label="Back to groups"><ArrowLeft size={17} /></button>
          <span><small>{selectedGroup?.name ?? "Select a group"}</small><h2>Services</h2></span>
          <span className="admin-pane-heading__actions">
            <IconButton label="Edit selected group" onClick={() => { setShowGroupEditor((value) => !value); setMobileView("groups"); }} disabled={!selectedGroup}><Layers3 size={16} /></IconButton>
            <Button variant="primary" onClick={startService} disabled={!selectedGroup}>
              <Plus size={16} /> Add service
            </Button>
          </span>
        </header>
        <label className="admin-list-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter services…" />
        </label>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorderServices}>
          <SortableContext items={filteredServices.map((service) => `service:${service.id}`)} strategy={verticalListSortingStrategy}>
            <div className="admin-service-list">
              {filteredServices.map((service) => (
                <SortableItem key={service.id} id={`service:${service.id}`}>
                  {(attributes, listeners) => (
                    <div className={`admin-service-row ${selectedServiceId === service.id && !creatingService ? "admin-service-row--active" : ""}`}>
                      <button className="admin-drag-handle" {...attributes} {...listeners} aria-label={`Reorder ${service.name}`}>
                        <GripVertical size={16} />
                      </button>
                      <button className="admin-service-row__select" onClick={() => selectService(service)}>
                        <ServiceIcon icon={service.icon} name={service.name} className="admin-service-icon" />
                        <span><strong>{service.name}</strong><small>{service.description || service.href}</small></span>
                      </button>
                      <span className={`admin-service-row__status admin-service-row__status--${service.statusCheck ? service.status : "disabled"}`}>
                        <i className={`admin-status-dot admin-status-dot--${service.statusCheck ? service.status : "disabled"}`} aria-hidden="true" />
                        {serviceStatusLabel(service)}
                      </span>
                    </div>
                  )}
                </SortableItem>
              ))}
            </div>
          </SortableContext>
        </DndContext>
        {selectedGroup && filteredServices.length === 0 ? (
          <EmptyState
            icon={<Box size={22} />}
            title={query ? "No matching services" : "This group is empty"}
            action={!query ? <Button onClick={startService}>Add first service</Button> : undefined}
          >
            {query ? "Try a different search." : "Add a link, app, or Docker-backed service."}
          </EmptyState>
        ) : null}
      </section>

      <aside className="admin-inspector" aria-label="Service inspector">
        {serviceForm ? (
          <form className="admin-inspector__form" onSubmit={saveService}>
            <header className="admin-inspector__heading">
              <button className="admin-pane-back" type="button" onClick={() => setMobileView("services")} aria-label="Back to services"><ArrowLeft size={17} /></button>
              <ServiceIcon icon={serviceForm.icon} name={serviceForm.name || "Service"} className="admin-inspector__service-icon" />
              <span className="admin-inspector__identity">
                <small>{creatingService ? "New service" : "Service details"}</small>
                <h2>{serviceForm.name || "Untitled service"}</h2>
                <span>{serviceForm.href || "Add a service URL"}</span>
              </span>
              <span className={`admin-inspector__status admin-inspector__status--${serviceForm.statusCheck ? serviceForm.status : "disabled"}`}>
                <i className={`admin-status-dot admin-status-dot--${serviceForm.statusCheck ? serviceForm.status : "disabled"}`} aria-hidden="true" />
                {serviceStatusLabel(serviceForm)}
              </span>
            </header>
            <nav className="admin-service-editor-tabs" aria-label="Service settings">
              <button type="button" className={serviceSection === "general" ? "admin-service-editor-tabs__active" : ""} onClick={() => setServiceSection("general")}>General</button>
              <button type="button" className={serviceSection === "status" ? "admin-service-editor-tabs__active" : ""} onClick={() => setServiceSection("status")}>Status</button>
              <button type="button" className={serviceSection === "plugin" ? "admin-service-editor-tabs__active" : ""} onClick={() => setServiceSection("plugin")}><Plug size={14} /> Plugin</button>
              <button type="button" className={serviceSection === "layout" ? "admin-service-editor-tabs__active" : ""} onClick={() => setServiceSection("layout")}><LayoutGrid size={14} /> Layout</button>
            </nav>

            {serviceSection === "general" ? (
              <div className="admin-service-section">
                <div className="admin-form-grid">
                  <Field label="Name" value={serviceForm.name} onChange={(event) => setServiceForm({ ...serviceForm, name: event.target.value })} required />
                  <SelectField label="Group" value={serviceForm.groupId} onChange={(groupId) => setServiceForm({ ...serviceForm, groupId })}>
                    {sortedGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                  </SelectField>
                </div>
                <Field label="URL" type="url" value={serviceForm.href} onChange={(event) => setServiceForm({ ...serviceForm, href: event.target.value })} placeholder="https://…" required />
                <Field label="Description" value={serviceForm.description} onChange={(event) => setServiceForm({ ...serviceForm, description: event.target.value })} placeholder="A short helpful label" />
                <IconPickerField
                  key={`service-icon-${serviceForm.id}`}
                  value={serviceForm.icon}
                  name={serviceForm.name}
                  onChange={(icon) => setServiceForm((current) => current ? { ...current, icon } : current)}
                  onUploadingChange={setServiceIconUploading}
                />
                <ToggleRow title="Visible on dashboard" description="Hidden services remain configured but are not published." checked={serviceForm.visible} onChange={(visible) => setServiceForm({ ...serviceForm, visible })} />
              </div>
            ) : null}

            {serviceSection === "status" ? (
              <div className="admin-service-section">
                <div className="admin-form-divider"><Server size={15} /><span>Service status</span></div>
                <ToggleRow title="Show status indicator" description="Display a live status dot for this service." checked={serviceForm.statusCheck} onChange={(statusCheck) => setServiceForm({ ...serviceForm, statusCheck })} />
                {serviceForm.statusCheck ? (
                  <>
                    <SelectField label="Status source" value={statusSource} onChange={(value) => setServiceForm({ ...serviceForm, statusSource: value as ServiceStatusSource })}>
                      <option value="http">Direct HTTP request</option>
                      <option value="docker">Docker container</option>
                      {serviceForm.plugin?.type === "uptime-kuma" ? (
                        <option value="uptime-kuma" disabled={!hasUptimeKumaMonitor}>Uptime Kuma monitor{hasUptimeKumaMonitor ? "" : " (select one monitor first)"}</option>
                      ) : null}
                    </SelectField>
                    {statusSource === "http" ? (
                      <Notice kind="neutral">Dashcenter checks the service URL directly and accepts HTTP responses below 500 as reachable.</Notice>
                    ) : null}
                    {statusSource === "docker" ? (
                      <>
                        <SelectField label="Docker connection" value={dockerConnectionValue} onChange={(dockerServer) => setServiceForm({ ...serviceForm, dockerServer })}>
                          <option value="">Select a Docker connection</option>
                          {hasMissingDockerConnection ? (
                            <option value={serviceForm.dockerServer}>Missing connection: {serviceForm.dockerServer} (legacy)</option>
                          ) : null}
                          {data.connections.map((connection) => (
                            <option key={connection.id} value={connection.id}>
                              {connection.name}{connection.enabled ? "" : " (disabled)"}
                            </option>
                          ))}
                        </SelectField>
                        <Field label="Container" value={serviceForm.container} onChange={(event) => setServiceForm({ ...serviceForm, container: event.target.value })} placeholder="Container name" />
                      </>
                    ) : null}
                    {statusSource === "uptime-kuma" ? (
                      <Notice kind="neutral">The status dot follows the monitor selected in this service's Uptime Kuma plugin and reuses its server-side API key.</Notice>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}

            {serviceSection === "plugin" ? (
              <div className="admin-service-section admin-service-plugin">
                <div className="admin-service-plugin__intro">
                  <span><Plug size={17} /></span>
                  <span><strong>Native service plugin</strong><small>Display live provider data inside this service on the dashboard.</small></span>
                </div>
                <SelectField label="Provider" value={serviceForm.plugin?.type ?? ""} onChange={choosePlugin}>
                  <option value="">No plugin</option>
                  <option value="beszel">Beszel</option>
                  <option value="portainer">Portainer</option>
                  <option value="proxmox">Proxmox VE</option>
                  <option value="uptime-kuma">Uptime Kuma</option>
                  <option value="jellyfin">Jellyfin</option>
                  <option value="plex">Plex</option>
                  <option value="mikrotik">MikroTik</option>
                  <option value="radarr">Radarr</option>
                  <option value="sonarr">Sonarr</option>
                  <option value="lidarr">Lidarr</option>
                  <option value="prowlarr">Prowlarr</option>
                  <option value="bazarr">Bazarr</option>
                  <option value="qbittorrent">qBittorrent</option>
                  <option value="nginx-proxy-manager">Nginx Proxy Manager</option>
                  <option value="steam-wishlist">Steam wishlist deals</option>
                </SelectField>
                {serviceForm.plugin?.type === "beszel" ? (
                  <>
                    <div className="admin-form-divider"><Activity size={15} /><span>Beszel integration</span></div>
                    <ToggleRow title="Plugin enabled" description="Show Beszel data inside this service card." checked={serviceForm.plugin.enabled} onChange={(enabled) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, enabled } : undefined })} />
                    <SelectField label="Presentation" value={serviceForm.plugin.presentation} onChange={(presentation) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, presentation: presentation as "summary" | "expanded" } : undefined })}>
                      <option value="summary">Compact summary</option>
                      <option value="expanded">Expanded metrics</option>
                    </SelectField>
                    <Field label="Beszel URL" type="url" value={String(serviceForm.plugin.config.url ?? "")} onChange={(event) => updatePluginConfig({ url: event.target.value })} placeholder="http://beszel:8090" hint="Use the URL reachable from the Dashcenter container. Do not add /api." />
                    <SelectField label="Beszel version" value={Number(serviceForm.plugin.config.version ?? 2)} onChange={(version) => updatePluginConfig({ version: Number(version) })}>
                      <option value={2}>0.9.0 or newer</option>
                      <option value={1}>Older than 0.9.0</option>
                    </SelectField>
                    <Field label="Superuser email" type="email" value={pluginUsername} onChange={(event) => setPluginUsername(event.target.value)} autoComplete="username" />
                    <Field
                      label="Password"
                      type="password"
                      value={pluginPassword}
                      onChange={(event) => setPluginPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder={pluginPasswordConfigured ? "Stored on the server" : "Beszel superuser password"}
                      hint={pluginPasswordConfigured ? "Leave blank to keep the stored password." : "Credentials are never included in public dashboard data or backups."}
                    />
                    {pluginSystems.length > 0 ? (
                      <SelectField label="System" value={String(serviceForm.plugin.config.systemId ?? "")} onChange={(systemId) => updatePluginConfig({ systemId })}>
                        <option value="">All systems overview</option>
                        {pluginSystems.map((system) => <option key={system.id} value={system.id}>{system.name} · {system.status}</option>)}
                      </SelectField>
                    ) : (
                      <Field label="System ID or name" value={String(serviceForm.plugin.config.systemId ?? "")} onChange={(event) => updatePluginConfig({ systemId: event.target.value })} placeholder="Leave blank for all systems" hint="Test the connection to load available systems." />
                    )}
                    <div className="admin-service-plugin__actions">
                      <Button type="button" onClick={() => void testPluginConnection()} disabled={busy || creatingService || pluginState === "loading"}>{pluginState === "loading" ? "Connecting…" : "Test connection"}</Button>
                      <small>{creatingService ? "Save the service before testing." : "Read-only integration"}</small>
                    </div>
                    {pluginMessage ? <Notice kind={pluginState === "error" ? "danger" : "success"}>{pluginMessage}</Notice> : null}
                  </>
                ) : null}
                {serviceForm.plugin?.type === "portainer" ? (
                  <>
                    <div className="admin-form-divider"><Box size={15} /><span>Portainer integration</span></div>
                    <ToggleRow title="Plugin enabled" description="Show Portainer data inside this service card." checked={serviceForm.plugin.enabled} onChange={(enabled) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, enabled } : undefined })} />
                    <SelectField label="Presentation" value={serviceForm.plugin.presentation} onChange={(presentation) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, presentation: presentation as "summary" | "expanded" } : undefined })}>
                      <option value="summary">Compact summary</option>
                      <option value="expanded">Expanded metrics</option>
                    </SelectField>
                    <Field label="Portainer URL" type="url" value={String(serviceForm.plugin.config.url ?? "")} onChange={(event) => updatePluginConfig({ url: event.target.value })} placeholder="http://portainer:9000" hint="Use the URL reachable from the Dashcenter container. Do not add /api." />
                    <Field
                      label="Access token"
                      type="password"
                      value={pluginPassword}
                      onChange={(event) => setPluginPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder={pluginPasswordConfigured ? "Stored on the server" : "Portainer access token"}
                      hint={pluginPasswordConfigured ? "Leave blank to keep the stored token." : "Create a read-only token under My account in Portainer. It is never included in public dashboard data or backups."}
                    />
                    {pluginEndpoints.length > 0 ? (
                      <SelectField label="Environment" value={String(serviceForm.plugin.config.endpointId ?? "")} onChange={(endpointId) => updatePluginConfig({ endpointId })}>
                        <option value="">All environments overview</option>
                        {pluginEndpoints.map((endpoint) => <option key={endpoint.id} value={endpoint.id}>{endpoint.name} · {endpoint.status}</option>)}
                      </SelectField>
                    ) : (
                      <Field label="Environment ID" value={String(serviceForm.plugin.config.endpointId ?? "")} onChange={(event) => updatePluginConfig({ endpointId: event.target.value })} placeholder="Leave blank for all environments" hint="Test the connection to load available environments." />
                    )}
                    <div className="admin-service-plugin__actions">
                      <Button type="button" onClick={() => void testPluginConnection()} disabled={busy || creatingService || pluginState === "loading"}>{pluginState === "loading" ? "Connecting…" : "Test connection"}</Button>
                      <small>{creatingService ? "Save the service before testing." : "Read-only integration"}</small>
                    </div>
                    {pluginMessage ? <Notice kind={pluginState === "error" ? "danger" : "success"}>{pluginMessage}</Notice> : null}
                  </>
                ) : null}
                {serviceForm.plugin?.type === "proxmox" ? (
                  <>
                    <div className="admin-form-divider"><Cpu size={15} /><span>Proxmox VE integration</span></div>
                    <ToggleRow title="Plugin enabled" description="Show Proxmox cluster, node and guest metrics inside this service card." checked={serviceForm.plugin.enabled} onChange={(enabled) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, enabled } : undefined })} />
                    <SelectField label="Presentation" value={serviceForm.plugin.presentation} onChange={(presentation) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, presentation: presentation as "summary" | "expanded" } : undefined })}>
                      <option value="summary">Compact summary</option>
                      <option value="expanded">Expanded metrics</option>
                    </SelectField>
                    <Field label="Proxmox VE URL" type="url" value={String(serviceForm.plugin.config.url ?? "")} onChange={(event) => updatePluginConfig({ url: event.target.value })} placeholder="https://proxmox:8006" hint="Use the URL reachable from the Dashcenter container. Do not add /api2/json. The TLS certificate must be trusted by the container." />
                    <Field label="API token ID" value={pluginUsername} onChange={(event) => setPluginUsername(event.target.value)} autoComplete="username" placeholder="dashcenter@pve!monitoring" hint="Create a separate privilege-separated token and grant it the PVEAuditor role on the resources you want to monitor." />
                    <Field
                      label="API token secret"
                      type="password"
                      value={pluginPassword}
                      onChange={(event) => setPluginPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder={pluginPasswordConfigured ? "Stored on the server" : "Proxmox API token secret"}
                      hint={pluginPasswordConfigured ? "Leave blank to keep the stored token secret." : "The token ID and secret stay on the Dashcenter server and are sent only in the Proxmox authorization header."}
                    />
                    {pluginNodes.length > 0 ? (
                      <SelectField label="Node" value={String(serviceForm.plugin.config.node ?? "")} onChange={(node) => updatePluginConfig({ node })}>
                        <option value="">All cluster nodes</option>
                        {pluginNodes.map((node) => <option key={node.id} value={node.id}>{node.name} · {node.status}</option>)}
                      </SelectField>
                    ) : (
                      <Field label="Node name" value={String(serviceForm.plugin.config.node ?? "")} onChange={(event) => updatePluginConfig({ node: event.target.value })} placeholder="Leave blank for the whole cluster" hint="Test the connection to load nodes visible to the API token." />
                    )}
                    <div className="admin-service-plugin__actions">
                      <Button type="button" onClick={() => void testPluginConnection()} disabled={busy || creatingService || pluginState === "loading"}>{pluginState === "loading" ? "Connecting…" : "Test connection"}</Button>
                      <small>{creatingService ? "Save the service before testing." : "Read-only integration"}</small>
                    </div>
                    {pluginMessage ? <Notice kind={pluginState === "error" ? "danger" : "success"}>{pluginMessage}</Notice> : null}
                  </>
                ) : null}
                {serviceForm.plugin?.type === "uptime-kuma" ? (
                  <>
                    <div className="admin-form-divider"><Activity size={15} /><span>Uptime Kuma integration</span></div>
                    <ToggleRow title="Plugin enabled" description="Show Uptime Kuma monitor status and response time inside this service card." checked={serviceForm.plugin.enabled} onChange={(enabled) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, enabled } : undefined })} />
                    <SelectField label="Presentation" value={serviceForm.plugin.presentation} onChange={(presentation) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, presentation: presentation as "summary" | "expanded" } : undefined })}>
                      <option value="summary">Compact summary</option>
                      <option value="expanded">Expanded metrics</option>
                    </SelectField>
                    <Field label="Uptime Kuma URL" type="url" value={String(serviceForm.plugin.config.url ?? "")} onChange={(event) => updatePluginConfig({ url: event.target.value })} placeholder="http://uptime-kuma:3001" hint="Use the URL reachable from the Dashcenter container. Do not add /metrics." />
                    <Field
                      label="Prometheus API key"
                      type="password"
                      value={pluginPassword}
                      onChange={(event) => setPluginPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder={pluginPasswordConfigured ? "Stored on the server" : "Uptime Kuma API key"}
                      hint={pluginPasswordConfigured ? "Leave blank to keep the stored API key." : "Generate the key in Uptime Kuma Settings → Security → API Keys. Uptime Kuma 1.21 or newer is required. The key stays on the Dashcenter server."}
                    />
                    {pluginMonitors.length > 0 ? (
                      <SelectField label="Monitor" value={String(serviceForm.plugin.config.monitorId ?? "")} onChange={(monitorId) => updatePluginConfig({ monitorId })}>
                        <option value="">All monitors overview</option>
                        {pluginMonitors.map((monitor) => <option key={monitor.id} value={monitor.id}>{monitor.name} · {monitor.type} · {monitor.status}</option>)}
                      </SelectField>
                    ) : (
                      <Field label="Monitor ID" value={String(serviceForm.plugin.config.monitorId ?? "")} onChange={(event) => updatePluginConfig({ monitorId: event.target.value })} placeholder="Leave blank for all monitors" hint="Test the connection to load available monitors." />
                    )}
                    <div className="admin-service-plugin__actions">
                      <Button type="button" onClick={() => void testPluginConnection()} disabled={busy || creatingService || pluginState === "loading"}>{pluginState === "loading" ? "Connecting…" : "Test connection"}</Button>
                      <small>{creatingService ? "Save the service before testing." : "Read-only metrics integration"}</small>
                    </div>
                    {pluginMessage ? <Notice kind={pluginState === "error" ? "danger" : "success"}>{pluginMessage}</Notice> : null}
                  </>
                ) : null}
                {serviceForm.plugin?.type === "jellyfin" ? (
                  <>
                    <div className="admin-form-divider"><Film size={15} /><span>Jellyfin integration</span></div>
                    <ToggleRow title="Plugin enabled" description="Show Jellyfin activity and library counts inside this service card." checked={serviceForm.plugin.enabled} onChange={(enabled) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, enabled } : undefined })} />
                    <SelectField label="Presentation" value={serviceForm.plugin.presentation} onChange={(presentation) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, presentation: presentation as "summary" | "expanded" } : undefined })}>
                      <option value="summary">Compact summary</option>
                      <option value="expanded">Expanded metrics</option>
                    </SelectField>
                    <Field label="Jellyfin URL" type="url" value={String(serviceForm.plugin.config.url ?? "")} onChange={(event) => updatePluginConfig({ url: event.target.value })} placeholder="http://jellyfin:8096" hint="Use the URL reachable from the Dashcenter container. Do not add an API path." />
                    <Field
                      label="API key"
                      type="password"
                      value={pluginPassword}
                      onChange={(event) => setPluginPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder={pluginPasswordConfigured ? "Stored on the server" : "Jellyfin API key"}
                      hint={pluginPasswordConfigured ? "Leave blank to keep the stored key." : "Create an API key in Jellyfin Dashboard → Advanced → API Keys. It stays on the Dashcenter server."}
                    />
                    <div className="admin-service-plugin__actions">
                      <Button type="button" onClick={() => void testPluginConnection()} disabled={busy || creatingService || pluginState === "loading"}>{pluginState === "loading" ? "Connecting…" : "Test connection"}</Button>
                      <small>{creatingService ? "Save the service before testing." : "Read-only integration"}</small>
                    </div>
                    {pluginMessage ? <Notice kind={pluginState === "error" ? "danger" : "success"}>{pluginMessage}</Notice> : null}
                  </>
                ) : null}
                {serviceForm.plugin?.type === "plex" ? (
                  <>
                    <div className="admin-form-divider"><Play size={15} /><span>Plex integration</span></div>
                    <ToggleRow title="Plugin enabled" description="Show Plex playback activity and library counts inside this service card." checked={serviceForm.plugin.enabled} onChange={(enabled) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, enabled } : undefined })} />
                    <SelectField label="Presentation" value={serviceForm.plugin.presentation} onChange={(presentation) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, presentation: presentation as "summary" | "expanded" } : undefined })}>
                      <option value="summary">Compact summary</option>
                      <option value="expanded">Expanded metrics</option>
                    </SelectField>
                    <Field label="Plex URL" type="url" value={String(serviceForm.plugin.config.url ?? "")} onChange={(event) => updatePluginConfig({ url: event.target.value })} placeholder="http://plex:32400" hint="Use the Plex Media Server URL reachable from the Dashcenter container. Do not add an API path." />
                    <Field
                      label="Plex token"
                      type="password"
                      value={pluginPassword}
                      onChange={(event) => setPluginPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder={pluginPasswordConfigured ? "Stored on the server" : "X-Plex-Token"}
                      hint={pluginPasswordConfigured ? "Leave blank to keep the stored token." : "Use a Plex authentication token with access to this server. It stays on the Dashcenter server."}
                    />
                    <div className="admin-service-plugin__actions">
                      <Button type="button" onClick={() => void testPluginConnection()} disabled={busy || creatingService || pluginState === "loading"}>{pluginState === "loading" ? "Connecting…" : "Test connection"}</Button>
                      <small>{creatingService ? "Save the service before testing." : "Read-only integration"}</small>
                    </div>
                    {pluginMessage ? <Notice kind={pluginState === "error" ? "danger" : "success"}>{pluginMessage}</Notice> : null}
                  </>
                ) : null}
                {serviceForm.plugin?.type === "mikrotik" ? (
                  <>
                    <div className="admin-form-divider"><Router size={15} /><span>MikroTik integration</span></div>
                    <ToggleRow title="Plugin enabled" description="Show RouterOS health, DHCP and interface data inside this service card." checked={serviceForm.plugin.enabled} onChange={(enabled) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, enabled } : undefined })} />
                    <SelectField label="Presentation" value={serviceForm.plugin.presentation} onChange={(presentation) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, presentation: presentation as "summary" | "expanded" } : undefined })}>
                      <option value="summary">Compact summary</option>
                      <option value="expanded">Expanded metrics</option>
                    </SelectField>
                    <Field label="MikroTik URL" type="url" value={String(serviceForm.plugin.config.url ?? "")} onChange={(event) => updatePluginConfig({ url: event.target.value })} placeholder="https://192.168.88.1" hint="Use the RouterOS v7 web URL reachable from the Dashcenter container. Do not add /rest." />
                    <Field label="RouterOS username" value={pluginUsername} onChange={(event) => setPluginUsername(event.target.value)} autoComplete="username" />
                    <Field
                      label="RouterOS password"
                      type="password"
                      value={pluginPassword}
                      onChange={(event) => setPluginPassword(event.target.value)}
                      autoComplete="current-password"
                      placeholder={pluginPasswordConfigured ? "Stored on the server" : "MikroTik read-only user password"}
                      hint={pluginPasswordConfigured ? "Leave blank to keep the stored password." : "Use a dedicated RouterOS user with read and REST API permissions. HTTPS is recommended. Credentials stay on the Dashcenter server."}
                    />
                    {pluginInterfaces.length > 0 ? (
                      <SelectField label="Traffic interface" value={String(serviceForm.plugin.config.interfaceName ?? "")} onChange={(interfaceName) => updatePluginConfig({ interfaceName })}>
                        <option value="">Do not collect traffic rates</option>
                        {pluginInterfaces.map((networkInterface) => (
                          <option key={networkInterface.name} value={networkInterface.name} disabled={networkInterface.disabled}>
                            {networkInterface.name}{networkInterface.type ? ` · ${networkInterface.type}` : ""} · {networkInterface.disabled ? "disabled" : networkInterface.running ? "running" : "not running"}
                          </option>
                        ))}
                      </SelectField>
                    ) : (
                      <Field
                        label="Traffic interface"
                        value={String(serviceForm.plugin.config.interfaceName ?? "")}
                        onChange={(event) => updatePluginConfig({ interfaceName: event.target.value })}
                        placeholder="Test the connection, then choose an interface"
                        hint="Dashcenter calculates read-only download and upload rates from the selected interface counters. Test the connection to load available interfaces."
                      />
                    )}
                    <div className="admin-service-plugin__actions">
                      <Button type="button" onClick={() => void testPluginConnection()} disabled={busy || creatingService || pluginState === "loading"}>{pluginState === "loading" ? "Connecting…" : "Test connection"}</Button>
                      <small>{creatingService ? "Save the service before testing." : "Read-only integration"}</small>
                    </div>
                    {pluginMessage ? <Notice kind={pluginState === "error" ? "danger" : "success"}>{pluginMessage}</Notice> : null}
                  </>
                ) : null}
                {serviceForm.plugin?.type === "radarr" || serviceForm.plugin?.type === "sonarr" ? (
                  <>
                    <div className="admin-form-divider">
                      {serviceForm.plugin.type === "radarr" ? <Film size={15} /> : <Tv size={15} />}
                      <span>{serviceForm.plugin.type === "radarr" ? "Radarr" : "Sonarr"} integration</span>
                    </div>
                    <ToggleRow
                      title="Plugin enabled"
                      description={`Show ${serviceForm.plugin.type === "radarr" ? "Radarr movie" : "Sonarr series"} library and activity data inside this service card.`}
                      checked={serviceForm.plugin.enabled}
                      onChange={(enabled) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, enabled } : undefined })}
                    />
                    <SelectField label="Presentation" value={serviceForm.plugin.presentation} onChange={(presentation) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, presentation: presentation as "summary" | "expanded" } : undefined })}>
                      <option value="summary">Compact summary</option>
                      <option value="expanded">Expanded metrics</option>
                    </SelectField>
                    <Field
                      label={`${serviceForm.plugin.type === "radarr" ? "Radarr" : "Sonarr"} URL`}
                      type="url"
                      value={String(serviceForm.plugin.config.url ?? "")}
                      onChange={(event) => updatePluginConfig({ url: event.target.value })}
                      placeholder={serviceForm.plugin.type === "radarr" ? "http://radarr:7878" : "http://sonarr:8989"}
                      hint="Use the URL reachable from the Dashcenter container. Do not add /api/v3."
                    />
                    <Field
                      label="API key"
                      type="password"
                      value={pluginPassword}
                      onChange={(event) => setPluginPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder={pluginPasswordConfigured ? "Stored on the server" : `${serviceForm.plugin.type === "radarr" ? "Radarr" : "Sonarr"} API key`}
                      hint={pluginPasswordConfigured ? "Leave blank to keep the stored key." : "Copy the API key from Settings → General → Security. It stays on the Dashcenter server."}
                    />
                    <div className="admin-service-plugin__actions">
                      <Button type="button" onClick={() => void testPluginConnection()} disabled={busy || creatingService || pluginState === "loading"}>{pluginState === "loading" ? "Connecting…" : "Test connection"}</Button>
                      <small>{creatingService ? "Save the service before testing." : "Read-only integration"}</small>
                    </div>
                    {pluginMessage ? <Notice kind={pluginState === "error" ? "danger" : "success"}>{pluginMessage}</Notice> : null}
                  </>
                ) : null}
                {serviceForm.plugin?.type === "lidarr" ? (
                  <>
                    <div className="admin-form-divider">
                      <Disc3 size={15} />
                      <span>Lidarr integration</span>
                    </div>
                    <ToggleRow
                      title="Plugin enabled"
                      description="Show Lidarr music library, wanted albums and download queue data inside this service card."
                      checked={serviceForm.plugin.enabled}
                      onChange={(enabled) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, enabled } : undefined })}
                    />
                    <SelectField label="Presentation" value={serviceForm.plugin.presentation} onChange={(presentation) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, presentation: presentation as "summary" | "expanded" } : undefined })}>
                      <option value="summary">Compact summary</option>
                      <option value="expanded">Expanded metrics</option>
                    </SelectField>
                    <Field
                      label="Lidarr URL"
                      type="url"
                      value={String(serviceForm.plugin.config.url ?? "")}
                      onChange={(event) => updatePluginConfig({ url: event.target.value })}
                      placeholder="http://lidarr:8686"
                      hint="Use the URL reachable from the Dashcenter container. Do not add /api/v1."
                    />
                    <Field
                      label="API key"
                      type="password"
                      value={pluginPassword}
                      onChange={(event) => setPluginPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder={pluginPasswordConfigured ? "Stored on the server" : "Lidarr API key"}
                      hint={pluginPasswordConfigured ? "Leave blank to keep the stored key." : "Copy the API key from Settings → General → Security. It stays on the Dashcenter server."}
                    />
                    <div className="admin-service-plugin__actions">
                      <Button type="button" onClick={() => void testPluginConnection()} disabled={busy || creatingService || pluginState === "loading"}>{pluginState === "loading" ? "Connecting…" : "Test connection"}</Button>
                      <small>{creatingService ? "Save the service before testing." : "Read-only integration"}</small>
                    </div>
                    {pluginMessage ? <Notice kind={pluginState === "error" ? "danger" : "success"}>{pluginMessage}</Notice> : null}
                  </>
                ) : null}
                {serviceForm.plugin?.type === "prowlarr" || serviceForm.plugin?.type === "bazarr" ? (
                  <>
                    <div className="admin-form-divider">
                      {serviceForm.plugin.type === "prowlarr" ? <Search size={15} /> : <Captions size={15} />}
                      <span>{serviceForm.plugin.type === "prowlarr" ? "Prowlarr" : "Bazarr"} integration</span>
                    </div>
                    <ToggleRow title="Plugin enabled" description={`Show live ${serviceForm.plugin.type === "prowlarr" ? "indexer activity" : "missing subtitle counts"} inside this service card.`} checked={serviceForm.plugin.enabled} onChange={(enabled) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, enabled } : undefined })} />
                    <SelectField label="Presentation" value={serviceForm.plugin.presentation} onChange={(presentation) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, presentation: presentation as "summary" | "expanded" } : undefined })}>
                      <option value="summary">Compact summary</option>
                      <option value="expanded">Expanded metrics</option>
                    </SelectField>
                    <Field label={`${serviceForm.plugin.type === "prowlarr" ? "Prowlarr" : "Bazarr"} URL`} type="url" value={String(serviceForm.plugin.config.url ?? "")} onChange={(event) => updatePluginConfig({ url: event.target.value })} placeholder={serviceForm.plugin.type === "prowlarr" ? "http://prowlarr:9696" : "http://bazarr:6767"} hint="Use the URL reachable from the Dashcenter container. Do not add an API path." />
                    <Field label="API key" type="password" value={pluginPassword} onChange={(event) => setPluginPassword(event.target.value)} autoComplete="new-password" placeholder={pluginPasswordConfigured ? "Stored on the server" : `${serviceForm.plugin.type === "prowlarr" ? "Prowlarr" : "Bazarr"} API key`} hint={pluginPasswordConfigured ? "Leave blank to keep the stored key." : "Copy the API key from the provider settings. It stays on the Dashcenter server."} />
                    <div className="admin-service-plugin__actions">
                      <Button type="button" onClick={() => void testPluginConnection()} disabled={busy || creatingService || pluginState === "loading"}>{pluginState === "loading" ? "Connecting…" : "Test connection"}</Button>
                      <small>Save the service first, then test the connection.</small>
                    </div>
                    {pluginMessage ? <Notice kind={pluginState === "error" ? "danger" : "success"}>{pluginMessage}</Notice> : null}
                  </>
                ) : null}
                {serviceForm.plugin?.type === "qbittorrent" ? (
                  <>
                    <div className="admin-form-divider"><Download size={15} /><span>qBittorrent integration</span></div>
                    <ToggleRow title="Plugin enabled" description="Show torrent activity and transfer speeds inside this service card." checked={serviceForm.plugin.enabled} onChange={(enabled) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, enabled } : undefined })} />
                    <SelectField label="Presentation" value={serviceForm.plugin.presentation} onChange={(presentation) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, presentation: presentation as "summary" | "expanded" } : undefined })}>
                      <option value="summary">Compact summary</option>
                      <option value="expanded">Expanded metrics</option>
                    </SelectField>
                    <Field label="qBittorrent URL" type="url" value={String(serviceForm.plugin.config.url ?? "")} onChange={(event) => updatePluginConfig({ url: event.target.value })} placeholder="http://qbittorrent:8080" hint="Use the Web UI URL reachable from the Dashcenter container. Do not add /api/v2." />
                    <Field label="Web UI username" value={pluginUsername} onChange={(event) => setPluginUsername(event.target.value)} autoComplete="username" />
                    <Field label="Web UI password" type="password" value={pluginPassword} onChange={(event) => setPluginPassword(event.target.value)} autoComplete="current-password" placeholder={pluginPasswordConfigured ? "Stored on the server" : "qBittorrent Web UI password"} hint={pluginPasswordConfigured ? "Leave blank to keep the stored password." : "Credentials stay on the Dashcenter server and are used only for read-only Web API requests."} />
                    <div className="admin-service-plugin__actions">
                      <Button type="button" onClick={() => void testPluginConnection()} disabled={busy || creatingService || pluginState === "loading"}>{pluginState === "loading" ? "Connecting…" : "Test connection"}</Button>
                      <small>Save the service first, then test the connection.</small>
                    </div>
                    {pluginMessage ? <Notice kind={pluginState === "error" ? "danger" : "success"}>{pluginMessage}</Notice> : null}
                  </>
                ) : null}
                {serviceForm.plugin?.type === "nginx-proxy-manager" ? (
                  <>
                    <div className="admin-form-divider"><ShieldCheck size={15} /><span>Nginx Proxy Manager integration</span></div>
                    <ToggleRow title="Plugin enabled" description="Show proxy host, SSL, redirect and stream status inside this service card." checked={serviceForm.plugin.enabled} onChange={(enabled) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, enabled } : undefined })} />
                    <SelectField label="Presentation" value={serviceForm.plugin.presentation} onChange={(presentation) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, presentation: presentation as "summary" | "expanded" } : undefined })}>
                      <option value="summary">Compact summary</option>
                      <option value="expanded">Expanded metrics</option>
                    </SelectField>
                    <Field label="Nginx Proxy Manager URL" type="url" value={String(serviceForm.plugin.config.url ?? "")} onChange={(event) => updatePluginConfig({ url: event.target.value })} placeholder="http://nginx-proxy-manager:81" hint="Use the admin URL reachable from the Dashcenter container. Do not add /api." />
                    <Field label="NPM identity (email)" type="email" value={pluginUsername} onChange={(event) => setPluginUsername(event.target.value)} autoComplete="username" />
                    <Field label="NPM password" type="password" value={pluginPassword} onChange={(event) => setPluginPassword(event.target.value)} autoComplete="current-password" placeholder={pluginPasswordConfigured ? "Stored on the server" : "Nginx Proxy Manager password"} hint={pluginPasswordConfigured ? "Leave blank to keep the stored password." : "Use a dedicated account with permission to view hosts. Credentials stay on the Dashcenter server and host data requests are read-only."} />
                    <div className="admin-service-plugin__actions">
                      <Button type="button" onClick={() => void testPluginConnection()} disabled={busy || creatingService || pluginState === "loading"}>{pluginState === "loading" ? "Connecting…" : "Test connection"}</Button>
                      <small>Save the service first, then test the connection.</small>
                    </div>
                    {pluginMessage ? <Notice kind={pluginState === "error" ? "danger" : "success"}>{pluginMessage}</Notice> : null}
                  </>
                ) : null}
                {serviceForm.plugin?.type === "steam-wishlist" ? (
                  <>
                    <div className="admin-form-divider"><BadgePercent size={15} /><span>Steam wishlist deals</span></div>
                    <ToggleRow title="Plugin enabled" description="Show discounted games from a public Steam wishlist inside this service card." checked={serviceForm.plugin.enabled} onChange={(enabled) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, enabled } : undefined })} />
                    <SelectField label="Presentation" value={serviceForm.plugin.presentation} onChange={(presentation) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, presentation: presentation as "summary" | "expanded" } : undefined })}>
                      <option value="summary">Compact summary</option>
                      <option value="expanded">Deal cards with artwork</option>
                    </SelectField>
                    <Field
                      label="SteamID64 or profile URL"
                      value={pluginUsername}
                      onChange={(event) => setPluginUsername(event.target.value)}
                      autoComplete="off"
                      placeholder="7656119… or https://steamcommunity.com/profiles/…"
                      hint="The 17-digit ID is stored only on the Dashcenter server. Your Steam profile and game details must be public; custom /id/name profile URLs need to be converted to SteamID64 first."
                    />
                    <Field label="Store country code" value={String(serviceForm.plugin.config.countryCode ?? "SK")} onChange={(event) => updatePluginConfig({ countryCode: event.target.value.toUpperCase().slice(0, 2) })} maxLength={2} placeholder="SK" hint="Two-letter country code used for Steam prices and availability." />
                    <SelectField label="Store language" value={String(serviceForm.plugin.config.language ?? "english")} onChange={(language) => updatePluginConfig({ language })}>
                      <option value="english">English</option>
                      <option value="slovak">Slovenčina</option>
                      <option value="czech">Čeština</option>
                      <option value="german">Deutsch</option>
                    </SelectField>
                    <Field label="Minimum discount (%)" type="number" min={0} max={95} step={5} value={Number(serviceForm.plugin.config.minDiscount ?? 20)} onChange={(event) => updatePluginConfig({ minDiscount: Number(event.target.value) })} />
                    <SelectField label="Games to show" value={Number(serviceForm.plugin.config.maxItems ?? 3)} onChange={(maxItems) => updatePluginConfig({ maxItems: Number(maxItems) })}>
                      {[1, 2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count}</option>)}
                    </SelectField>
                    <SelectField label="Sort deals by" value={String(serviceForm.plugin.config.sortBy ?? "discount")} onChange={(sortBy) => updatePluginConfig({ sortBy })}>
                      <option value="discount">Biggest discount</option>
                      <option value="price">Lowest price</option>
                      <option value="wishlist">Wishlist priority</option>
                    </SelectField>
                    <SelectField label="Refresh Steam data" value={Number(serviceForm.plugin.config.refreshMinutes ?? 360)} onChange={(refreshMinutes) => updatePluginConfig({ refreshMinutes: Number(refreshMinutes) })}>
                      <option value={60}>Every hour</option>
                      <option value={180}>Every 3 hours</option>
                      <option value={360}>Every 6 hours</option>
                      <option value={720}>Every 12 hours</option>
                      <option value={1440}>Once a day</option>
                    </SelectField>
                    <div className="admin-service-plugin__actions">
                      <Button type="button" onClick={() => void testPluginConnection()} disabled={busy || creatingService || pluginState === "loading"}>{pluginState === "loading" ? "Checking wishlist…" : "Test wishlist"}</Button>
                      <small>{creatingService ? "Save the service before testing." : "Public wishlist · no API key required"}</small>
                    </div>
                    {pluginMessage ? <Notice kind={pluginState === "error" ? "danger" : "success"}>{pluginMessage}</Notice> : null}
                  </>
                ) : null}
                {serviceForm.plugin ? (
                  <section className="admin-service-live-preview" aria-label="Live service preview">
                    <header>
                      <span><small>Dashboard card</small><strong>Live preview</strong></span>
                      <i>{previewHasSavedProvider ? (serviceForm.plugin.presentation === "expanded" ? "Expanded" : "Summary") : "Save to load provider data"}</i>
                    </header>
                    <div className="admin-service-live-preview__canvas">
                      <ServiceCardPreview service={previewService ?? serviceForm} />
                    </div>
                  </section>
                ) : (
                  <Notice kind="neutral">Choose a provider to configure live data and preview its dashboard card.</Notice>
                )}
              </div>
            ) : null}

            {serviceSection === "layout" ? (
              <div className="admin-service-section">
                <div className="admin-service-plugin__intro">
                  <span><LayoutGrid size={17} /></span>
                  <span><strong>Service card layout</strong><small>Control how this service fills its saved dashboard group.</small></span>
                </div>
                {serviceForm.plugin ? (
                  <SelectField label="Plugin presentation" value={serviceForm.plugin.presentation} onChange={(presentation) => setServiceForm({ ...serviceForm, plugin: serviceForm.plugin ? { ...serviceForm.plugin, presentation: presentation as "summary" | "expanded" } : undefined })}>
                    <option value="summary">Compact summary</option>
                    <option value="expanded">Expanded details</option>
                  </SelectField>
                ) : (
                  <Notice kind="neutral">This service uses the compact service-row layout because no native plugin is selected.</Notice>
                )}
                <ToggleRow title="Visible on dashboard" description="Keep the service configured while choosing whether it appears in its group." checked={serviceForm.visible} onChange={(visible) => setServiceForm({ ...serviceForm, visible })} />
                <Notice kind="info">Group width, height, direction and exact board placement are edited from the Dashboard workspace so every service in the group stays aligned.</Notice>
                <section className="admin-service-live-preview" aria-label="Service layout preview">
                  <header><span><small>Current presentation</small><strong>Dashboard preview</strong></span></header>
                  <div className="admin-service-live-preview__canvas">
                    <ServiceCardPreview service={previewService ?? serviceForm} />
                  </div>
                </section>
              </div>
            ) : null}
            <footer className="admin-inspector__actions">
              <Button variant="danger" type="button" onClick={() => creatingService ? void deleteService() : serviceForm && setPendingDelete({ type: "service", name: serviceForm.name })} disabled={busy || serviceIconUploading}>
                <Trash2 size={15} /> {creatingService ? "Cancel" : "Delete"}
              </Button>
              <span>
                <Button type="button" onClick={discardServiceChanges} disabled={busy || serviceIconUploading}>Discard</Button>
                <Button variant="primary" type="submit" disabled={busy || serviceIconUploading || !serviceForm.name.trim() || !serviceForm.href.trim()}>
                  {busy ? "Saving…" : creatingService ? "Add service" : "Save changes"}
                </Button>
              </span>
            </footer>
          </form>
        ) : (
          <EmptyState icon={<CircleDot size={23} />} title="Select a service">
            Choose a service to edit its link, icon, status, and native plugin.
          </EmptyState>
        )}
      </aside>
      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.type === "group" ? `Delete “${pendingDelete.name}”?` : `Delete “${pendingDelete?.name ?? "service"}”?`}
        description={pendingDelete?.type === "group" ? "This group and all of its services will be removed from the dashboard." : "This service and its saved plugin settings will be removed."}
        confirmLabel={pendingDelete?.type === "group" ? "Delete group" : "Delete service"}
        variant="danger"
        busy={busy}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => { if (pendingDelete?.type === "group") void deleteGroup(); else if (pendingDelete?.type === "service") void deleteService(); }}
      />
    </div>
  );
}

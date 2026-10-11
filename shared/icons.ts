export const DASHBOARD_ICONS_REVISION = "8a8c513b7d0b544ee56e366a9d5be364439d2226";
export const SELFHST_ICONS_REVISION = "948e3aa28d3110ee23957473a85431650e10e778";
export const DASHBOARD_ICON_CATALOG_PATH = "/assets/icon-catalog.json";
export const MDI_ICONS_REVISION = "7.4.47";
export const SIMPLE_ICONS_REVISION = "16.28.0";
export const SVG_ICON_PROXY_BASE = "/api/icons/svg";

const DASHBOARD_ICON_BASE =
  "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@" + DASHBOARD_ICONS_REVISION;
const SELFHST_ICON_BASE =
  "https://cdn.jsdelivr.net/gh/selfhst/icons@" + SELFHST_ICONS_REVISION;
const ICON_SET_BASES = {
  mdi: "https://unpkg.com/@mdi/svg@" + MDI_ICONS_REVISION + "/svg/",
  si: "https://unpkg.com/simple-icons@" + SIMPLE_ICONS_REVISION + "/icons/",
} as const;

export const POPULAR_DASHBOARD_ICONS = [
  "portainer.png",
  "proxmox.png",
  "docker.png",
  "beszel.png",
  "uptime-kuma.png",
  "jellyfin.png",
  "plex.png",
  "nginx-proxy-manager.png",
  "qbittorrent.png",
  "radarr.png",
  "sonarr.png",
  "prowlarr.png",
  "bazarr.png",
  "mikrotik.png",
  "steam.png",
  "notion.png",
  "chatgpt.png",
  "proton-pass.png",
  "github.png",
] as const;

export interface IconCatalogManifest {
  source: string;
  revision: string;
  license: string;
  icons: string[];
}

export type ResolvedIcon =
  | { kind: "none"; src: ""; color?: undefined }
  | { kind: "image"; src: string; color?: undefined }
  | { kind: "mask"; src: string; fallbackSrc: string; color: string };

const SAFE_FILENAME = /^[a-z0-9][a-z0-9._-]*\.png$/i;
const SAFE_ICON_NAME = /^[a-z0-9][a-z0-9._-]*$/i;
const DASHBOARD_FORMAT = /\.(png|svg|webp)$/i;
const SELFHST_FORMAT = /\.(png|svg|webp|avif)$/i;

function dashboardIconUrl(icon: string) {
  const extensionMatch = icon.match(DASHBOARD_FORMAT);
  const extension = extensionMatch?.[1].toLowerCase() ?? "png";
  const name = extensionMatch
    ? icon.slice(0, -extensionMatch[0].length)
    : icon.replace(/\.avif$/i, "");
  const filename = name + "." + extension;
  return DASHBOARD_ICON_BASE + "/" + extension + "/" + encodeURIComponent(filename);
}

export function normalizeIconReference(icon: string): string {
  const value = icon.trim();
  if (!value || /^https?:\/\//i.test(value) || value.startsWith("/")) return value;

  if (/^sh-/i.test(value)) {
    return "sh-" + value.slice(3).toLocaleLowerCase();
  }

  const iconSetMatch = /^(mdi|si)-(.+)$/i.exec(value);
  if (iconSetMatch) {
    const prefix = iconSetMatch[1].toLocaleLowerCase();
    let name = iconSetMatch[2];
    const colorMatch = name.match(/-(#[a-f0-9]{6})$/i);
    const colorSuffix = colorMatch ? "-" + colorMatch[1].toLocaleLowerCase() : "";
    if (colorMatch) name = name.slice(0, -colorMatch[0].length);
    name = name.replace(/\.svg$/i, "").toLocaleLowerCase();
    if (SAFE_ICON_NAME.test(name)) return prefix + "-" + name + colorSuffix;
  }

  return value.toLocaleLowerCase();
}

export function resolveIconSource(icon: string): ResolvedIcon {
  const value = normalizeIconReference(icon);
  if (!value) return { kind: "none", src: "" };

  if (/^https?:\/\//i.test(value) || value.startsWith("/")) {
    return { kind: "image", src: value };
  }

  if (/^sh-/i.test(value)) {
    let name = value.slice(3);
    const extensionMatch = name.match(SELFHST_FORMAT);
    const extension = extensionMatch?.[1].toLowerCase() ?? "png";
    if (extensionMatch) name = name.slice(0, -extensionMatch[0].length);
    if (SAFE_ICON_NAME.test(name)) {
      return {
        kind: "image",
        src: SELFHST_ICON_BASE + "/" + extension + "/" + encodeURIComponent(name + "." + extension),
      };
    }
  }

  const iconSetMatch = /^(mdi|si)-(.+)$/i.exec(value);
  if (iconSetMatch) {
    const prefix = iconSetMatch[1].toLowerCase() as keyof typeof ICON_SET_BASES;
    let name = iconSetMatch[2];
    const colorMatch = name.match(/-(#[a-f0-9]{6})$/i);
    const color = colorMatch?.[1] ?? "currentColor";
    if (colorMatch) name = name.slice(0, -colorMatch[0].length);
    name = name.replace(/\.svg$/i, "");
    if (SAFE_ICON_NAME.test(name)) {
      return {
        kind: "mask",
        src: SVG_ICON_PROXY_BASE + "/" + prefix + "/" + encodeURIComponent(name),
        fallbackSrc: ICON_SET_BASES[prefix] + encodeURIComponent(name) + ".svg",
        color,
      };
    }
  }

  return { kind: "image", src: dashboardIconUrl(value) };
}

export function resolveIcon(icon: string) {
  return resolveIconSource(icon).src;
}

export function parseIconCatalog(payload: unknown): IconCatalogManifest {
  if (!payload || typeof payload !== "object") {
    throw new Error("Icon catalog is not an object.");
  }

  const candidate = payload as Record<string, unknown>;
  if (
    typeof candidate.source !== "string" ||
    !/^https:\/\/github\.com\//i.test(candidate.source) ||
    typeof candidate.revision !== "string" ||
    !/^[a-f0-9]{40}$/i.test(candidate.revision) ||
    typeof candidate.license !== "string" ||
    !Array.isArray(candidate.icons)
  ) {
    throw new Error("Icon catalog metadata is invalid.");
  }

  if (!candidate.icons.every((icon) => typeof icon === "string" && SAFE_FILENAME.test(icon))) {
    throw new Error("Icon catalog contains an invalid filename.");
  }

  return {
    source: candidate.source,
    revision: candidate.revision,
    license: candidate.license,
    icons: [...new Set(candidate.icons)],
  };
}

export function normalizeIconSearch(value: string) {
  return value
    .replace(/\.png$/i, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function iconDisplayName(filename: string) {
  const normalized = normalizeIconSearch(filename);
  return normalized
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function searchIconCatalog(icons: string[], query: string, limit = 72) {
  if (limit <= 0) return [];

  const needle = normalizeIconSearch(query);
  if (!needle) {
    const available = new Set(icons);
    const popular: string[] = POPULAR_DASHBOARD_ICONS.filter((icon) => available.has(icon));
    const popularSet = new Set<string>(popular);
    return [...popular, ...icons.filter((icon) => !popularSet.has(icon))].slice(0, limit);
  }

  const tokens = needle.split(" ").filter(Boolean);
  return icons
    .map((icon) => {
      const searchable = normalizeIconSearch(icon);
      const words = searchable.split(" ");
      let score = Number.POSITIVE_INFINITY;
      if (searchable === needle) score = 0;
      else if (searchable.startsWith(needle)) score = 1;
      else if (tokens.every((token) => words.some((word) => word.startsWith(token)))) score = 2;
      else if (tokens.every((token) => searchable.includes(token))) score = 3;
      return { icon, searchable, score };
    })
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score || a.searchable.localeCompare(b.searchable))
    .slice(0, limit)
    .map((entry) => entry.icon);
}

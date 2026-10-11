import { randomUUID } from "node:crypto";
import { dump, load, JSON_SCHEMA } from "js-yaml";
import type { DashboardGroup, DashboardService, ImportPreview } from "../shared/types.js";

const KNOWN_SERVICE_FIELDS = new Set(["icon", "href", "description", "server", "container"]);
const BLOCKED_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_YAML_BYTES = 10 * 1024 * 1024;
const MAX_ICON_REFERENCE_LENGTH = 512;

export class HomepageYamlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HomepageYamlError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeClone(value: unknown, depth = 0): unknown {
  if (depth > 20) return null;
  if (Array.isArray(value)) return value.map((item) => safeClone(item, depth + 1));
  if (!isPlainObject(value)) return value;

  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (BLOCKED_OBJECT_KEYS.has(key)) continue;
    output[key] = safeClone(nestedValue, depth + 1);
  }
  return output;
}

function firstEntry(
  value: unknown,
  kind: "group" | "service",
  warnings: string[],
): [string, unknown] | undefined {
  if (!isPlainObject(value)) {
    warnings.push(`Skipped ${kind}: expected an object entry.`);
    return undefined;
  }

  const entries = Object.entries(value).filter(([key]) => !BLOCKED_OBJECT_KEYS.has(key));
  if (entries.length === 0) {
    warnings.push(`Skipped empty ${kind} entry.`);
    return undefined;
  }
  if (entries.length > 1) {
    warnings.push(
      `${kind === "group" ? "Group" : "Service"} entry contains multiple names; only “${entries[0][0]}” was imported.`,
    );
  }
  return entries[0];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function slug(value: string): string {
  const result = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return result || randomUUID();
}

function uniqueId(base: string, usedIds: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function parseYamlDocument(source: string, label: string): unknown {
  if (!source.trim()) throw new HomepageYamlError(`The ${label} document is empty.`);
  if (Buffer.byteLength(source, "utf8") > MAX_YAML_BYTES) {
    throw new HomepageYamlError(`The ${label} document is larger than 10 MB.`);
  }

  try {
    return load(source, { schema: JSON_SCHEMA, json: false });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown YAML syntax error";
    throw new HomepageYamlError(`Could not parse Homepage ${label}: ${detail}`);
  }
}

function parseHomepageGroupIcons(source: string, warnings: string[]): Map<string, string> {
  const document = parseYamlDocument(source, "settings YAML");
  if (!isPlainObject(document)) {
    throw new HomepageYamlError("Homepage settings YAML must contain a top-level object.");
  }

  const layout = document.layout;
  if (layout === undefined) {
    warnings.push("settings.yaml has no layout section, so no group icons were imported.");
    return new Map();
  }

  const entries: Array<[string, unknown]> = [];
  if (Array.isArray(layout)) {
    for (const item of layout) {
      const entry = firstEntry(item, "group", warnings);
      if (entry) entries.push(entry);
    }
  } else if (isPlainObject(layout)) {
    entries.push(...Object.entries(layout).filter(([key]) => !BLOCKED_OBJECT_KEYS.has(key)));
  } else {
    throw new HomepageYamlError("Homepage settings YAML layout must be an object or a list of groups.");
  }

  const icons = new Map<string, string>();
  for (const [rawName, rawConfig] of entries) {
    const groupName = rawName.trim();
    if (!groupName) {
      warnings.push("Skipped a settings.yaml layout entry with an empty group name.");
      continue;
    }
    if (rawConfig == null) continue;
    if (!isPlainObject(rawConfig)) {
      warnings.push(`Skipped settings for “${groupName}”: expected an object.`);
      continue;
    }
    if (!Object.hasOwn(rawConfig, "icon")) continue;

    const icon = asString(rawConfig.icon);
    if (!icon) {
      warnings.push(`Skipped the empty group icon for “${groupName}”.`);
      continue;
    }
    if (icon.length > MAX_ICON_REFERENCE_LENGTH) {
      warnings.push(`Skipped the group icon for “${groupName}”: icon references are limited to 512 characters.`);
      continue;
    }
    if (icons.has(groupName)) {
      warnings.push(`settings.yaml contains “${groupName}” more than once; only the first icon was imported.`);
      continue;
    }
    icons.set(groupName, icon);
  }

  return icons;
}

/** Parse Homepage services.yaml and optionally import category icons from settings.yaml. */
export function parseHomepageYaml(source: string, settingsSource?: string): ImportPreview {
  let document = parseYamlDocument(source, "services YAML");

  if (isPlainObject(document) && Array.isArray(document.services)) {
    document = document.services;
  }
  if (!Array.isArray(document)) {
    throw new HomepageYamlError("Homepage services YAML must contain a top-level list of groups.");
  }

  const warnings: string[] = [];
  const groups: DashboardGroup[] = [];
  const usedGroupIds = new Set<string>();
  const usedServiceIds = new Set<string>();
  let preservedFields = 0;

  for (const rawGroup of document) {
    const groupEntry = firstEntry(rawGroup, "group", warnings);
    if (!groupEntry) continue;
    const [rawGroupName, rawServices] = groupEntry;
    const groupName = rawGroupName.trim();
    if (!groupName) {
      warnings.push("Skipped a group with an empty name.");
      continue;
    }
    if (!Array.isArray(rawServices)) {
      warnings.push(`Skipped group “${groupName}”: expected a list of services.`);
      continue;
    }

    const groupId = uniqueId(slug(groupName), usedGroupIds);
    const services: DashboardService[] = [];

    for (const rawService of rawServices) {
      const serviceEntry = firstEntry(rawService, "service", warnings);
      if (!serviceEntry) continue;
      const [rawServiceName, rawConfig] = serviceEntry;
      const serviceName = rawServiceName.trim();
      if (!serviceName) {
        warnings.push(`Skipped an unnamed service in “${groupName}”.`);
        continue;
      }
      if (rawConfig != null && !isPlainObject(rawConfig)) {
        warnings.push(`Skipped “${serviceName}”: expected its configuration to be an object.`);
        continue;
      }

      const config = rawConfig ?? {};
      const href = asString(config.href);
      if (!isHttpUrl(href)) {
        warnings.push(`Skipped “${serviceName}”: href must be a valid http:// or https:// URL.`);
        continue;
      }

      const legacyConfig: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(config)) {
        if (BLOCKED_OBJECT_KEYS.has(key) || KNOWN_SERVICE_FIELDS.has(key)) continue;
        legacyConfig[key] = safeClone(value);
        preservedFields += 1;
      }

      const dockerServer = asString(config.server);
      const container = asString(config.container);
      const idBase = `${slug(groupName)}-${slug(serviceName)}`.slice(0, 80);
      services.push({
        id: uniqueId(idBase, usedServiceIds),
        groupId,
        name: serviceName,
        href,
        description: asString(config.description),
        icon: asString(config.icon),
        dockerServer,
        container,
        position: services.length,
        visible: true,
        statusCheck: Boolean(dockerServer && container),
        statusSource: dockerServer || container ? "docker" : "http",
        status: "unknown",
        ...(Object.keys(legacyConfig).length > 0 ? { legacyConfig } : {}),
      });
    }

    groups.push({
      id: groupId,
      name: groupName,
      icon: "",
      columnSpan: 1,
      columnStart: 0,
      gapBefore: 0,
      position: groups.length,
      visible: true,
      services,
    });
  }

  if (groups.length === 0) {
    throw new HomepageYamlError("No valid Homepage groups were found in the YAML document.");
  }

  let groupIcons = 0;
  if (settingsSource?.trim()) {
    const icons = parseHomepageGroupIcons(settingsSource, warnings);
    const matchedNames = new Set<string>();

    for (const group of groups) {
      const icon = icons.get(group.name);
      if (!icon) continue;
      group.icon = icon;
      groupIcons += 1;
      matchedNames.add(group.name);
    }

    const unmatched = [...icons.keys()].filter((name) => !matchedNames.has(name));
    if (unmatched.length > 0) {
      const examples = unmatched.slice(0, 3).map((name) => `“${name}”`).join(", ");
      warnings.push(
        `Ignored ${unmatched.length} settings.yaml group icon${unmatched.length === 1 ? "" : "s"} without a matching services.yaml group: ${examples}${unmatched.length > 3 ? ", …" : ""}.`,
      );
    }
  }

  return {
    groups,
    warnings,
    stats: {
      groups: groups.length,
      services: groups.reduce((count, item) => count + item.services.length, 0),
      preservedFields,
      groupIcons,
    },
    source,
    ...(settingsSource?.trim() ? { settingsSource } : {}),
  };
}

function safeLegacyConfig(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value) return {};
  return (safeClone(value) ?? {}) as Record<string, unknown>;
}

export function exportHomepageYaml(groups: DashboardGroup[]): string {
  const document = [...groups]
    .sort((a, b) => a.position - b.position)
    .map((group) => ({
      [group.name]: [...group.services]
        .sort((a, b) => a.position - b.position)
        .map((service) => {
          const config: Record<string, unknown> = {
            ...safeLegacyConfig(service.legacyConfig),
          };
          if (service.icon) config.icon = service.icon;
          config.href = service.href;
          if (service.description) config.description = service.description;
          if (service.dockerServer) config.server = service.dockerServer;
          if (service.container) config.container = service.container;
          return { [service.name]: config };
        }),
    }));

  return dump(document, {
    noRefs: true,
    noCompatMode: true,
    lineWidth: 120,
    sortKeys: false,
    quotingType: '"',
  });
}

/**
 * Export the documented Homepage category layout. This is intentionally a
 * minimal settings.yaml file: unrelated Homepage settings are not invented.
 */
export function exportHomepageSettingsYaml(groups: DashboardGroup[]): string {
  const layout = [...groups]
    .sort((a, b) => a.position - b.position)
    .map((group) => ({
      [group.name]: group.icon.trim() ? { icon: group.icon.trim() } : {},
    }));

  return dump({ layout }, {
    noRefs: true,
    noCompatMode: true,
    lineWidth: 120,
    sortKeys: false,
    quotingType: '"',
  });
}

import { MDI_ICONS_REVISION, SIMPLE_ICONS_REVISION } from "../shared/icons.js";

export type SvgIconSet = "mdi" | "si";

const MAX_SVG_BYTES = 256_000;
const SAFE_ICON_NAME = /^[a-z0-9][a-z0-9._-]*$/;
const ICON_SOURCES: Record<SvgIconSet, readonly string[]> = {
  mdi: [
    `https://cdn.jsdelivr.net/npm/@mdi/svg@${MDI_ICONS_REVISION}/svg/`,
    `https://unpkg.com/@mdi/svg@${MDI_ICONS_REVISION}/svg/`,
  ],
  si: [
    `https://cdn.jsdelivr.net/npm/simple-icons@${SIMPLE_ICONS_REVISION}/icons/`,
    `https://unpkg.com/simple-icons@${SIMPLE_ICONS_REVISION}/icons/`,
  ],
};

const svgCache = new Map<string, Promise<string>>();

function validSvg(svg: string): boolean {
  return (
    svg.length > 0 &&
    svg.length <= MAX_SVG_BYTES &&
    /^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(svg) &&
    !/<(?:script|style|foreignObject|iframe|object|embed|image|use|animate|set)(?:\s|>)/i.test(svg) &&
    !/\bon[a-z]+\s*=/i.test(svg) &&
    !/\b(?:href|xlink:href)\s*=/i.test(svg) &&
    !/(?:url\s*\(|@import|<!doctype|<!entity)/i.test(svg)
  );
}

export function normalizeSvgIconName(name: string): string {
  const value = name.trim().replace(/\.svg$/i, "").toLocaleLowerCase();
  if (!SAFE_ICON_NAME.test(value)) throw new Error("Invalid icon name.");
  return value;
}

export async function loadPinnedSvgIcon(
  set: SvgIconSet,
  name: string,
  request: typeof fetch = fetch,
): Promise<string> {
  const normalizedName = normalizeSvgIconName(name);
  const cacheKey = `${set}:${normalizedName}`;
  const cached = svgCache.get(cacheKey);
  if (cached) return cached;

  const load = (async () => {
    let lastError: unknown;
    for (const base of ICON_SOURCES[set]) {
      try {
        const response = await request(base + encodeURIComponent(normalizedName) + ".svg", {
          headers: { Accept: "image/svg+xml" },
          signal: AbortSignal.timeout(7_000),
        });
        if (!response.ok) throw new Error(`Icon request failed with ${response.status}.`);
        const svg = await response.text();
        if (!validSvg(svg)) throw new Error("Icon response is not a safe SVG.");
        return svg;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("Icon could not be loaded.");
  })().catch((error) => {
    svgCache.delete(cacheKey);
    throw error;
  });

  svgCache.set(cacheKey, load);
  return load;
}

export function clearSvgIconCache(): void {
  svgCache.clear();
}

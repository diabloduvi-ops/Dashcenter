export const APPEARANCE_VERSION = 1 as const;

export const APPEARANCE_PRESET_IDS = ["forest", "graphite", "nord", "warm"] as const;
export type AppearancePresetId = typeof APPEARANCE_PRESET_IDS[number];
export type AppearancePresetSelection = AppearancePresetId | "custom";

export interface AppearanceColors {
  canvas: string;
  surface: string;
  surfaceRaised: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  accent: string;
  accentContrast: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  focus: string;
  overlay: string;
}

export interface AppearanceSurfaces {
  glassOpacity: number;
  blur: number;
  overlayOpacity: number;
  borderStrength: "subtle" | "balanced" | "strong";
  radius: "compact" | "balanced" | "rounded";
  shadow: "flat" | "soft" | "lifted";
  density: "compact" | "comfortable";
}

export interface AppearanceTypography {
  family: "system";
  scale: "compact" | "default" | "large";
  weight: "regular" | "balanced" | "strong";
  numbers: "tabular" | "proportional";
}

export interface AppearanceIcons {
  treatment: "original" | "monochrome";
  size: "small" | "medium" | "large";
  frameShape: "square" | "rounded" | "circle";
  frameStyle: "none" | "subtle" | "filled";
}

export interface AppearanceMotion {
  level: "full" | "reduced" | "minimal";
}

export interface DashboardAppearance {
  version: typeof APPEARANCE_VERSION;
  preset: AppearancePresetSelection;
  colors: AppearanceColors;
  surfaces: AppearanceSurfaces;
  typography: AppearanceTypography;
  icons: AppearanceIcons;
  motion: AppearanceMotion;
}

export interface AppearancePresetDefinition {
  id: AppearancePresetId;
  label: string;
  description: string;
  appearance: DashboardAppearance;
}

const SHARED_APPEARANCE = {
  typography: {
    family: "system",
    scale: "default",
    weight: "balanced",
    numbers: "tabular",
  },
  icons: {
    treatment: "original",
    size: "medium",
    frameShape: "rounded",
    frameStyle: "subtle",
  },
  motion: { level: "full" },
} as const;

export const APPEARANCE_PRESETS: Record<AppearancePresetId, AppearancePresetDefinition> = {
  forest: {
    id: "forest",
    label: "Forest",
    description: "The original deep-green Dashcenter identity.",
    appearance: {
      version: APPEARANCE_VERSION,
      preset: "forest",
      colors: {
        canvas: "#06100d",
        surface: "#081313",
        surfaceRaised: "#0d1d18",
        text: "#f1f6f4",
        textMuted: "#a8b5b1",
        textFaint: "#74827d",
        border: "#dcefe9",
        accent: "#4ee28a",
        accentContrast: "#062113",
        success: "#34c759",
        warning: "#f5a623",
        danger: "#e55353",
        info: "#56a8ff",
        focus: "#79efaa",
        overlay: "#030a08",
      },
      surfaces: {
        glassOpacity: 0.31,
        blur: 17,
        overlayOpacity: 0.17,
        borderStrength: "balanced",
        radius: "balanced",
        shadow: "soft",
        density: "comfortable",
      },
      ...SHARED_APPEARANCE,
    },
  },
  graphite: {
    id: "graphite",
    label: "Graphite",
    description: "Neutral charcoal surfaces with a cool blue accent.",
    appearance: {
      version: APPEARANCE_VERSION,
      preset: "graphite",
      colors: {
        canvas: "#0c0d0f",
        surface: "#17191d",
        surfaceRaised: "#20232a",
        text: "#f2f3f5",
        textMuted: "#afb3bb",
        textFaint: "#747983",
        border: "#e0e3e8",
        accent: "#8ea1ff",
        accentContrast: "#0b102c",
        success: "#55c985",
        warning: "#e8b65d",
        danger: "#e26d75",
        info: "#6faef8",
        focus: "#aab7ff",
        overlay: "#090a0c",
      },
      surfaces: {
        glassOpacity: 0.46,
        blur: 16,
        overlayOpacity: 0.32,
        borderStrength: "balanced",
        radius: "balanced",
        shadow: "soft",
        density: "comfortable",
      },
      ...SHARED_APPEARANCE,
    },
  },
  nord: {
    id: "nord",
    label: "Nord",
    description: "Cool blue-grey surfaces with quiet arctic contrast.",
    appearance: {
      version: APPEARANCE_VERSION,
      preset: "nord",
      colors: {
        canvas: "#101720",
        surface: "#19232f",
        surfaceRaised: "#222f3d",
        text: "#eceff4",
        textMuted: "#b6c2d0",
        textFaint: "#78899a",
        border: "#d8e2ee",
        accent: "#88c0d0",
        accentContrast: "#10232a",
        success: "#a3be8c",
        warning: "#ebcb8b",
        danger: "#bf616a",
        info: "#81a1c1",
        focus: "#8fbcbb",
        overlay: "#0d141d",
      },
      surfaces: {
        glassOpacity: 0.5,
        blur: 18,
        overlayOpacity: 0.3,
        borderStrength: "balanced",
        radius: "balanced",
        shadow: "soft",
        density: "comfortable",
      },
      ...SHARED_APPEARANCE,
    },
  },
  warm: {
    id: "warm",
    label: "Warm",
    description: "Earthy dark surfaces with a soft amber accent.",
    appearance: {
      version: APPEARANCE_VERSION,
      preset: "warm",
      colors: {
        canvas: "#17110d",
        surface: "#241b15",
        surfaceRaised: "#30241b",
        text: "#faf1e7",
        textMuted: "#c8b7a6",
        textFaint: "#8f7a68",
        border: "#f0dfcf",
        accent: "#e8a15b",
        accentContrast: "#2a1607",
        success: "#87b37a",
        warning: "#e8b95f",
        danger: "#d86f65",
        info: "#73a7c9",
        focus: "#f0b873",
        overlay: "#170e08",
      },
      surfaces: {
        glassOpacity: 0.48,
        blur: 15,
        overlayOpacity: 0.34,
        borderStrength: "balanced",
        radius: "rounded",
        shadow: "soft",
        density: "comfortable",
      },
      ...SHARED_APPEARANCE,
    },
  },
};

function cloneAppearance(appearance: DashboardAppearance): DashboardAppearance {
  return structuredClone(appearance);
}

export function appearancePreset(id: AppearancePresetId): DashboardAppearance {
  return cloneAppearance(APPEARANCE_PRESETS[id].appearance);
}

export function appearanceMatchesPreset(appearance: DashboardAppearance, id: AppearancePresetId): boolean {
  const candidate = { ...appearance, preset: id };
  return JSON.stringify(candidate) === JSON.stringify(APPEARANCE_PRESETS[id].appearance);
}

export function appearanceFromLegacy(values: {
  accent: string;
  glassOpacity: number;
  blur: number;
  density: "compact" | "comfortable";
}): DashboardAppearance {
  const appearance = appearancePreset("forest");
  appearance.colors.accent = values.accent;
  appearance.surfaces.glassOpacity = values.glassOpacity;
  appearance.surfaces.blur = values.blur;
  appearance.surfaces.density = values.density;
  appearance.preset = appearanceMatchesPreset(appearance, "forest") ? "forest" : "custom";
  return appearance;
}

export function withDashboardAppearance<T extends {
  accent: string;
  glassOpacity: number;
  blur: number;
  density: "compact" | "comfortable";
}>(settings: T, appearance: DashboardAppearance): T & { appearance: DashboardAppearance } {
  const next = cloneAppearance(appearance);
  return {
    ...settings,
    accent: next.colors.accent,
    glassOpacity: next.surfaces.glassOpacity,
    blur: next.surfaces.blur,
    density: next.surfaces.density,
    appearance: next,
  };
}

export function customizeDashboardAppearance<T extends {
  appearance: DashboardAppearance;
  accent: string;
  glassOpacity: number;
  blur: number;
  density: "compact" | "comfortable";
}>(settings: T, update: (appearance: DashboardAppearance) => void): T {
  const appearance = cloneAppearance(settings.appearance);
  update(appearance);
  appearance.preset = "custom";
  return withDashboardAppearance(settings, appearance);
}

export function appearanceCssVariables(appearance: DashboardAppearance): Record<string, string | number> {
  const borderAlpha = appearance.surfaces.borderStrength === "subtle" ? 9
    : appearance.surfaces.borderStrength === "strong" ? 23 : 15;
  const radii = appearance.surfaces.radius === "compact"
    ? [6, 7, 9, 12]
    : appearance.surfaces.radius === "rounded"
      ? [10, 12, 16, 20]
      : [8, 9, 12, 16];
  const shadow = appearance.surfaces.shadow === "flat" ? "none"
    : appearance.surfaces.shadow === "lifted" ? "0 18px 48px rgba(0, 0, 0, 0.34)"
      : "0 12px 34px rgba(0, 0, 0, 0.22)";
  const durations = appearance.motion.level === "minimal" ? ["0.01ms", "0.01ms"]
    : appearance.motion.level === "reduced" ? ["120ms", "160ms"]
      : ["180ms", "240ms"];
  const scale = appearance.typography.scale === "compact" ? 0.94
    : appearance.typography.scale === "large" ? 1.08 : 1;
  const iconSize = appearance.icons.size === "small" ? "18px"
    : appearance.icons.size === "large" ? "24px" : "21px";
  const serviceIconSize = appearance.icons.size === "small" ? "26px"
    : appearance.icons.size === "large" ? "34px" : "30px";
  const iconRadius = appearance.icons.frameShape === "square" ? "3px"
    : appearance.icons.frameShape === "circle" ? "999px" : `${radii[1]}px`;
  const iconFrameBackground = appearance.icons.frameStyle === "none" ? "transparent"
    : appearance.icons.frameStyle === "filled" ? appearance.colors.surfaceRaised
      : `color-mix(in srgb, ${appearance.colors.text} 6%, transparent)`;
  const iconFrameBorder = appearance.icons.frameStyle === "none" ? "transparent"
    : `color-mix(in srgb, ${appearance.colors.border} ${appearance.icons.frameStyle === "filled" ? 24 : 10}%, transparent)`;
  const weights = appearance.typography.weight === "regular" ? [400, 500, 600, 700]
    : appearance.typography.weight === "strong" ? [500, 600, 700, 750]
      : [450, 550, 650, 700];

  return {
    "--dc-color-canvas": appearance.colors.canvas,
    "--dc-color-canvas-deep": `color-mix(in srgb, ${appearance.colors.canvas} 78%, black)`,
    "--dc-color-surface": appearance.colors.surface,
    "--dc-color-surface-raised": appearance.colors.surfaceRaised,
    "--dc-color-surface-soft": `color-mix(in srgb, ${appearance.colors.text} 4.5%, transparent)`,
    "--dc-color-surface-hover": `color-mix(in srgb, ${appearance.colors.text} 8.2%, transparent)`,
    "--dc-color-surface-selected": `color-mix(in srgb, ${appearance.colors.accent} 10.5%, transparent)`,
    "--dc-color-glass": `color-mix(in srgb, ${appearance.colors.surface} ${Math.round(appearance.surfaces.glassOpacity * 100)}%, transparent)`,
    "--dc-color-text": appearance.colors.text,
    "--dc-color-text-muted": appearance.colors.textMuted,
    "--dc-color-text-faint": appearance.colors.textFaint,
    "--dc-color-border-subtle": `color-mix(in srgb, ${appearance.colors.border} ${Math.max(5, borderAlpha - 6)}%, transparent)`,
    "--dc-color-border": `color-mix(in srgb, ${appearance.colors.border} ${borderAlpha}%, transparent)`,
    "--dc-color-border-strong": `color-mix(in srgb, ${appearance.colors.border} ${Math.min(34, borderAlpha + 10)}%, transparent)`,
    "--dc-color-accent": appearance.colors.accent,
    "--dc-color-accent-hover": `color-mix(in srgb, ${appearance.colors.accent} 82%, white)`,
    "--dc-color-accent-contrast": appearance.colors.accentContrast,
    "--dc-color-success": appearance.colors.success,
    "--dc-color-warning": appearance.colors.warning,
    "--dc-color-danger": appearance.colors.danger,
    "--dc-color-info": appearance.colors.info,
    "--dc-color-focus": appearance.colors.focus,
    "--dc-focus-ring": `0 0 0 3px color-mix(in srgb, ${appearance.colors.focus} 22%, transparent)`,
    "--dc-background-overlay": `color-mix(in srgb, ${appearance.colors.overlay} ${Math.round(appearance.surfaces.overlayOpacity * 100)}%, transparent)`,
    "--dc-glass-blur": `${appearance.surfaces.blur}px`,
    "--dc-radius-icon": `${radii[0]}px`,
    "--dc-radius-control": `${radii[1]}px`,
    "--dc-radius-panel": `${radii[2]}px`,
    "--dc-radius-shell": `${radii[3]}px`,
    "--dc-shadow-panel": shadow,
    "--dc-duration-feedback": durations[0],
    "--dc-duration-pane": durations[1],
    "--dc-type-scale": scale,
    "--dc-text-page": `${1.75 * scale}rem`,
    "--dc-text-section": `${1.0625 * scale}rem`,
    "--dc-text-body": `${0.875 * scale}rem`,
    "--dc-text-helper": `${0.75 * scale}rem`,
    "--dc-weight-regular": weights[0],
    "--dc-weight-medium": weights[1],
    "--dc-weight-semibold": weights[2],
    "--dc-weight-bold": weights[3],
    "--dc-number-style": appearance.typography.numbers === "tabular" ? "tabular-nums" : "proportional-nums",
    "--dc-icon-size": iconSize,
    "--dc-service-icon-size": serviceIconSize,
    "--dc-icon-frame-radius": iconRadius,
    "--dc-icon-frame-background": iconFrameBackground,
    "--dc-icon-frame-border": iconFrameBorder,
    "--dc-icon-filter": appearance.icons.treatment === "monochrome" ? "grayscale(1) saturate(0) opacity(0.9)" : "none",
    "--glass-alpha": appearance.surfaces.glassOpacity,
    "--glass-blur": `${appearance.surfaces.blur}px`,
    // Keep pre-token styles on the active preset until every screen reads the
    // semantic names directly. These aliases must be defined on the dashboard
    // shell: inherited aliases from :root have already resolved to Forest.
    "--accent": appearance.colors.accent,
    "--background": appearance.colors.canvas,
    "--surface": `color-mix(in srgb, ${appearance.colors.surface} ${Math.round(appearance.surfaces.glassOpacity * 100)}%, transparent)`,
    "--surface-raised": appearance.colors.surfaceRaised,
    "--surface-soft": `color-mix(in srgb, ${appearance.colors.text} 4.5%, transparent)`,
    "--surface-hover": `color-mix(in srgb, ${appearance.colors.text} 8.2%, transparent)`,
    "--text": appearance.colors.text,
    "--muted": appearance.colors.textMuted,
    "--faint": appearance.colors.textFaint,
    "--border": `color-mix(in srgb, ${appearance.colors.border} ${borderAlpha}%, transparent)`,
    "--border-strong": `color-mix(in srgb, ${appearance.colors.border} ${Math.min(34, borderAlpha + 10)}%, transparent)`,
    "--danger": appearance.colors.danger,
    "--shadow": shadow,
  };
}

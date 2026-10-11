import { ChangeEvent, useMemo, useRef, useState } from "react";
import {
  Check,
  Image,
  Monitor,
  Palette,
  RotateCcw,
  Save,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  APPEARANCE_PRESETS,
  APPEARANCE_PRESET_IDS,
  appearancePreset,
  customizeDashboardAppearance,
  withDashboardAppearance,
} from "../../../shared/appearance";
import type { AppearanceColors, AppearancePresetId, DashboardAppearance } from "../../../shared/appearance";
import type { DashboardData, DashboardSettings } from "../../../shared/types";
import type { DashboardPreviewMode } from "../../components/DashboardView";
import { AppearancePreview } from "./AppearancePreview";
import { apiRequest } from "./api";
import { Button, Field, Notice, SelectField, StatusPill } from "./ui";

interface AppearanceTabProps {
  data: DashboardData;
  onCommit: (next: DashboardData, message?: string) => Promise<boolean>;
}

type AppearanceSection = "theme" | "typography" | "surfaces" | "icons" | "motion";
type UploadResult = { url?: string; backgroundUrl?: string };

const CORE_COLOR_FIELDS: Array<{ key: keyof AppearanceColors; label: string }> = [
  { key: "accent", label: "Accent" },
  { key: "success", label: "Success" },
  { key: "warning", label: "Warning" },
  { key: "danger", label: "Danger" },
];

const ADVANCED_COLOR_FIELDS: Array<{ key: keyof AppearanceColors; label: string }> = [
  { key: "canvas", label: "Canvas" },
  { key: "surface", label: "Surface" },
  { key: "surfaceRaised", label: "Raised surface" },
  { key: "text", label: "Primary text" },
  { key: "textMuted", label: "Muted text" },
  { key: "textFaint", label: "Faint text" },
  { key: "border", label: "Borders" },
  { key: "accentContrast", label: "Accent contrast" },
  { key: "info", label: "Information" },
  { key: "focus", label: "Keyboard focus" },
  { key: "overlay", label: "Background overlay" },
];

const INSPECTOR_SECTIONS: Array<{ id: AppearanceSection; label: string }> = [
  { id: "theme", label: "Theme" },
  { id: "typography", label: "Typography" },
  { id: "surfaces", label: "Surfaces" },
  { id: "icons", label: "Icons" },
  { id: "motion", label: "Motion" },
];

const PREVIEW_MODES: Array<{ id: DashboardPreviewMode; label: string }> = [
  { id: "desktop", label: "Desktop" },
  { id: "tablet", label: "Tablet" },
  { id: "mobile", label: "Mobile" },
];

function uploadUrl(result: UploadResult) {
  return result.url ?? result.backgroundUrl ?? "";
}

function backgroundName(url: string) {
  const clean = url.split(/[?#]/, 1)[0];
  return clean.split("/").filter(Boolean).at(-1) || "Default forest background";
}

function ColorFields({ fields, appearance, onChange }: {
  fields: Array<{ key: keyof AppearanceColors; label: string }>;
  appearance: DashboardAppearance;
  onChange: (key: keyof AppearanceColors, value: string) => void;
}) {
  return (
    <div className="admin-semantic-colors">
      {fields.map(({ key, label }) => (
        <label className="admin-color-field" key={key}>
          <span>{label}</span>
          <input aria-label={`${label} color picker`} type="color" value={appearance.colors[key]} onChange={(event) => onChange(key, event.target.value)} />
          <input aria-label={`${label} hex value`} className="ui-input" value={appearance.colors[key]} onChange={(event) => onChange(key, event.target.value)} />
        </label>
      ))}
    </div>
  );
}

export function AppearanceTab({ data, onCommit }: AppearanceTabProps) {
  const initialPreset = data.settings.appearance.preset === "custom" ? "forest" : data.settings.appearance.preset;
  const [draft, setDraft] = useState<DashboardSettings>(() => structuredClone(data.settings));
  const [selectedPreset, setSelectedPreset] = useState<AppearancePresetId>(initialPreset);
  const [section, setSection] = useState<AppearanceSection>("theme");
  const [previewMode, setPreviewMode] = useState<DashboardPreviewMode>("desktop");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(data.settings), [data.settings, draft]);
  const softContrast = draft.appearance.surfaces.borderStrength === "subtle" && draft.appearance.typography.weight === "regular";

  function selectPreset(id: AppearancePresetId) {
    setSelectedPreset(id);
    setDraft((current) => withDashboardAppearance(current, appearancePreset(id)));
  }

  function resetPreset() {
    setDraft((current) => withDashboardAppearance(current, appearancePreset(selectedPreset)));
    setError("");
  }

  function updateAppearance(update: (appearance: DashboardAppearance) => void) {
    setDraft((current) => customizeDashboardAppearance(current, update));
  }

  function updateColor(key: keyof AppearanceColors, value: string) {
    updateAppearance((appearance) => { appearance.colors[key] = value; });
  }

  function setContrast(mode: "comfortable" | "soft") {
    updateAppearance((appearance) => {
      appearance.surfaces.borderStrength = mode === "soft" ? "subtle" : "balanced";
      appearance.typography.weight = mode === "soft" ? "regular" : "balanced";
    });
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const saved = await onCommit({ ...data, settings: draft }, "Appearance saved");
      if (!saved) setError("Could not save appearance. Your preview changes are still available.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadBackground(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    setUploadMessage("");
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await apiRequest<UploadResult>("/api/appearance/background", { method: "POST", body: form });
      const backgroundUrl = uploadUrl(result);
      if (!backgroundUrl) throw new Error("The server did not return the uploaded image URL.");
      setDraft((current) => ({ ...current, backgroundUrl }));
      setUploadMessage("Image uploaded. Save appearance to publish it.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not upload this image.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  return (
    <section className="admin-appearance-workspace">
      <header className="admin-appearance-workspace__topbar">
        <span><h1>Appearance</h1><small>Shape the visual system without changing dashboard content</small></span>
        <span className="admin-appearance-workspace__state"><StatusPill state={dirty ? "warning" : "success"}>{dirty ? "Unsaved preview" : "Saved"}</StatusPill></span>
        <div className="admin-appearance-workspace__actions">
          <Button onClick={resetPreset} disabled={busy}><RotateCcw size={16} /> Reset preset</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !dirty}><Save size={16} /> {busy ? "Saving…" : "Save appearance"}</Button>
        </div>
      </header>

      {error ? <Notice kind="danger">{error}</Notice> : null}

      <div className="admin-appearance-workspace__body">
        <section className="admin-appearance-preview-pane" aria-labelledby="appearance-preview-title">
          <header>
            <span><strong id="appearance-preview-title">Live dashboard preview</strong><small>Your current services and widgets · visual changes are not published until saved</small></span>
            <div className="admin-appearance-viewports" role="radiogroup" aria-label="Dashboard preview size">
              {PREVIEW_MODES.map((option) => (
                <button key={option.id} type="button" role="radio" aria-checked={previewMode === option.id} onClick={() => setPreviewMode(option.id)}>
                  <Monitor size={15} /><span>{option.label}</span>
                </button>
              ))}
            </div>
          </header>
          <AppearancePreview data={data} settings={draft} mode={previewMode} />
        </section>

        <aside className="admin-appearance-inspector" aria-label="Appearance settings">
          <nav className="admin-appearance-inspector__tabs" aria-label="Appearance sections">
            {INSPECTOR_SECTIONS.map((item) => <button key={item.id} type="button" className={section === item.id ? "is-active" : ""} onClick={() => setSection(item.id)}>{item.label}</button>)}
          </nav>

          <div className="admin-appearance-inspector__content">
            {section === "theme" ? (
              <>
                <section className="admin-appearance-section">
                  <header><strong>Preset</strong><small>Choose a visual starting point for your dashboard.</small></header>
                  <div className="admin-appearance-presets">
                    {APPEARANCE_PRESET_IDS.map((id) => {
                      const definition = APPEARANCE_PRESETS[id];
                      const selected = selectedPreset === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          className="admin-appearance-preset"
                          aria-pressed={selected}
                          onClick={() => selectPreset(id)}
                          style={{
                            "--appearance-preset-canvas": definition.appearance.colors.canvas,
                            "--appearance-preset-surface": definition.appearance.colors.surfaceRaised,
                            "--appearance-preset-accent": definition.appearance.colors.accent,
                          } as React.CSSProperties}
                        >
                          <span className="admin-appearance-preset__image"><i /><i /><i />{selected ? <Check size={15} /> : null}</span>
                          <strong>{definition.label}</strong>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="admin-appearance-section">
                  <header><strong>Background</strong><small>Customize the dashboard image and readability overlay.</small></header>
                  <div className="admin-appearance-background">
                    <span style={{ backgroundImage: `linear-gradient(rgba(0,0,0,.2), rgba(0,0,0,.2)), url(${JSON.stringify(draft.backgroundUrl || "/assets/dashcenter-forest.png")})` }} />
                    <span><strong>{backgroundName(draft.backgroundUrl)}</strong><small>{draft.backgroundUrl || "/assets/dashcenter-forest.png"}</small></span>
                    <input ref={fileRef} className="admin-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={uploadBackground} />
                    <Button onClick={() => fileRef.current?.click()} disabled={uploading}><Upload size={15} /> {uploading ? "Uploading…" : "Change image"}</Button>
                  </div>
                  <Field label="Background URL" value={draft.backgroundUrl} onChange={(event) => setDraft((current) => ({ ...current, backgroundUrl: event.target.value }))} placeholder="/assets/dashcenter-forest.png" />
                  {uploadMessage ? <small className="admin-appearance-upload-message">{uploadMessage}</small> : null}
                  <label className="ui-range-field">
                    <span><strong>Overlay strength</strong><output>{Math.round(draft.appearance.surfaces.overlayOpacity * 100)}%</output></span>
                    <input type="range" min="0" max="0.9" step="0.01" value={draft.appearance.surfaces.overlayOpacity} onChange={(event) => updateAppearance((appearance) => { appearance.surfaces.overlayOpacity = Number(event.target.value); })} />
                  </label>
                </section>

                <section className="admin-appearance-section">
                  <header><strong>Semantic colors</strong><small>Customize roles shared by every dashboard component.</small></header>
                  <ColorFields fields={CORE_COLOR_FIELDS} appearance={draft.appearance} onChange={updateColor} />
                  <details className="admin-appearance-advanced-colors"><summary>Advanced semantic colors</summary><ColorFields fields={ADVANCED_COLOR_FIELDS} appearance={draft.appearance} onChange={updateColor} /></details>
                </section>

                <section className="admin-appearance-section">
                  <header><strong>Contrast</strong><small>Choose the overall visual emphasis without per-component overrides.</small></header>
                  <div className="admin-appearance-choice-grid">
                    <button type="button" aria-pressed={!softContrast} onClick={() => setContrast("comfortable")}><i /><span><strong>Comfortable</strong><small>Balanced weight and borders.</small></span></button>
                    <button type="button" aria-pressed={softContrast} onClick={() => setContrast("soft")}><i /><span><strong>Soft</strong><small>Quieter text and borders.</small></span></button>
                  </div>
                </section>
              </>
            ) : null}

            {section === "typography" ? (
              <section className="admin-appearance-section">
                <header><strong>Typography</strong><small>Use one shared family, scale, weight and number style.</small></header>
                <div className="admin-appearance-form">
                  <SelectField label="UI family" value={draft.appearance.typography.family} onChange={() => undefined} disabled><option value="system">System UI</option></SelectField>
                  <SelectField label="Type scale" value={draft.appearance.typography.scale} onChange={(scale) => updateAppearance((appearance) => { appearance.typography.scale = scale as DashboardAppearance["typography"]["scale"]; })}><option value="compact">Compact</option><option value="default">Default</option><option value="large">Large</option></SelectField>
                  <SelectField label="Text weight" value={draft.appearance.typography.weight} onChange={(weight) => updateAppearance((appearance) => { appearance.typography.weight = weight as DashboardAppearance["typography"]["weight"]; })}><option value="regular">Regular</option><option value="balanced">Balanced</option><option value="strong">Strong</option></SelectField>
                  <SelectField label="Metric numbers" value={draft.appearance.typography.numbers} onChange={(numbers) => updateAppearance((appearance) => { appearance.typography.numbers = numbers as DashboardAppearance["typography"]["numbers"]; })}><option value="tabular">Tabular</option><option value="proportional">Proportional</option></SelectField>
                  <p className="admin-appearance-note"><Palette size={15} /> Typography tokens apply to the dashboard preview and published dashboard together.</p>
                </div>
              </section>
            ) : null}

            {section === "surfaces" ? (
              <section className="admin-appearance-section">
                <header><strong>Surfaces</strong><small>Control readability, depth and shared shape.</small></header>
                <div className="admin-appearance-form">
                  <label className="ui-range-field"><span><strong>Panel opacity</strong><output>{Math.round(draft.appearance.surfaces.glassOpacity * 100)}%</output></span><input type="range" min="0.15" max="0.95" step="0.01" value={draft.appearance.surfaces.glassOpacity} onChange={(event) => updateAppearance((appearance) => { appearance.surfaces.glassOpacity = Number(event.target.value); })} /></label>
                  <label className="ui-range-field"><span><strong>Background blur</strong><output>{draft.appearance.surfaces.blur}px</output></span><input type="range" min="0" max="30" step="1" value={draft.appearance.surfaces.blur} onChange={(event) => updateAppearance((appearance) => { appearance.surfaces.blur = Number(event.target.value); })} /></label>
                  <SelectField label="Border strength" value={draft.appearance.surfaces.borderStrength} onChange={(borderStrength) => updateAppearance((appearance) => { appearance.surfaces.borderStrength = borderStrength as DashboardAppearance["surfaces"]["borderStrength"]; })}><option value="subtle">Subtle</option><option value="balanced">Balanced</option><option value="strong">Strong</option></SelectField>
                  <SelectField label="Corner radius" value={draft.appearance.surfaces.radius} onChange={(radius) => updateAppearance((appearance) => { appearance.surfaces.radius = radius as DashboardAppearance["surfaces"]["radius"]; })}><option value="compact">Compact</option><option value="balanced">Balanced</option><option value="rounded">Rounded</option></SelectField>
                  <SelectField label="Shadow" value={draft.appearance.surfaces.shadow} onChange={(shadow) => updateAppearance((appearance) => { appearance.surfaces.shadow = shadow as DashboardAppearance["surfaces"]["shadow"]; })}><option value="flat">Flat</option><option value="soft">Soft</option><option value="lifted">Lifted</option></SelectField>
                  <SelectField label="Dashboard density" value={draft.appearance.surfaces.density} onChange={(density) => updateAppearance((appearance) => { appearance.surfaces.density = density as DashboardAppearance["surfaces"]["density"]; })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></SelectField>
                </div>
              </section>
            ) : null}

            {section === "icons" ? (
              <section className="admin-appearance-section">
                <header><strong>Icons</strong><small>Set one consistent treatment for service and group icons.</small></header>
                <div className="admin-appearance-form">
                  <SelectField label="Treatment" value={draft.appearance.icons.treatment} onChange={(treatment) => updateAppearance((appearance) => { appearance.icons.treatment = treatment as DashboardAppearance["icons"]["treatment"]; })}><option value="original">Original</option><option value="monochrome">Monochrome</option></SelectField>
                  <SelectField label="Icon size" value={draft.appearance.icons.size} onChange={(size) => updateAppearance((appearance) => { appearance.icons.size = size as DashboardAppearance["icons"]["size"]; })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></SelectField>
                  <SelectField label="Frame shape" value={draft.appearance.icons.frameShape} onChange={(frameShape) => updateAppearance((appearance) => { appearance.icons.frameShape = frameShape as DashboardAppearance["icons"]["frameShape"]; })}><option value="square">Square</option><option value="rounded">Rounded</option><option value="circle">Circle</option></SelectField>
                  <SelectField label="Frame style" value={draft.appearance.icons.frameStyle} onChange={(frameStyle) => updateAppearance((appearance) => { appearance.icons.frameStyle = frameStyle as DashboardAppearance["icons"]["frameStyle"]; })}><option value="none">None</option><option value="subtle">Subtle</option><option value="filled">Filled</option></SelectField>
                  <p className="admin-appearance-note"><Image size={15} /> Brand icons stay in their original style unless monochrome treatment is selected.</p>
                </div>
              </section>
            ) : null}

            {section === "motion" ? (
              <section className="admin-appearance-section">
                <header><strong>Motion</strong><small>Choose the dashboard transition level.</small></header>
                <div className="admin-appearance-choice-grid admin-appearance-choice-grid--motion">
                  {(["full", "reduced", "minimal"] as const).map((level) => (
                    <button key={level} type="button" aria-pressed={draft.appearance.motion.level === level} onClick={() => updateAppearance((appearance) => { appearance.motion.level = level; })}>
                      <i /><span><strong>{level[0].toUpperCase() + level.slice(1)}</strong><small>{level === "full" ? "Complete interface feedback." : level === "reduced" ? "Shorter, quieter transitions." : "Essential state changes only."}</small></span>
                    </button>
                  ))}
                </div>
                <p className="admin-appearance-note"><Sparkles size={15} /> The operating-system reduced-motion preference always takes priority.</p>
              </section>
            ) : null}
          </div>

          <footer className="admin-appearance-inspector__footer"><span><i /> Changes are previewed instantly.</span><small>Model v{draft.appearance.version}{draft.appearance.preset === "custom" ? " · Custom" : ` · ${APPEARANCE_PRESETS[draft.appearance.preset].label}`}</small></footer>
        </aside>
      </div>
    </section>
  );
}

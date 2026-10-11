import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tokens = readFileSync(new URL("../src/design-tokens.css", import.meta.url), "utf8");
const dashboardCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const adminCss = readFileSync(new URL("../src/features/admin/admin.css", import.meta.url), "utf8");
const primitives = readFileSync(new URL("../src/features/admin/ui.tsx", import.meta.url), "utf8");
const entry = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const appearanceSource = readFileSync(new URL("../src/features/admin/AppearanceTab.tsx", import.meta.url), "utf8");
const appearancePreviewSource = readFileSync(new URL("../src/features/admin/AppearancePreview.tsx", import.meta.url), "utf8");

test("shared semantic tokens load before the dashboard styles", () => {
  const tokenImport = entry.indexOf('import "./design-tokens.css"');
  const dashboardImport = entry.indexOf('import "./styles.css"');
  assert.ok(tokenImport >= 0);
  assert.ok(dashboardImport > tokenImport);
});

test("the Forest foundation defines semantic roles, dimensions and motion", () => {
  for (const token of [
    "--dc-color-canvas",
    "--dc-color-surface",
    "--dc-color-text",
    "--dc-color-text-muted",
    "--dc-color-accent",
    "--dc-color-success",
    "--dc-color-warning",
    "--dc-color-danger",
    "--dc-color-focus",
    "--dc-radius-shell",
    "--dc-control-height",
    "--dc-touch-target",
    "--dc-duration-feedback",
    "--dc-duration-pane",
  ]) assert.match(tokens, new RegExp(`${token}:`));
  assert.match(tokens, /@media \(prefers-reduced-motion: reduce\)/);
});

test("the Forest background stays visible beneath the semantic readability overlay", () => {
  assert.match(tokens, /--dc-background-overlay:\s*rgba\(3, 10, 8, 0\.17\)/);
  assert.match(dashboardCss, /linear-gradient\(var\(--dc-background-overlay\), var\(--dc-background-overlay\)\)/);
});

test("legacy dashboard and admin roles map to the shared contract", () => {
  assert.match(tokens, /--accent:\s*var\(--dc-color-accent\)/);
  assert.match(tokens, /--surface-raised:\s*var\(--dc-color-surface-raised\)/);
  assert.match(adminCss, /--admin-bg:\s*var\(--dc-color-canvas\)/);
  assert.match(adminCss, /--admin-accent:\s*var\(--dc-color-accent\)/);
  assert.match(adminCss, /--admin-danger:\s*var\(--dc-color-danger\)/);
  assert.match(dashboardCss, /outline:\s*2px solid var\(--dc-color-focus\)/);
});

test("form and status primitives expose accessible error and live states", () => {
  assert.match(primitives, /aria-invalid=\{error \? true : undefined\}/);
  assert.match(primitives, /aria-describedby=\{descriptionId\}/);
  assert.match(primitives, /role=\{kind === "danger" \? "alert" : kind === "success" \? "status" : undefined\}/);
  assert.match(primitives, /state === "warning"/);
  assert.match(primitives, /state === "info"/);
  assert.match(adminCss, /\.ui-notice--warning/);
  assert.match(adminCss, /\.ui-notice--info/);
  assert.match(adminCss, /\.ui-status-pill--warning/);
  assert.match(adminCss, /\.ui-status-pill--info/);
});

test("appearance exposes the approved responsive preview and versioned semantic controls", () => {
  assert.match(appearanceSource, /APPEARANCE_PRESET_IDS/);
  assert.match(appearanceSource, /Model v\{draft\.appearance\.version\}/);
  assert.match(appearanceSource, /Semantic colors/);
  assert.match(appearanceSource, /Reset preset/);
  assert.match(appearanceSource, /Save appearance/);
  assert.match(appearanceSource, /"theme" \| "typography" \| "surfaces" \| "icons" \| "motion"/);
  assert.match(appearanceSource, /Desktop/);
  assert.match(appearanceSource, /Tablet/);
  assert.match(appearanceSource, /Mobile/);
  assert.match(appearancePreviewSource, /desktop:\s*\{ width: 1200, minHeight: 780 \}/);
  assert.match(appearancePreviewSource, /tablet:\s*\{ width: 768, minHeight: 1024 \}/);
  assert.match(appearancePreviewSource, /mobile:\s*\{ width: 390, minHeight: 844 \}/);
  assert.match(appearancePreviewSource, /data=\{previewData\}/);
  assert.doesNotMatch(appearanceSource, /custom CSS/i);
  assert.match(adminCss, /\.admin-appearance-preset\[aria-pressed="true"\]/);
  assert.match(adminCss, /\.admin-appearance-workspace__body\s*\{/);
  assert.match(adminCss, /\.admin-appearance-preview-host\s*\{/);
  assert.match(adminCss, /\.admin-appearance-inspector__tabs\s*\{/);
});

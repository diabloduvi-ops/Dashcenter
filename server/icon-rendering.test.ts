import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceIconSource = readFileSync(
  new URL("../src/components/ServiceIcon.tsx", import.meta.url),
  "utf8",
);
const iconPickerSource = readFileSync(
  new URL("../src/features/admin/IconPickerField.tsx", import.meta.url),
  "utf8",
);
const servicesSource = readFileSync(
  new URL("../src/features/admin/ServicesTab.tsx", import.meta.url),
  "utf8",
);

test("masked icon rendering retries a pinned fallback and uses a local SVG data URI", () => {
  assert.match(serviceIconSource, /for \(const source of \[resolved\.src, resolved\.fallbackSrc\]\)/);
  assert.match(serviceIconSource, /data:image\/svg\+xml;charset=utf-8/);
  assert.match(serviceIconSource, /maskSourceCache/);
});

test("manual SVG icon sets use the same-origin proxy before the external fallback", () => {
  assert.match(serviceIconSource, /loadMaskSource/);
  const iconSource = readFileSync(new URL("../shared/icons.ts", import.meta.url), "utf8");
  assert.match(iconSource, /SVG_ICON_PROXY_BASE \+ "\/" \+ prefix/);
  assert.match(iconSource, /https:\/\/unpkg\.com/);
});

test("manual icon fields report loading, success, and failure before save", () => {
  assert.match(iconPickerSource, /Checking icon/);
  assert.match(iconPickerSource, /Icon loaded successfully/);
  assert.match(iconPickerSource, /Icon not found or could not be loaded/);
  assert.match(iconPickerSource, /onLoadStateChange=\{setPreviewState\}/);
  assert.match(iconPickerSource, /await onApply\(normalized\)/);
});

test("choosing or uploading a group icon applies it immediately", () => {
  assert.match(iconPickerSource, /await applyValue\(result\.url\)/);
  assert.match(iconPickerSource, /void applyValue\(icon\)/);
  assert.match(servicesSource, /onApply=\{\(icon\) => saveGroup\(icon\)\}/);
});

test("a manually entered group icon applies on blur or Enter without duplicate saves", () => {
  assert.match(iconPickerSource, /onBlur=\{\(event\) => \{\s*if \(onApply\) \{\s*void applyValue\(event\.currentTarget\.value\)/);
  assert.match(iconPickerSource, /event\.key === "Enter" && onApply/);
  assert.match(servicesSource, /groupSaveInFlightRef/);
});

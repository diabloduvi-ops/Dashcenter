import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appearanceSource = readFileSync(
  new URL("../src/features/admin/AppearanceTab.tsx", import.meta.url),
  "utf8",
);
const appearancePreviewSource = readFileSync(
  new URL("../src/features/admin/AppearancePreview.tsx", import.meta.url),
  "utf8",
);
const dashboardTabSource = readFileSync(
  new URL("../src/features/admin/DashboardTab.tsx", import.meta.url),
  "utf8",
);
const appSource = readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);
const servicesSource = readFileSync(
  new URL("../src/features/admin/ServicesTab.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../src/components/DashboardView.tsx", import.meta.url),
  "utf8",
);
const dashboardCss = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);
const adminCss = readFileSync(
  new URL("../src/features/admin/admin.css", import.meta.url),
  "utf8",
);

test("the approved dedicated workspace owns layout editing while Appearance stays visual", () => {
  assert.doesNotMatch(appearanceSource, /<DashboardLayoutEditor/);
  assert.doesNotMatch(appearanceSource, /Save appearance & layout/);
  assert.match(appearanceSource, /<AppearancePreview data=\{data\} settings=\{draft\} mode=\{previewMode\}/);
  assert.match(appearancePreviewSource, /<DashboardView[\s\S]*data=\{previewData\}[\s\S]*mode="appearance"/);
  assert.doesNotMatch(appearancePreviewSource, /fetch\(|apiRequest/);
  assert.doesNotMatch(dashboardTabSource, /<DashboardLayoutEditor/);
  assert.match(dashboardTabSource, /<DashboardView/);
  assert.match(dashboardTabSource, /mode="workspace"/);
  assert.match(dashboardTabSource, /Desktop/);
  assert.match(dashboardTabSource, /Tablet/);
  assert.match(dashboardTabSource, /Mobile/);
  assert.match(dashboardTabSource, /Close editor/);
  assert.match(dashboardTabSource, /Dashboard name/);
  assert.match(dashboardTabSource, /Save changes/);
  assert.match(dashboardTabSource, /past, setPast/);
  assert.match(dashboardTabSource, /future, setFuture/);
  assert.match(dashboardTabSource, /const saved = await onCommit\(next/);
  assert.doesNotMatch(servicesSource, /Dashboard columns/);
  assert.doesNotMatch(servicesSource, /Save group & grid/);
  assert.match(dashboardSource, /Dashboard settings/);
  assert.match(dashboardSource, /dashboard-editor-workspace/);
  assert.match(dashboardSource, /Dashboard layout inspector/);
  assert.match(dashboardSource, />Add<\/button>/);
  assert.match(dashboardSource, />Selected<\/button>/);
  assert.match(dashboardSource, /rectSwappingStrategy/);
  assert.match(dashboardSource, /pointerWithin/);
  assert.match(dashboardSource, /arraySwap/);
  assert.doesNotMatch(dashboardSource, /arrayMove/);
  assert.match(dashboardSource, /animateLayoutChanges:\s*\(\) => false/);
  assert.match(dashboardSource, /dashboard-grid-item--drop-target/);
  assert.match(dashboardSource, /Drag to resize/);
  assert.match(dashboardSource, /Service group direction/);
  assert.match(dashboardSource, /EDITOR_PREVIEW_COLUMN_WIDTH_PX = 300/);
  assert.match(dashboardSource, /--dashboard-editor-preview-min-width/);
  assert.match(appSource, /navigate\("\/admin"\)/);
  assert.doesNotMatch(dashboardSource, /dashboard-edit-bar/);
  assert.match(dashboardCss, /\.dashboard-editor-workspace\s*\{/);
  assert.match(dashboardCss, /\.dashboard-workspace-inspector\s*\{/);
  assert.match(dashboardCss, /\.dashboard-shell--preview-desktop \.dashboard-editor-preview-surface\s*\{[\s\S]*min-width:\s*var\(--dashboard-editor-preview-min-width\)/);
  assert.match(dashboardCss, /\.dashboard-shell--preview-tablet \.dashboard-editor-preview-surface\s*\{[\s\S]*width:\s*768px;[\s\S]*min-width:\s*768px/);
  assert.match(dashboardCss, /\.dashboard-shell--preview-mobile \.dashboard-editor-preview-surface\s*\{[\s\S]*width:\s*390px;[\s\S]*min-width:\s*390px/);
  assert.match(adminCss, /\.admin-dashboard-editor__topbar\s*\{/);
  assert.match(dashboardCss, /\.dashboard-grid-item__resize-handle/);
});

test("direct layout editor normalizes width, height, and placement when board columns change", () => {
  assert.match(dashboardSource, /reconcileDashboardGrid\(data\.layout, data\.groups, data\.widgets, boardColumnCount\)/);
  assert.match(dashboardSource, /normalizeGridColumnSpan\(item\.columnSpan, columns\)/);
  assert.match(dashboardSource, /normalizeGridColumnStart\(item\.columnStart, columns, columnSpan\)/);
  assert.match(dashboardSource, /normalizeGridRowSpan\(changes\.rowSpan\)/);
  assert.match(dashboardSource, /MAX_GRID_ROW_SPAN/);
});

test("published dashboard interleaves groups and widgets in measured content rows", () => {
  assert.match(dashboardSource, /reconcileDashboardGrid\(data\.layout, data\.groups, data\.widgets, boardColumnCount\)/);
  assert.match(dashboardSource, /dashboardItems\.map\(renderDashboardItem\)/);
  assert.match(dashboardSource, /data-layout-item=\{item\.id\}/);
  assert.match(dashboardSource, /minHeight:\s*rowSpan \? rowSpan \* GRID_ROW_HEIGHT_PX/);
  assert.match(dashboardSource, /Math\.max\(minimumHeight, contentHeight\)/);
  assert.match(dashboardSource, /new ResizeObserver\(measure\)/);
  assert.match(dashboardSource, /gridRowEnd:\s*measuredGridRows \? `span \$\{measuredGridRows\}`/);
  assert.match(dashboardCss, /\/\* Unified board foundation[\s\S]*grid-auto-flow:\s*dense/);
  assert.match(dashboardCss, /grid-auto-rows:\s*4px/);
  assert.match(dashboardCss, /\.dashboard-grid-item--fixed > \.service-group/);
  assert.match(dashboardCss, /\.dashboard-grid-item\s*\{[\s\S]*grid-column:\s*1 \/ -1 !important/);
});

test("service groups keep compact rows without overriding plugin presentation", () => {
  assert.doesNotMatch(dashboardSource, /presentation:\s*"summary" as const/);
  assert.match(dashboardSource, /group\.services\.map\(\(service\) => \([\s\S]*<ServiceRow key=\{service\.id\} service=\{service\}/);
  assert.match(dashboardCss, /\.service-group--horizontal \.service-rail\s*\{[\s\S]*minmax\(min\(100%, 300px\), 1fr\)/);
  assert.match(dashboardCss, /\.service-group--horizontal \.service-entry--plugin,[\s\S]*grid-column:\s*1 \/ -1/);
  assert.match(dashboardCss, /\.service-group--horizontal \.service-entry \.service-row,[\s\S]*grid-template-columns:\s*40px minmax\(0, 1fr\) auto 16px/);
  assert.match(dashboardCss, /\.steam-deals-rail\s*\{[\s\S]*grid-auto-flow:\s*row;[\s\S]*overflow:\s*visible/);
  assert.match(dashboardCss, /\.dashboard-grid-item--fixed\s*\{[\s\S]*overflow:\s*visible/);
});

test("Services uses the approved groups to services to inspector workspace", () => {
  assert.match(servicesSource, /Search groups…/);
  assert.match(servicesSource, /Filter services…/);
  assert.match(servicesSource, /type ServiceEditorSection = "general" \| "status" \| "plugin" \| "layout"/);
  assert.match(servicesSource, /aria-label="Service inspector"/);
  assert.match(servicesSource, /<ServiceCardPreview/);
  assert.match(servicesSource, /Dashboard preview/);
  assert.match(servicesSource, /setMobileView\("groups"\)/);
  assert.match(servicesSource, /setMobileView\("services"\)/);
  assert.match(servicesSource, /setMobileView\("inspector"\)/);
  assert.match(servicesSource, /const targetGroup = data\.groups\.find/);
  assert.match(servicesSource, /group\.services\.filter\(\(service\) => service\.id !== cleanService\.id\)/);
  assert.match(dashboardSource, /export function ServiceCardPreview/);
  assert.match(adminCss, /\.admin-services-layout\s*\{[\s\S]*minmax\(255px, 290px\)[\s\S]*minmax\(300px, 340px\)[\s\S]*minmax\(520px, 1fr\)/);
  assert.match(adminCss, /\.admin-inspector__form\s*\{[\s\S]*grid-template-rows:\s*auto auto minmax\(0, 1fr\) auto/);
  assert.match(adminCss, /@media \(max-width: 1439px\)[\s\S]*grid-template-columns:\s*285px minmax\(0, 1fr\)/);
  assert.match(adminCss, /\.admin-services-layout--groups \.admin-list-pane--groups/);
  assert.match(adminCss, /\.admin-services-layout--services \.admin-list-pane--services/);
  assert.match(adminCss, /\.admin-services-layout--inspector \.admin-inspector/);
});

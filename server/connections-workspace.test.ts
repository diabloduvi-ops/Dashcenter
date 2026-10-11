import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const adminSource = readSource("src/features/admin/AdminEditor.tsx");
const connectionsSource = readSource("src/features/admin/ConnectionsTab.tsx");
const primitivesSource = readSource("src/features/admin/ui.tsx");
const adminCss = readSource("src/features/admin/admin.css");

test("Connections is the infrastructure workspace and keeps Homepage as a migration action", () => {
  assert.match(adminSource, /id: "connections", label: "Connections"/);
  assert.doesNotMatch(adminSource, /id: "integrations"/);
  assert.match(connectionsSource, /Homepage migration/);
  assert.match(connectionsSource, /previewHomepageImport/);
  assert.match(connectionsSource, /commitHomepageImport/);
  assert.match(connectionsSource, /Import replaces existing groups and services/);
});

test("Connections keeps Docker list, detail, loading and confirmation states in one bounded workspace", () => {
  assert.match(connectionsSource, /admin-connections-workspace--\$\{mobileView\}/);
  assert.match(connectionsSource, /admin-connections-list-pane/);
  assert.match(connectionsSource, /aria-label="Connection details"/);
  assert.match(connectionsSource, /activeTask === "testing"/);
  assert.match(connectionsSource, /activeTask === "discovering"/);
  assert.match(connectionsSource, /<ConfirmDialog[\s\S]*Delete connection/);
  assert.doesNotMatch(connectionsSource, /window\.confirm/);
  assert.match(adminCss, /\.admin-content--connections\s*\{[\s\S]*overflow:\s*hidden/);
  assert.match(adminCss, /\.admin-connections-body\s*\{[\s\S]*minmax\(285px, 320px\) minmax\(0, 1fr\)/);
  assert.match(adminCss, /\.admin-connections-workspace--list \.admin-connections-list-pane/);
  assert.match(adminCss, /\.admin-connections-workspace--detail \.admin-connection-detail/);
});

test("shared confirmation dialogs expose modal semantics, keyboard dismissal and focus containment", () => {
  assert.match(primitivesSource, /role="dialog"/);
  assert.match(primitivesSource, /aria-modal="true"/);
  assert.match(primitivesSource, /aria-labelledby=\{titleId\}/);
  assert.match(primitivesSource, /aria-describedby=\{descriptionId\}/);
  assert.match(primitivesSource, /event\.key === "Escape"/);
  assert.match(primitivesSource, /event\.key !== "Tab"/);
  assert.match(primitivesSource, /previouslyFocused\?\.focus\(\)/);
});

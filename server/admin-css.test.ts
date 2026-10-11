import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const adminCss = readFileSync(new URL("../src/features/admin/admin.css", import.meta.url), "utf8");

test("group editor typography does not leak into the nested icon library", () => {
  assert.match(adminCss, /\.admin-inspector__group > header small\s*\{/);
  assert.match(adminCss, /\.admin-inspector__group > header strong\s*\{/);
  assert.doesNotMatch(adminCss, /\.admin-inspector__group header small\s*\{/);
  assert.doesNotMatch(adminCss, /\.admin-inspector__group header strong\s*\{/);
});

test("icon picker keeps the text input visible after upload actions are added", () => {
  const controlRule = adminCss.match(/\.admin-icon-picker__control\s*\{([^}]*)\}/)?.[1] ?? "";
  const actionsRule = adminCss.match(/\.admin-icon-picker__actions\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.match(controlRule, /grid-template-columns:\s*42px minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(controlRule, /minmax\(0,\s*1fr\)\s+auto/);
  assert.match(actionsRule, /grid-column:\s*1\s*\/\s*-1/);
  assert.match(actionsRule, /justify-content:\s*flex-end/);
  assert.match(actionsRule, /flex-wrap:\s*wrap/);
});

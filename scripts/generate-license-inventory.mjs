import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const outputUrl = new URL("../docs/DEPENDENCY_LICENSES.md", import.meta.url);
const checkOnly = process.argv.includes("--check");

function text(value) {
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" ? value : "";
}

function cell(value) {
  return text(value).replaceAll("|", "\\|").replaceAll("\n", " ").trim();
}

const report = JSON.parse(execFileSync(
  "pnpm",
  ["licenses", "list", "--prod", "--json"],
  { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
));

const rows = Object.entries(report)
  .flatMap(([license, packages]) => packages.map((entry) => ({
    name: text(entry.name),
    versions: text(entry.versions),
    license,
    project: text(entry.homepage),
  })))
  .sort((left, right) => left.name.localeCompare(right.name)
    || left.versions.localeCompare(right.versions)
    || left.license.localeCompare(right.license));

const lines = [
  "# Production dependency licence inventory",
  "",
  "This generated inventory covers the production dependency graph resolved by `pnpm-lock.yaml`. Package licence files remain in the installed package directories included in the runtime image. Regenerate this file whenever the lockfile changes.",
  "",
  `Packages: **${rows.length}**`,
  "",
  "| Package | Resolved version(s) | Licence | Project |",
  "| --- | --- | --- | --- |",
  ...rows.map((row) => `| \`${cell(row.name)}\` | \`${cell(row.versions)}\` | \`${cell(row.license)}\` | ${cell(row.project)} |`),
  "",
  "Generated with `pnpm licenses list --prod --json` and `scripts/generate-license-inventory.mjs`.",
  "",
];
const rendered = lines.join("\n");

if (checkOnly) {
  let current = "";
  try {
    current = readFileSync(outputUrl, "utf8");
  } catch {
    // Report the same actionable error for missing and stale inventories.
  }
  if (current !== rendered) {
    console.error("docs/DEPENDENCY_LICENSES.md is missing or stale. Run pnpm licenses:generate.");
    process.exit(1);
  }
  console.log(`Verified ${rows.length} production dependency licence entries.`);
} else {
  writeFileSync(fileURLToPath(outputUrl), rendered);
  console.log(`Wrote ${rows.length} production dependency licence entries.`);
}

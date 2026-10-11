import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { DASHCENTER_RELEASE, DASHCENTER_VERSION } from "../shared/version.js";

const readRootFile = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("release version stays synchronized across runtime, package, Docker and documentation", () => {
  const packageJson = JSON.parse(readRootFile("package.json")) as { version: string };
  const dockerfile = readRootFile("Dockerfile");
  const proxyDockerfile = readRootFile("docker/Dockerfile.proxy");
  const compose = readRootFile("docker-compose.yml");
  const readme = readRootFile("README.md");
  const changelog = readRootFile("CHANGELOG.md");
  const escapedVersion = DASHCENTER_VERSION.replaceAll(".", "\\.");

  assert.equal(DASHCENTER_RELEASE, `v${DASHCENTER_VERSION}`);
  assert.equal(packageJson.version, DASHCENTER_VERSION);
  assert.match(dockerfile, new RegExp(`ARG DASHCENTER_VERSION=${escapedVersion}(?:\\n|$)`));
  assert.match(proxyDockerfile, new RegExp(`ARG DASHCENTER_VERSION=${escapedVersion}(?:\\n|$)`));
  assert.match(dockerfile, /org\.opencontainers\.image\.version="\$\{DASHCENTER_VERSION\}"/);
  assert.match(dockerfile, /org\.opencontainers\.image\.revision="\$\{DASHCENTER_REVISION\}"/);
  assert.match(compose, new RegExp(`DASHCENTER_VERSION: "${escapedVersion}"`));
  assert.match(compose, /DASHCENTER_REVISION: "\$\{DASHCENTER_REVISION:-unknown\}"/);
  assert.match(compose, new RegExp(`image: dashcenter:${escapedVersion}(?:\\n|$)`));
  assert.match(readme, new RegExp(`Current release: v${escapedVersion}`));
  assert.match(readme, /Docker Compose/);
  assert.match(readme, /Portainer/);
  assert.match(readme, /dockerfile: docker\/Dockerfile\.proxy/);
  assert.match(readme, /dashboard-only container/i);
  assert.match(changelog, new RegExp(`## \\[${escapedVersion}\\]`));
  assert.equal(existsSync(new URL("../docs/NEXT_RELEASE.md", import.meta.url)), false);
});

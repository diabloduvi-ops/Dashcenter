import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const readText = (path: string) => readFile(new URL(path, root), "utf8");

function assetSection(source: string, assetPath: string) {
  const marker = `## \`${assetPath}\``;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing provenance for ${assetPath}`);
  const rest = source.slice(start + marker.length);
  const end = rest.indexOf("\n## ");
  return end === -1 ? rest : rest.slice(0, end);
}

test("distribution declares AGPL-3.0-only consistently", async () => {
  const [license, packageSource, readme] = await Promise.all([
    readText("LICENSE"),
    readText("package.json"),
    readText("README.md"),
  ]);
  const packageJson = JSON.parse(packageSource) as { license?: string };

  assert.match(license, /^GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007/);
  assert.equal(packageJson.license, "AGPL-3.0-only");
  assert.match(readme, /GNU Affero General Public License v3\.0 only/);
  assert.match(readme, /independent project/i);
  assert.match(readme, /not affiliated with, endorsed by, or maintained by Homepage/i);
});

test("contribution, third-party, and distribution notices are present", async () => {
  const [
    contributing,
    notices,
    provenance,
    sourceProvenance,
    dependencyInventory,
    dockerfile,
    dockerignore,
    dashboardIconsLicense,
    selfhstLicense,
    materialIconsLicense,
    simpleIconsLicense,
    simpleIconsDisclaimer,
    dockerProxyLicense,
  ] = await Promise.all([
    readText("CONTRIBUTING.md"),
    readText("THIRD_PARTY_NOTICES.md"),
    readText("docs/ASSET_PROVENANCE.md"),
    readText("docs/SOURCE_PROVENANCE.md"),
    readText("docs/DEPENDENCY_LICENSES.md"),
    readText("Dockerfile"),
    readText(".dockerignore"),
    readText("third_party_licenses/homarr-labs-dashboard-icons-LICENSE"),
    readText("third_party_licenses/selfhst-icons-LICENSE"),
    readText("third_party_licenses/material-design-icons-LICENSE"),
    readText("third_party_licenses/simple-icons-LICENSE.md"),
    readText("third_party_licenses/simple-icons-DISCLAIMER.md"),
    readText("third_party_licenses/docker-socket-proxy-LICENSE.txt"),
  ]);

  assert.match(contributing, /necessary rights to submit it/);
  assert.match(contributing, /AI-assisted contributions/);
  assert.match(notices, /homarr-labs\/dashboard-icons/);
  assert.match(notices, /selfhst\/icons/);
  assert.match(notices, /docs\/DEPENDENCY_LICENSES\.md/);
  assert.match(dashboardIconsLicense, /Apache License/);
  assert.match(dashboardIconsLicense, /Copyright \(c\) 2024 Bjorn Lammers, Meier Lukas, Thomas Camlong and Homarr Labs/);
  assert.match(selfhstLicense, /Attribution 4\.0 International/);
  assert.match(materialIconsLicense, /Pictogrammers Free License/);
  assert.match(simpleIconsLicense, /CC0 1\.0 Universal/);
  assert.match(simpleIconsDisclaimer, /Licenses, Copyrights & Trademarks/);
  assert.match(dockerProxyLicense, /Apache License/);
  assert.match(provenance, /Reference images: none/);
  assert.match(provenance, /dashcenter-mark\.svg/);
  assert.match(sourceProvenance, /No imported Homepage source file/);
  const declaredPackages = Number(dependencyInventory.match(/Packages: \*\*(\d+)\*\*/)?.[1]);
  const listedPackages = dependencyInventory.split("\n").filter((line) => line.startsWith("| `")).length;
  assert.equal(declaredPackages, listedPackages);
  assert.match(dependencyInventory, /`@fastify\/rate-limit` \| `11\.2\.1` \| `MIT`/);
  assert.match(dependencyInventory, /`react` \| `19\.2\.8` \| `MIT`/);
  assert.match(dockerfile, /org\.opencontainers\.image\.licenses="AGPL-3\.0-only"/);
  assert.match(dockerfile, /org\.opencontainers\.image\.revision="\$\{DASHCENTER_REVISION\}"/);
  assert.ok(dockerfile.includes("COPY LICENSE THIRD_PARTY_NOTICES.md ./"));
  assert.ok(dockerfile.includes("COPY docs/ASSET_PROVENANCE.md docs/DEPENDENCY_LICENSES.md docs/SOURCE_PROVENANCE.md ./docs/"));
  assert.ok(dockerfile.includes("COPY third_party_licenses ./third_party_licenses"));
  assert.match(dockerignore, /^!THIRD_PARTY_NOTICES\.md$/m);
  assert.match(dockerignore, /^!third_party_licenses\/\*\.md$/m);
  assert.match(dockerignore, /^!docs\/ASSET_PROVENANCE\.md$/m);
  assert.match(dockerignore, /^!docs\/DEPENDENCY_LICENSES\.md$/m);
  assert.match(dockerignore, /^!docs\/SOURCE_PROVENANCE\.md$/m);
});

test("documented generated background matches the distributed asset", async () => {
  const [image, provenance] = await Promise.all([
    readFile(new URL("public/assets/dashcenter-forest.png", root)),
    readText("docs/ASSET_PROVENANCE.md"),
  ]);
  const digest = createHash("sha256").update(image).digest("hex");
  const section = assetSection(provenance, "public/assets/dashcenter-forest.png");
  const documentedDigest = section.match(/SHA-256: `([a-f0-9]{64})`/)?.[1];
  const documentedDimensions = section.match(/Dimensions: (\d+) × (\d+) pixels/);

  assert.equal(digest, documentedDigest);
  assert.equal(image.readUInt32BE(16), Number(documentedDimensions?.[1]));
  assert.equal(image.readUInt32BE(20), Number(documentedDimensions?.[2]));
  assert.ok(image.includes(Buffer.from("c2pa")), "generated PNG must retain embedded provenance metadata");
});

test("project mark provenance and web manifest reference shipped files", async () => {
  const [mark, provenance, manifestSource] = await Promise.all([
    readFile(new URL("public/assets/dashcenter-mark.svg", root)),
    readText("docs/ASSET_PROVENANCE.md"),
    readText("public/manifest.webmanifest"),
  ]);
  const section = assetSection(provenance, "public/assets/dashcenter-mark.svg");
  const documentedDigest = section.match(/SHA-256: `([a-f0-9]{64})`/)?.[1];
  assert.equal(createHash("sha256").update(mark).digest("hex"), documentedDigest);

  const manifest = JSON.parse(manifestSource) as { icons?: Array<{ src?: string }> };
  assert.ok(manifest.icons?.length);
  for (const icon of manifest.icons ?? []) {
    assert.match(icon.src ?? "", /^\/[a-zA-Z0-9_./-]+$/);
    await access(new URL(`public${icon.src}`, root));
  }
});

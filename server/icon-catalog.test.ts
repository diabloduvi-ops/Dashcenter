import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DASHBOARD_ICONS_REVISION,
  normalizeIconReference,
  parseIconCatalog,
  resolveIcon,
  resolveIconSource,
  searchIconCatalog,
} from "../shared/icons.js";

const catalogUrl = new URL("../public/assets/icon-catalog.json", import.meta.url);

test("vendored icon catalog is pinned, sorted, unique, and complete", async () => {
  const manifest = parseIconCatalog(JSON.parse(await readFile(catalogUrl, "utf8")));
  assert.equal(manifest.source, "https://github.com/homarr-labs/dashboard-icons");
  assert.equal(manifest.revision, DASHBOARD_ICONS_REVISION);
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(manifest.icons.length, 2_798);
  assert.deepEqual([...manifest.icons].sort(), manifest.icons);
  assert.equal(new Set(manifest.icons).size, manifest.icons.length);

  for (const required of [
    "beszel.png",
    "uptime-kuma.png",
    "portainer.png",
    "proxmox.png",
    "jellyfin.png",
    "plex.png",
    "mikrotik.png",
    "steam.png",
    "bazarr.png",
    "prowlarr.png",
    "radarr.png",
    "sonarr.png",
    "nginx-proxy-manager.png",
    "qbittorrent.png",
  ]) {
    assert.ok(manifest.icons.includes(required), `missing ${required}`);
  }
});

test("catalog parser rejects unsafe filenames and removes duplicates", () => {
  const metadata = {
    source: "https://github.com/homarr-labs/dashboard-icons",
    revision: DASHBOARD_ICONS_REVISION,
    license: "Apache-2.0",
  };
  assert.deepEqual(parseIconCatalog({ ...metadata, icons: ["safe.png", "safe.png"] }).icons, ["safe.png"]);
  assert.throws(
    () => parseIconCatalog({ ...metadata, icons: ["../unsafe.png"] }),
    /invalid filename/,
  );
});

test("icon resolver supports custom sources, dashboard formats, and Homepage prefixes", () => {
  assert.deepEqual(resolveIconSource(""), { kind: "none", src: "" });
  assert.equal(resolveIcon("https://example.com/icon.png"), "https://example.com/icon.png");
  assert.equal(resolveIcon("/uploads/icons/custom.png"), "/uploads/icons/custom.png");

  assert.match(resolveIcon("portainer"), /dashboard-icons@.+\/png\/portainer\.png$/);
  assert.match(resolveIcon("notion.webp"), /dashboard-icons@.+\/webp\/notion\.webp$/);
  assert.match(resolveIcon("custom.svg"), /dashboard-icons@.+\/svg\/custom\.svg$/);
  assert.match(resolveIcon("custom.avif"), /dashboard-icons@.+\/png\/custom\.png$/);
  assert.match(resolveIcon("sh-custom.avif"), /selfhst\/icons@.+\/avif\/custom\.avif$/);
  assert.match(resolveIcon("sh-ticktick.png"), /selfhst\/icons@.+\/png\/ticktick\.png$/);

  const mdi = resolveIconSource("mdi-home");
  assert.equal(mdi.kind, "mask");
  assert.equal(mdi.src, "/api/icons/svg/mdi/home");
  assert.match(mdi.fallbackSrc, /unpkg\.com\/@mdi\/svg@7\.4\.47\/svg\/home\.svg$/);
  assert.equal(mdi.color, "currentColor");

  const simple = resolveIconSource("si-github-#ff5500");
  assert.equal(simple.kind, "mask");
  assert.equal(simple.src, "/api/icons/svg/si/github");
  assert.match(simple.fallbackSrc, /unpkg\.com\/simple-icons@16\.28\.0\/icons\/github\.svg$/);
  assert.equal(simple.color, "#ff5500");
});

test("manual icon references normalize before they are previewed or saved", () => {
  assert.equal(normalizeIconReference("  MDI-Server.SVG  "), "mdi-server");
  assert.equal(normalizeIconReference("SI-GitHub-#FF5500"), "si-github-#ff5500");
  assert.equal(normalizeIconReference("SH-TickTick.PNG"), "sh-ticktick.png");
  assert.equal(normalizeIconReference("Portainer.PNG"), "portainer.png");
  assert.equal(
    normalizeIconReference("https://example.com/CaseSensitive/Icon.svg"),
    "https://example.com/CaseSensitive/Icon.svg",
  );
  assert.equal(resolveIcon("  MDI-Server.SVG  "), "/api/icons/svg/mdi/server");
});

test("icon search normalizes spacing and hyphens, ranks exact matches, and applies a stable limit", () => {
  const icons = [
    "my-nginx-proxy.png",
    "nginx.png",
    "nginx-proxy-manager.png",
    "proxy-manager.png",
    "portainer.png",
  ];
  assert.deepEqual(searchIconCatalog(icons, "NGINX   proxy", 3), [
    "nginx-proxy-manager.png",
    "my-nginx-proxy.png",
  ]);
  assert.deepEqual(searchIconCatalog(icons, "portainer", 1), ["portainer.png"]);
  assert.deepEqual(searchIconCatalog(icons, "", 2), ["portainer.png", "nginx-proxy-manager.png"]);
});

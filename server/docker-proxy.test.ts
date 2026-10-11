import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readRootFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("bundled Docker gateway exposes only the metadata routes Dashcenter uses", () => {
  const config = readRootFile("docker/docker-proxy.haproxy.cfg");
  const compose = readRootFile("docker-compose.yml");
  const proxyDockerfile = readRootFile("docker/Dockerfile.proxy");

  assert.match(config, /http-request deny unless METH_GET/);
  assert.match(config, /\/_ping\$/);
  assert.match(config, /\/version\$/);
  assert.match(config, /\/containers\/json\$/);
  assert.match(config, /\/containers\/\[a-zA-Z0-9_\.\-\]\+\/json\$/);
  assert.doesNotMatch(config, /\^\(\/v\[0-9\.\]\+\)\?\/containers\s/);
  assert.match(compose, /dockerfile: docker\/Dockerfile\.proxy/);
  assert.doesNotMatch(compose, /docker-proxy\.haproxy\.cfg:\/usr\/local\/etc\/haproxy\/haproxy\.cfg\.template/);
  assert.doesNotMatch(compose, /CONTAINERS:\s*1/);
  assert.match(proxyDockerfile, /FROM ghcr\.io\/tecnativa\/docker-socket-proxy:v0\.4\.2@sha256:[a-f0-9]{64}/);
  assert.match(proxyDockerfile, /COPY docker\/docker-proxy\.haproxy\.cfg \/usr\/local\/etc\/haproxy\/haproxy\.cfg\.template/);
});

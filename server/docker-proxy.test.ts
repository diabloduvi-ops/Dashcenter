import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getDockerContainerStatus } from "./docker.js";

const readRootFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("bundled Docker gateway exposes only the metadata routes Dashcenter uses", () => {
  const config = readRootFile("docker/docker-proxy.haproxy.cfg");
  const compose = readRootFile("docker-compose.yml");
  const proxyDockerfile = readRootFile("docker/Dockerfile.proxy");

  assert.match(config, /http-request deny unless METH_GET/);
  assert.match(config, /\/_ping\$/);
  assert.match(config, /\/version\$/);
  assert.match(config, /\/containers\/json\$/);
  assert.doesNotMatch(config, /allowed_inspect|\/containers\/\[a-zA-Z0-9_\.\-\]\+\/json\$/);
  assert.doesNotMatch(config, /\^\(\/v\[0-9\.\]\+\)\?\/containers\s/);
  assert.match(compose, /dockerfile: docker\/Dockerfile\.proxy/);
  assert.doesNotMatch(compose, /docker-proxy\.haproxy\.cfg:\/usr\/local\/etc\/haproxy\/haproxy\.cfg\.template/);
  assert.doesNotMatch(compose, /CONTAINERS:\s*1/);
  assert.match(proxyDockerfile, /FROM ghcr\.io\/tecnativa\/docker-socket-proxy:v0\.4\.2@sha256:[a-f0-9]{64}/);
  assert.match(proxyDockerfile, /COPY docker\/docker-proxy\.haproxy\.cfg \/usr\/local\/etc\/haproxy\/haproxy\.cfg\.template/);
});

test("Docker status uses the limited container list without calling inspect", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify([
      { Id: "abc123456789", Names: ["/dashboard"], State: "running", Status: "Up 3 hours (healthy)" },
      { Id: "def987654321", Names: ["/worker"], State: "exited", Status: "Exited (1) 2 hours ago" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const connection = { id: "docker-test", name: "Docker", type: "http" as const, endpoint: "http://dockerproxy:2375", enabled: true };
  try {
    assert.deepEqual(await getDockerContainerStatus(connection, "dashboard"), {
      running: true, health: "healthy", message: "running (healthy)",
    });
    assert.deepEqual(await getDockerContainerStatus(connection, "def987"), {
      running: false, health: "unknown", message: "exited",
    });
    await assert.rejects(getDockerContainerStatus(connection, ""), /required/);
    assert.deepEqual(requests, [
      "http://dockerproxy:2375/containers/json?all=1",
      "http://dockerproxy:2375/containers/json?all=1",
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

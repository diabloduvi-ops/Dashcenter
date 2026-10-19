import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { createDatabase } from "./database.js";
import { buildApp } from "./index.js";
import { trustedProxyAddresses } from "./trusted-proxy.js";

test("only explicit proxy peers can be trusted", () => {
  assert.equal(trustedProxyAddresses({}), false);
  assert.equal(trustedProxyAddresses({ TRUST_PROXY: "false" }), false);
  assert.deepEqual(trustedProxyAddresses({ TRUST_PROXY: "127.0.0.1, 172.20.0.0/24, ::1" }), [
    "127.0.0.1", "172.20.0.0/24", "::1",
  ]);
  for (const value of ["true", "1", "0.0.0.0/0", "::/0", "example.com", "127.0.0.1,", "172.20.0.0/33"]) {
    assert.throws(() => trustedProxyAddresses({ TRUST_PROXY: value }), /TRUST_PROXY/);
  }
});

test("untrusted peers cannot choose their login address through X-Forwarded-For", async () => {
  const app = Fastify({ trustProxy: trustedProxyAddresses({ TRUST_PROXY: "127.0.0.1" }) });
  app.get("/client-ip", (request) => ({ ip: request.ip }));
  try {
    const spoofed = await app.inject({
      method: "GET", url: "/client-ip", remoteAddress: "192.0.2.10",
      headers: { "x-forwarded-for": "198.51.100.23" },
    });
    assert.equal(spoofed.json().ip, "192.0.2.10");
    const forwarded = await app.inject({
      method: "GET", url: "/client-ip", remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-for": "198.51.100.23" },
    });
    assert.equal(forwarded.json().ip, "198.51.100.23");
  } finally {
    await app.close();
  }
});

test("responses include a content security policy", async () => {
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-csp-"));
  const database = createDatabase(":memory:");
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });
  try {
    const response = await app.inject({ method: "GET", url: "/api/healthz" });
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers["content-security-policy"]), /default-src 'self'/);
    assert.match(String(response.headers["content-security-policy"]), /script-src 'self'/);
    assert.match(String(response.headers["content-security-policy"]), /object-src 'none'/);
  } finally {
    await app.close();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

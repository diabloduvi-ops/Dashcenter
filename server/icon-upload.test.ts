import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createDatabase } from "./database.js";
import { buildApp } from "./index.js";

function multipartPayload(
  filename: string,
  mimeType: string,
  contents: Buffer,
  boundary = "dashcenter-test-boundary",
): { boundary: string; payload: Buffer } {
  const prefix = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { boundary, payload: Buffer.concat([prefix, contents, suffix]) };
}

test("icon uploads validate bytes, persist, and are served from the uploads directory", async () => {
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-icon-upload-"));
  const database = createDatabase(":memory:");
  process.env.DEV_BYPASS_AUTH = "1";
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false });

  try {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const valid = multipartPayload("my-icon.png", "image/png", png);
    const uploaded = await app.inject({
      method: "POST",
      url: "/api/icons/upload",
      headers: { "content-type": `multipart/form-data; boundary=${valid.boundary}` },
      payload: valid.payload,
    });

    assert.equal(uploaded.statusCode, 200);
    const result = uploaded.json<{ url: string; filename: string }>();
    assert.equal(result.filename, "my-icon.png");
    assert.match(
      result.url,
      /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/i,
    );

    const served = await app.inject({ method: "GET", url: result.url });
    assert.equal(served.statusCode, 200);
    assert.match(String(served.headers["content-type"]), /^image\/png/);
    assert.equal(served.headers["x-content-type-options"], "nosniff");
    assert.deepEqual(served.rawPayload, png);

    const generic = multipartPayload("icon-without-metadata", "application/octet-stream", png);
    const genericResponse = await app.inject({
      method: "POST",
      url: "/api/icons/upload",
      headers: { "content-type": `multipart/form-data; boundary=${generic.boundary}` },
      payload: generic.payload,
    });
    assert.equal(genericResponse.statusCode, 200);
    assert.match(genericResponse.json<{ url: string }>().url, /\.png$/);

    const spoofed = multipartPayload("fake.png", "image/png", Buffer.from("not really an image"));
    const spoofedResponse = await app.inject({
      method: "POST",
      url: "/api/icons/upload",
      headers: { "content-type": `multipart/form-data; boundary=${spoofed.boundary}` },
      payload: spoofed.payload,
    });
    assert.equal(spoofedResponse.statusCode, 415);

    const svg = multipartPayload("icon.svg", "image/svg+xml", Buffer.from("<svg/>"));
    const svgResponse = await app.inject({
      method: "POST",
      url: "/api/icons/upload",
      headers: { "content-type": `multipart/form-data; boundary=${svg.boundary}` },
      payload: svg.payload,
    });
    assert.equal(svgResponse.statusCode, 415);
  } finally {
    await app.close();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

test("authenticated image uploads share one limit across all three routes and sessions", async () => {
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  const previousTrustProxy = process.env.TRUST_PROXY;
  delete process.env.DEV_BYPASS_AUTH;
  process.env.TRUST_PROXY = "127.0.0.1";
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-upload-limit-"));
  const database = createDatabase(":memory:");
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });

  try {
    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { username: "admin", password: "correct-horse-battery-staple" },
    });
    assert.equal(setup.statusCode, 200);
    const cookie = String(setup.headers["set-cookie"]).split(";", 1)[0];
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const upload = multipartPayload("icon.png", "image/png", png);
    const routes = ["/api/icons/upload", "/api/appearance/icon", "/api/appearance/background"];
    const send = (route: string, sessionCookie = cookie) => app.inject({
      method: "POST",
      url: route,
      headers: { cookie: sessionCookie, "content-type": `multipart/form-data; boundary=${upload.boundary}` },
      payload: upload.payload,
    });

    for (let attempt = 0; attempt < 12; attempt += 1) {
      assert.equal((await send(routes[attempt % routes.length])).statusCode, 200);
    }
    const limited = await send(routes[0]);
    assert.equal(limited.statusCode, 429);
    assert.ok(Number(limited.headers["retry-after"]) > 0);
    assert.equal(readdirSync(path.join(dataDirectory, "uploads")).length, 12);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "correct-horse-battery-staple" },
    });
    assert.equal(login.statusCode, 200);
    const secondCookie = String(login.headers["set-cookie"]).split(";", 1)[0];
    const differentClient = await app.inject({
      method: "POST",
      url: routes[1],
      headers: {
        cookie: secondCookie,
        "content-type": `multipart/form-data; boundary=${upload.boundary}`,
        "x-forwarded-for": "198.51.100.23",
      },
      payload: upload.payload,
    });
    assert.equal(differentClient.statusCode, 429);
    assert.equal((await send(routes[2], "")).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: "/api/healthz" })).statusCode, 200);
  } finally {
    await app.close();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
    if (previousTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previousTrustProxy;
  }
});

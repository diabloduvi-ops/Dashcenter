import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { secureSessionCookiesEnabled } from "./auth.js";
import { createDatabase } from "./database.js";
import { buildApp } from "./index.js";

test("session cookies stay secure by default in production", () => {
  assert.equal(secureSessionCookiesEnabled({ NODE_ENV: "production" }), true);
  assert.equal(secureSessionCookiesEnabled({ NODE_ENV: "production", SESSION_COOKIE_SECURE: "unexpected" }), true);
});

test("session cookie security can be explicitly configured for HTTPS or trusted HTTP", () => {
  assert.equal(secureSessionCookiesEnabled({ NODE_ENV: "production", SESSION_COOKIE_SECURE: "true" }), true);
  assert.equal(secureSessionCookiesEnabled({ NODE_ENV: "production", SESSION_COOKIE_SECURE: "false" }), false);
  assert.equal(secureSessionCookiesEnabled({ NODE_ENV: "production", SESSION_COOKIE_SECURE: "0" }), false);
  assert.equal(secureSessionCookiesEnabled({ NODE_ENV: "development", SESSION_COOKIE_SECURE: "on" }), true);
});

test("development authentication bypass cannot enable administrator access in production", async () => {
  const previousNodeEnvironment = process.env.NODE_ENV;
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  process.env.NODE_ENV = "production";
  process.env.DEV_BYPASS_AUTH = "1";
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-production-auth-"));
  const database = createDatabase(":memory:");
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });

  try {
    const state = (await app.inject({ method: "GET", url: "/api/auth/state" })).json();
    assert.equal(state.authenticated, false);
    assert.equal(state.devBypass, undefined);
    assert.equal((await app.inject({ method: "GET", url: "/api/groups" })).statusCode, 401);
  } finally {
    await app.close();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnvironment;
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

test("trusted HTTP mode keeps authentication enabled while omitting the Secure cookie flag", async () => {
  const previousNodeEnvironment = process.env.NODE_ENV;
  const previousCookieSetting = process.env.SESSION_COOKIE_SECURE;
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-auth-"));
  const database = createDatabase(":memory:");

  process.env.NODE_ENV = "production";
  process.env.SESSION_COOKIE_SECURE = "false";
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false });

  try {
    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { username: "admin", displayName: "Administrator", password: "correct-horse-battery-staple" },
    });
    assert.equal(setup.statusCode, 200);

    const setCookie = setup.headers["set-cookie"];
    assert.equal(typeof setCookie, "string");
    assert.match(setCookie as string, /HttpOnly/i);
    assert.match(setCookie as string, /SameSite=Lax/i);
    assert.doesNotMatch(setCookie as string, /;\s*Secure/i);

    const cookie = (setCookie as string).split(";", 1)[0];
    const state = await app.inject({ method: "GET", url: "/api/auth/state", headers: { cookie } });
    assert.equal(state.statusCode, 200);
    assert.equal(state.json().authenticated, true);

    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    assert.equal(logout.statusCode, 200);
    assert.doesNotMatch(String(logout.headers["set-cookie"]), /;\s*Secure/i);
  } finally {
    await app.close();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnvironment;
    if (previousCookieSetting === undefined) delete process.env.SESSION_COOKIE_SECURE;
    else process.env.SESSION_COOKIE_SECURE = previousCookieSetting;
  }
});

test("repeated login failures are throttled before further password checks", async () => {
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  delete process.env.DEV_BYPASS_AUTH;
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-login-limit-"));
  const database = createDatabase(":memory:");
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });

  try {
    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { username: "admin", password: "correct-horse-battery-staple" },
    });
    assert.equal(setup.statusCode, 200);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "admin", password: "wrong-password" },
      });
      assert.equal(response.statusCode, 401);
    }

    const blocked = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "correct-horse-battery-staple" },
    });
    assert.equal(blocked.statusCode, 429);
    assert.ok(Number(blocked.headers["retry-after"]) > 0);

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: `unknown-${attempt}`, password: "wrong-password" },
      });
      assert.equal(response.statusCode, 401);
    }
    assert.equal((await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "another-user", password: "wrong-password" },
    })).statusCode, 429);
  } finally {
    await app.close();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

test("changing a password revokes other sessions and rotates the current session", async () => {
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  delete process.env.DEV_BYPASS_AUTH;
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-password-rotation-"));
  const database = createDatabase(":memory:");
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });

  try {
    const setup = await app.inject({
      method: "POST", url: "/api/auth/setup",
      payload: { username: "admin", password: "correct-horse-battery-staple" },
    });
    const firstCookie = String(setup.headers["set-cookie"]).split(";", 1)[0];
    const login = await app.inject({
      method: "POST", url: "/api/auth/login",
      payload: { username: "admin", password: "correct-horse-battery-staple" },
    });
    assert.equal(login.statusCode, 200);
    const secondCookie = String(login.headers["set-cookie"]).split(";", 1)[0];
    assert.notEqual(firstCookie, secondCookie);

    const incorrect = await app.inject({
      method: "PUT", url: "/api/auth/password", headers: { cookie: firstCookie },
      payload: { currentPassword: "incorrect", newPassword: "another-strong-password" },
    });
    assert.equal(incorrect.statusCode, 400);
    assert.equal((await app.inject({ method: "GET", url: "/api/auth/state", headers: { cookie: secondCookie } })).json().authenticated, true);

    const changed = await app.inject({
      method: "PUT", url: "/api/auth/password", headers: { cookie: firstCookie },
      payload: { currentPassword: "correct-horse-battery-staple", newPassword: "another-strong-password" },
    });
    assert.equal(changed.statusCode, 200);
    const rotatedCookie = String(changed.headers["set-cookie"]).split(";", 1)[0];
    assert.notEqual(rotatedCookie, firstCookie);
    for (const cookie of [firstCookie, secondCookie]) {
      assert.equal((await app.inject({ method: "GET", url: "/api/auth/state", headers: { cookie } })).json().authenticated, false);
      assert.equal((await app.inject({ method: "GET", url: "/api/groups", headers: { cookie } })).statusCode, 401);
    }
    assert.equal((await app.inject({ method: "GET", url: "/api/auth/state", headers: { cookie: rotatedCookie } })).json().authenticated, true);
    assert.equal((await app.inject({
      method: "POST", url: "/api/auth/login",
      payload: { username: "admin", password: "correct-horse-battery-staple" },
    })).statusCode, 401);
    assert.equal((await app.inject({
      method: "POST", url: "/api/auth/login",
      payload: { username: "admin", password: "another-strong-password" },
    })).statusCode, 200);
  } finally {
    await app.close();
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthState } from "../shared/types.js";
import type { AppDatabase } from "./database.js";

const COOKIE_NAME = "dashcenter_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const SCRYPT_KEY_LENGTH = 64;
const LOGIN_WINDOW_MS = 5 * 60 * 1_000;
const LOGIN_COOLDOWN_MS = 60 * 1_000;
const LOGIN_ACCOUNT_FAILURE_LIMIT = 8;
const LOGIN_IP_FAILURE_LIMIT = 20;
const MAX_LOGIN_BUCKETS = 10_000;

interface LoginBucket {
  failures: number;
  windowEndsAt: number;
  blockedUntil: number;
}

export class LoginRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many login attempts");
  }
}

function retryAfter(buckets: Map<string, LoginBucket>, key: string, now: number): number {
  const bucket = buckets.get(key);
  if (!bucket) return 0;
  if (bucket.windowEndsAt <= now) {
    buckets.delete(key);
    return 0;
  }
  return bucket.blockedUntil > now ? Math.ceil((bucket.blockedUntil - now) / 1_000) : 0;
}

function recordLoginFailure(buckets: Map<string, LoginBucket>, key: string, limit: number, now: number): void {
  const existing = buckets.get(key);
  const bucket = existing && existing.windowEndsAt > now
    ? existing
    : { failures: 0, windowEndsAt: now + LOGIN_WINDOW_MS, blockedUntil: 0 };
  bucket.failures += 1;
  if (bucket.failures >= limit) bucket.blockedUntil = now + LOGIN_COOLDOWN_MS;
  buckets.delete(key);
  buckets.set(key, bucket);
  if (buckets.size > MAX_LOGIN_BUCKETS) {
    for (const [candidate, value] of buckets) {
      if (value.windowEndsAt <= now) buckets.delete(candidate);
    }
    while (buckets.size > MAX_LOGIN_BUCKETS) buckets.delete(buckets.keys().next().value!);
  }
}

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  password_salt?: string;
  password_hash?: string;
}

function bypassEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const value = process.env.DEV_BYPASS_AUTH?.toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function secureSessionCookiesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.SESSION_COOKIE_SECURE?.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value ?? "")) return true;
  if (["0", "false", "no", "off"].includes(value ?? "")) return false;
  return env.NODE_ENV === "production";
}

function hashPassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: 1 << 15,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

function sessionHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function hasUsers(database: AppDatabase): boolean {
  const row = database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  return Number(row.count) > 0;
}

function readSessionUser(database: AppDatabase, token: string | undefined): UserRow | undefined {
  if (!token || token.length > 512) return undefined;
  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
  return database
    .prepare(`
      SELECT users.id, users.username, users.display_name
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `)
    .get(sessionHash(token), new Date().toISOString()) as UserRow | undefined;
}

function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: secureSessionCookiesEnabled(),
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

function createSession(database: AppDatabase, userId: number, reply: FastifyReply): void {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  database
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(sessionHash(token), userId, expiresAt.toISOString(), now.toISOString());
  setSessionCookie(reply, token);
}

export interface AuthController {
  state(request: FastifyRequest): AuthState;
  setup(username: string, displayName: string, password: string, reply: FastifyReply): AuthState;
  login(username: string, password: string, clientIp: string, reply: FastifyReply): AuthState | undefined;
  logout(request: FastifyRequest, reply: FastifyReply): void;
  changePassword(request: FastifyRequest, currentPassword: string, newPassword: string, reply: FastifyReply): boolean;
  requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void>;
}

export function createAuthController(database: AppDatabase): AuthController {
  const accountAttempts = new Map<string, LoginBucket>();
  const clientAttempts = new Map<string, LoginBucket>();
  return {
    state(request) {
      if (bypassEnabled()) {
        return {
          needsSetup: false,
          authenticated: true,
          username: "developer",
          displayName: "Development mode",
          devBypass: true,
        };
      }

      const needsSetup = !hasUsers(database);
      const user = readSessionUser(database, request.cookies[COOKIE_NAME]);
      return {
        needsSetup,
        authenticated: Boolean(user),
        ...(user ? { username: user.username, displayName: user.display_name } : {}),
      };
    },

    setup(username, displayName, password, reply) {
      if (hasUsers(database)) throw new Error("SETUP_COMPLETE");
      const salt = randomBytes(16);
      const passwordHash = hashPassword(password, salt);
      const result = database
        .prepare(`
          INSERT INTO users (username, display_name, password_salt, password_hash, created_at)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(
          username,
          displayName || username,
          salt.toString("base64"),
          passwordHash.toString("base64"),
          new Date().toISOString(),
        );
      createSession(database, Number(result.lastInsertRowid), reply);
      return { needsSetup: false, authenticated: true, username, displayName: displayName || username };
    },

    login(username, password, clientIp, reply) {
      const now = Date.now();
      const accountKey = username.toLocaleLowerCase();
      const clientKey = clientIp.slice(0, 256);
      const wait = Math.max(
        retryAfter(accountAttempts, accountKey, now),
        retryAfter(clientAttempts, clientKey, now),
      );
      if (wait > 0) throw new LoginRateLimitError(wait);

      const fail = () => {
        recordLoginFailure(accountAttempts, accountKey, LOGIN_ACCOUNT_FAILURE_LIMIT, now);
        recordLoginFailure(clientAttempts, clientKey, LOGIN_IP_FAILURE_LIMIT, now);
        return undefined;
      };
      const user = database
        .prepare(`
          SELECT id, username, display_name, password_salt, password_hash
          FROM users WHERE username = ? COLLATE NOCASE
        `)
        .get(username) as UserRow | undefined;
      if (!user?.password_salt || !user.password_hash) return fail();

      let storedHash: Buffer;
      let candidate: Buffer;
      try {
        storedHash = Buffer.from(user.password_hash, "base64");
        candidate = hashPassword(password, Buffer.from(user.password_salt, "base64"));
      } catch {
        return fail();
      }
      if (storedHash.length !== candidate.length || !timingSafeEqual(storedHash, candidate)) return fail();

      accountAttempts.delete(accountKey);
      clientAttempts.delete(clientKey);

      createSession(database, user.id, reply);
      return {
        needsSetup: false,
        authenticated: true,
        username: user.username,
        displayName: user.display_name,
      };
    },

    logout(request, reply) {
      const token = request.cookies[COOKIE_NAME];
      if (token) database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sessionHash(token));
      reply.clearCookie(COOKIE_NAME, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: secureSessionCookiesEnabled(),
      });
    },

    changePassword(request, currentPassword, newPassword, reply) {
      const sessionUser = readSessionUser(database, request.cookies[COOKIE_NAME]);
      if (!sessionUser) return false;
      const user = database
        .prepare("SELECT id, username, display_name, password_salt, password_hash FROM users WHERE id = ?")
        .get(sessionUser.id) as UserRow | undefined;
      if (!user?.password_salt || !user.password_hash) return false;

      const storedHash = Buffer.from(user.password_hash, "base64");
      const candidate = hashPassword(currentPassword, Buffer.from(user.password_salt, "base64"));
      if (storedHash.length !== candidate.length || !timingSafeEqual(storedHash, candidate)) return false;

      const salt = randomBytes(16);
      const passwordHash = hashPassword(newPassword, salt);
      database.exec("BEGIN IMMEDIATE");
      try {
        database
          .prepare("UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?")
          .run(salt.toString("base64"), passwordHash.toString("base64"), user.id);
        database.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
        createSession(database, user.id, reply);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return true;
    },

    async requireAuth(request, reply) {
      if (bypassEnabled()) return;
      const user = readSessionUser(database, request.cookies[COOKIE_NAME]);
      if (!user) await reply.code(401).send({ error: "Authentication required" });
    },
  };
}

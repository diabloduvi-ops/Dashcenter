import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import type {
  DashboardData,
  DashboardGroup,
  DashboardService,
  DashboardWidget,
  DockerConnection,
} from "../shared/types.js";
import { DASHCENTER_VERSION } from "../shared/version.js";
import { createAuthController, LoginRateLimitError } from "./auth.js";
import { fetchArrPlugin, testArrConnection } from "./arr.js";
import { fetchBazarrPlugin, testBazarrConnection } from "./bazarr.js";
import { fetchBeszelWidget, testBeszelConnection } from "./beszel.js";
import {
  fetchCalendarAgenda,
  normalizeCalendarFeedUrl,
  testCalendarAgendaConnection,
} from "./calendar-agenda.js";
import {
  fetchFeedReader,
  MAX_FEED_SOURCES,
  normalizeFeedReaderUrl,
  storedFeedSources,
  testFeedReaderConnection,
} from "./feed-reader.js";
import { fetchJellyfinArtwork, fetchJellyfinPlugin, testJellyfinConnection } from "./jellyfin.js";
import { fetchLidarrPlugin, testLidarrConnection } from "./lidarr.js";
import { fetchMikrotikPlugin, testMikrotikConnection } from "./mikrotik.js";
import { fetchNginxProxyManagerPlugin, testNginxProxyManagerConnection } from "./nginx-proxy-manager.js";
import { fetchPortainerPlugin, testPortainerConnection } from "./portainer.js";
import { fetchPlexArtwork, fetchPlexPlugin, testPlexConnection } from "./plex.js";
import { fetchProxmoxPlugin, testProxmoxConnection } from "./proxmox.js";
import { fetchProwlarrPlugin, testProwlarrConnection } from "./prowlarr.js";
import { fetchQBittorrentPlugin, testQBittorrentConnection } from "./qbittorrent.js";
import { fetchSteamWishlistPlugin, normalizeSteamId, testSteamWishlistConnection } from "./steam-wishlist.js";
import { fetchSystemResources, selectSystemResourceDockerConnection } from "./system-resources.js";
import { fetchUptimeKumaPlugin, testUptimeKumaConnection } from "./uptime-kuma.js";
import { fetchCustomApiWidget } from "./custom-api.js";
import { publishedDashboard } from "./public-dashboard.js";
import { createStarterDashboard } from "./seed.js";
import {
  createDatabase,
  deleteServiceCredentials,
  deleteWidgetCredentials,
  getConnection,
  getServiceCredentials,
  getWidgetCredentials,
  listRevisions,
  mutateDashboard,
  openAppDatabase,
  readDashboard,
  replaceDashboard,
  replaceGroups,
  restoreRevision,
  setServiceCredentials,
  setWidgetCredentials,
  type AppDatabase,
} from "./database.js";
import { listDockerContainers, testDockerConnection } from "./docker.js";
import { createHealthRefreshCoordinator, refreshServiceHealth } from "./health.js";
import {
  exportHomepageSettingsYaml,
  exportHomepageYaml,
  HomepageYamlError,
  parseHomepageYaml,
} from "./homepage-yaml.js";
import { loadPinnedSvgIcon, type SvgIconSet } from "./icon-proxy.js";
import {
  assertUniqueDashboardIds,
  authLoginSchema,
  authSetupSchema,
  connectionSchema,
  dashboardSchema,
  groupSchema,
  reorderSchema,
  revisionIdSchema,
  routeIdSchema,
  serviceSchema,
  settingsSchema,
  widgetSchema,
} from "./validation.js";
import { createUploadPruner, detectImageExtension } from "./upload-storage.js";
import { trustedProxyAddresses } from "./trusted-proxy.js";
import { fetchWeather } from "./weather.js";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const IMAGE_UPLOADS_PER_MINUTE = 12;
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: http: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
const MAX_IMPORT_SOURCE_BYTES = MAX_UPLOAD_BYTES;
const MAX_IMPORT_BODY_BYTES = MAX_IMPORT_SOURCE_BYTES * 2 + 64 * 1024;
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const systemResourcesQuerySchema = z.object({
  includeHistory: z.enum(["1"]).optional(),
  includeContainers: z.enum(["1"]).optional(),
  dockerConnectionId: z.string().trim().min(1).max(100).optional(),
});

const mediaArtworkParamsSchema = z.object({
  id: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/),
  artworkId: z.string().regex(/^[a-f0-9]{32}$/),
});

function homepageSourcesFitLimit(value: { yaml?: string; settingsYaml?: string }): boolean {
  return (
    Buffer.byteLength(value.yaml ?? "", "utf8") +
      Buffer.byteLength(value.settingsYaml ?? "", "utf8") <=
    MAX_IMPORT_SOURCE_BYTES
  );
}

const homepagePreviewImportSchema = z
  .object({
    yaml: z.string().min(1).max(MAX_IMPORT_SOURCE_BYTES),
    settingsYaml: z.string().max(MAX_IMPORT_SOURCE_BYTES).optional(),
  })
  .refine(homepageSourcesFitLimit, {
    message: "services.yaml and settings.yaml may use at most 10 MB in total",
  });

const homepageCommitImportSchema = z
  .object({
    yaml: z.string().min(1).max(MAX_IMPORT_SOURCE_BYTES).optional(),
    settingsYaml: z.string().max(MAX_IMPORT_SOURCE_BYTES).optional(),
    preview: z
      .object({ groups: z.array(groupSchema), source: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .refine((value) => Boolean(value.yaml || value.preview), "Provide YAML or a preview to import")
  .refine(homepageSourcesFitLimit, {
    message: "services.yaml and settings.yaml may use at most 10 MB in total",
  });

const beszelConfigSchema = z.object({
  url: z.string().trim().url().max(2048),
  version: z.coerce.number().int().pipe(z.union([z.literal(1), z.literal(2)])),
  systemId: z.string().trim().max(200).optional().default(""),
});

const beszelCredentialsSchema = z.object({
  username: z.string().trim().max(320),
  password: z.string().max(512).optional(),
  clearPassword: z.boolean().optional().default(false),
});

const calendarAgendaCredentialsSchema = z.object({
  feedUrl: z.string().max(4_096).optional(),
  clearFeedUrl: z.boolean().optional().default(false),
});

const calendarAgendaTestSchema = z.object({
  config: z.record(z.string().max(200), z.unknown()).default({}),
  credentials: calendarAgendaCredentialsSchema.default({ clearFeedUrl: false }),
});

const feedReaderCredentialsSchema = z.object({
  feedUrl: z.string().max(4_096).optional(),
  clearFeedUrl: z.boolean().optional().default(false),
  add: z.object({ name: z.string().trim().max(120).default(""), feedUrl: z.string().max(4_096) }).optional(),
  removeId: z.string().max(100).optional(),
});

const feedReaderTestSchema = z.object({
  config: z.record(z.string().max(200), z.unknown()).default({}),
  credentials: feedReaderCredentialsSchema.default({ clearFeedUrl: false }),
});

const portainerConfigSchema = z.object({
  url: z.string().trim().url().max(2048),
  endpointId: z.string().trim().max(40).optional().default(""),
});

const portainerCredentialsSchema = z.object({
  apiKey: z.string().max(2048).optional(),
  clearApiKey: z.boolean().optional().default(false),
});

const proxmoxConfigSchema = z.object({
  url: z.string().trim().url().max(2048),
  node: z.string().trim().max(200).optional().default(""),
});

const proxmoxCredentialsSchema = z.object({
  username: z.string().trim().max(320),
  password: z.string().max(512).optional(),
  clearPassword: z.boolean().optional().default(false),
});

const uptimeKumaConfigSchema = z.object({
  url: z.string().trim().url().max(2048),
  monitorId: z.string().trim().max(64).optional().default(""),
});

const uptimeKumaCredentialsSchema = z.object({
  apiKey: z.string().max(2048).optional(),
  clearApiKey: z.boolean().optional().default(false),
});

const jellyfinConfigSchema = z.object({
  url: z.string().trim().url().max(2048),
});

const jellyfinCredentialsSchema = z.object({
  apiKey: z.string().max(2048).optional(),
  clearApiKey: z.boolean().optional().default(false),
});

const plexConfigSchema = z.object({
  url: z.string().trim().url().max(2048),
});

const plexCredentialsSchema = z.object({
  token: z.string().max(2048).optional(),
  clearToken: z.boolean().optional().default(false),
});

const mikrotikConfigSchema = z.object({
  url: z.string().trim().url().max(2048),
  interfaceName: z.string().trim().max(128).optional().default(""),
});

const mikrotikCredentialsSchema = z.object({
  username: z.string().trim().max(320),
  password: z.string().max(512).optional(),
  clearPassword: z.boolean().optional().default(false),
});

const arrConfigSchema = z.object({
  url: z.string().trim().url().max(2048),
});

const arrCredentialsSchema = z.object({
  apiKey: z.string().max(2048).optional(),
  clearApiKey: z.boolean().optional().default(false),
});

const qbittorrentCredentialsSchema = z.object({
  username: z.string().trim().max(320),
  password: z.string().max(512).optional(),
  clearPassword: z.boolean().optional().default(false),
});

const nginxProxyManagerCredentialsSchema = z.object({
  username: z.string().trim().max(320),
  password: z.string().max(512).optional(),
  clearPassword: z.boolean().optional().default(false),
});

const steamWishlistConfigSchema = z.object({
  countryCode: z.string().trim().regex(/^[a-zA-Z]{2}$/).transform((value) => value.toUpperCase()).default("SK"),
  language: z.string().trim().regex(/^[a-zA-Z-]{2,20}$/).transform((value) => value.toLowerCase()).default("english"),
  minDiscount: z.coerce.number().int().min(0).max(95).default(20),
  maxItems: z.coerce.number().int().min(1).max(6).default(3),
  sortBy: z.enum(["discount", "price", "wishlist"]).default("discount"),
  refreshMinutes: z.coerce.number().int().min(15).max(1440).default(360),
});

const steamWishlistCredentialsSchema = z.object({
  username: z.string().trim().max(512).default(""),
});

interface BuildAppOptions {
  database?: AppDatabase;
  dataDirectory?: string;
  serveFrontend?: boolean;
  logger?: boolean;
  healthRefreshIntervalMs?: number | false;
}

function asDashboard(value: z.infer<typeof dashboardSchema>): DashboardData {
  const dashboard = value as DashboardData;
  dashboard.groups = dashboard.groups.map((group) => ({
    ...group,
    services: group.services.map((service) => ({ ...service, groupId: group.id })),
  }));
  assertUniqueDashboardIds(dashboard);
  return dashboard;
}

function findFrontendDirectory(): string | undefined {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), "dist"),
    path.resolve(moduleDirectory, "../dist"),
    path.resolve(moduleDirectory, "../../dist"),
  ];
  return candidates.find((candidate) => existsSync(path.join(candidate, "index.html")));
}

function duplicateValues(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

function sqliteConstraint(error: unknown): boolean {
  return error instanceof Error && /constraint/i.test(error.message);
}

function findGroup(database: AppDatabase, id: string): DashboardGroup | undefined {
  return readDashboard(database).groups.find((group) => group.id === id);
}

function findService(database: AppDatabase, id: string): DashboardService | undefined {
  return readDashboard(database).groups.flatMap((group) => group.services).find((service) => service.id === id);
}

function findWidget(database: AppDatabase, id: string): DashboardWidget | undefined {
  return readDashboard(database).widgets.find((widget) => widget.id === id);
}

function imageUploadHandler(
  uploadsDirectory: string,
): (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
  return async (request, reply) => {
    const upload = await request.file({ limits: { files: 1, fileSize: MAX_UPLOAD_BYTES } });
    if (!upload) return reply.code(400).send({ error: "Select an image to upload." });
    const declaredExtension = IMAGE_EXTENSIONS[upload.mimetype];
    const genericMimeType = !upload.mimetype || upload.mimetype === "application/octet-stream";
    if (!declaredExtension && !genericMimeType) {
      upload.file.resume();
      return reply.code(415).send({ error: "Use a PNG, JPEG, WebP, or GIF image." });
    }
    const buffer = await upload.toBuffer();
    if (upload.file.truncated || buffer.byteLength > MAX_UPLOAD_BYTES) {
      return reply.code(413).send({ error: "Image uploads are limited to 10 MB." });
    }
    const extension = detectImageExtension(buffer);
    if (!extension || (declaredExtension && extension !== declaredExtension)) {
      return reply.code(415).send({
        error: "The uploaded file is invalid, structurally inconsistent, or does not match its declared image format.",
      });
    }
    const filename = `${randomUUID()}${extension}`;
    await writeFile(path.join(uploadsDirectory, filename), buffer, { mode: 0o640, flag: "wx" });
    const url = `/uploads/${filename}`;
    return { url, filename: upload.filename };
  };
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const dataDirectory = options.dataDirectory ?? process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");
  mkdirSync(dataDirectory, { recursive: true, mode: 0o750 });
  const uploadsDirectory = path.join(dataDirectory, "uploads");
  mkdirSync(uploadsDirectory, { recursive: true, mode: 0o750 });

  const ownsDatabase = !options.database;
  const database = options.database ?? openAppDatabase(dataDirectory);
  const app = Fastify({
    logger: options.logger ?? process.env.NODE_ENV !== "test",
    bodyLimit: MAX_UPLOAD_BYTES,
    trustProxy: trustedProxyAddresses(),
  });
  const auth = createAuthController(database);
  const privacySettings = database.prepare("SELECT payload FROM dashboard_settings WHERE id = 1");
  const requiresSignIn = () => {
    const row = privacySettings.get() as { payload: string } | undefined;
    return row ? JSON.parse(row.payload).requireSignIn === true : false;
  };
  const isAdmin = (request: FastifyRequest) => {
    const state = auth.state(request);
    return state.authenticated || state.devBypass === true;
  };
  const publishedService = (id: string) => readDashboard(database).groups.some(
    (group) => group.visible && (group.visibility ?? "everyone") === "everyone" && group.services.some((service) => service.id === id && service.visible),
  );
  const uploadPruner = createUploadPruner(
    database,
    uploadsDirectory,
    (error) => app.log.warn({ err: error }, "Unused upload cleanup failed"),
  );
  const healthRefresh = createHealthRefreshCoordinator(
    () => refreshServiceHealth(database),
    options.healthRefreshIntervalMs === false ? 30_000 : options.healthRefreshIntervalMs ?? 30_000,
    (error) => app.log.warn({ err: error }, "Scheduled service health refresh failed"),
  );
  let resourcesClosed = false;
  const closeResources = async () => {
    if (resourcesClosed) return;
    resourcesClosed = true;
    await healthRefresh.stop();
    await uploadPruner.stop();
    if (ownsDatabase) database.close();
  };
  app.addHook("onClose", closeResources);

  try {
    await app.register(cookie);
    await app.register(rateLimit, { global: false });
    app.addHook("preHandler", async (request, reply) => {
      if (!requiresSignIn() || isAdmin(request)) return;
      const pathname = request.url.split("?", 1)[0];
      if (pathname === "/api/healthz" || pathname === "/api/auth/state" ||
          pathname === "/api/auth/setup" || pathname === "/api/auth/login" ||
          pathname === "/api/auth/logout") return;
      if (pathname.startsWith("/api/") || pathname.startsWith("/uploads/")) {
        return reply.code(401).send({ error: "Sign in to view this dashboard" });
      }
    });
    const checkImageUploadRate = app.createRateLimit({
      max: IMAGE_UPLOADS_PER_MINUTE,
      timeWindow: "1 minute",
      keyGenerator: (request) => `user:${auth.state(request).username?.toLowerCase() ?? request.ip}`,
    });
    const limitImageUploads = async (request: FastifyRequest, reply: FastifyReply) => {
      const result = await checkImageUploadRate(request);
      if (!result.isAllowed && result.isExceeded) {
        return reply
          .header("Retry-After", String(Math.max(1, result.ttlInSeconds)))
          .code(429)
          .send({ error: "Too many image uploads. Try again later." });
      }
    };
  await app.register(multipart, {
    limits: { files: 1, fileSize: MAX_UPLOAD_BYTES, fields: 20, parts: 21 },
  });

  const frontendDirectory = options.serveFrontend === false ? undefined : findFrontendDirectory();
  if (frontendDirectory && (options.serveFrontend === true || process.env.NODE_ENV === "production")) {
    await app.register(fastifyStatic, {
      root: frontendDirectory,
      prefix: "/",
      wildcard: false,
      decorateReply: true,
    });
  }
  await app.register(fastifyStatic, {
    root: uploadsDirectory,
    prefix: "/uploads/",
    wildcard: true,
    decorateReply: !frontendDirectory,
    maxAge: "7d",
    immutable: false,
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    reply.header("X-Frame-Options", "DENY");
    return payload;
  });

  app.setErrorHandler(async (error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    if (error instanceof HomepageYamlError) return reply.code(400).send({ error: error.message });
    if (sqliteConstraint(error)) return reply.code(409).send({ error: "An item with that ID already exists or is still in use." });
    if (typeof error === "object" && error && "statusCode" in error) {
      const statusCode = Number((error as { statusCode: unknown }).statusCode);
      if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600) {
        return reply.code(statusCode).send({ error: error instanceof Error ? error.message : "Request failed" });
      }
    }
    app.log.error(error);
    return reply.code(500).send({ error: "Internal server error" });
  });

  app.get("/api/healthz", async () => {
    database.prepare("SELECT 1").get();
    const revision = process.env.DASHCENTER_REVISION?.trim().slice(0, 64) || "unknown";
    return { ok: true, uptime: Math.round(process.uptime()), version: DASHCENTER_VERSION, revision };
  });

  app.get("/api/system/resources", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const query = systemResourcesQuerySchema.parse(request.query);
    const dashboard = readDashboard(database);
    if (!isAdmin(request)) {
      const resourcesEnabled = dashboard.widgets.some((widget) => widget.enabled && widget.type === "system-resources");
      const healthWidgets = dashboard.widgets.filter((widget) => widget.enabled && widget.type === "server-health");
      if (!resourcesEnabled && healthWidgets.length === 0) return reply.code(404).send({ error: "Resource widget not found" });
      if (query.includeContainers && !healthWidgets.some((widget) =>
        String(widget.config.dockerConnectionId ?? "") === (query.dockerConnectionId ?? "")
      )) return reply.code(404).send({ error: "Resource source not found" });
    }
    const connection = query.includeContainers
      ? selectSystemResourceDockerConnection(dashboard.connections, query.dockerConnectionId)
      : undefined;
    return fetchSystemResources(dataDirectory, {
      includeHistory: query.includeHistory === "1",
      dockerConnection: connection,
    });
  });

  app.get("/api/dashboard", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const dashboard = readDashboard(database);
    return isAdmin(request) ? dashboard : publishedDashboard(dashboard);
  });

  app.put("/api/dashboard", { preHandler: auth.requireAuth }, async (request) => {
    const dashboard = asDashboard(dashboardSchema.parse(request.body));
    return replaceDashboard(database, dashboard, "Dashboard saved");
  });

  app.get("/api/auth/state", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { ...auth.state(request), requireSignIn: requiresSignIn() };
  });

  app.post("/api/auth/setup", async (request, reply) => {
    const body = authSetupSchema.parse(request.body);
    try {
      const state = auth.setup(body.username, body.displayName, body.password, reply);
      if (body.starter && readDashboard(database).revision === 1) {
        replaceDashboard(database, createStarterDashboard(body.starter), `${body.starter === "empty" ? "Empty" : "Demo"} starter dashboard`);
        database.prepare("DELETE FROM revisions WHERE label = 'Initial dashboard'").run();
      }
      return state;
    } catch (error) {
      if (error instanceof Error && error.message === "SETUP_COMPLETE") {
        return reply.code(409).send({ error: "Dashboard setup is already complete." });
      }
      throw error;
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = authLoginSchema.parse(request.body);
    try {
      const state = auth.login(body.username, body.password, request.ip, reply);
      return state ?? reply.code(401).send({ error: "Incorrect username or password." });
    } catch (error) {
      if (error instanceof LoginRateLimitError) {
        return reply.header("Retry-After", String(error.retryAfterSeconds)).code(429).send({ error: "Too many login attempts. Try again later." });
      }
      throw error;
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    auth.logout(request, reply);
    return { ok: true };
  });

  app.put("/api/auth/password", { preHandler: auth.requireAuth }, async (request, reply) => {
    const body = z
      .object({
        currentPassword: z.string().min(1).max(512),
        newPassword: z.string().min(8).max(512),
      })
      .parse(request.body);
    if (!auth.changePassword(request, body.currentPassword, body.newPassword, reply)) {
      return reply.code(400).send({ error: "The current password is incorrect." });
    }
    return { ok: true };
  });

  app.get("/api/groups", { preHandler: auth.requireAuth }, async () => readDashboard(database).groups);
  app.get("/api/groups/:id", { preHandler: auth.requireAuth }, async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    return findGroup(database, id) ?? reply.code(404).send({ error: "Group not found" });
  });

  app.post("/api/groups", { preHandler: auth.requireAuth }, async (request) => {
    const current = readDashboard(database);
    const body = z
      .object({
        id: z.string().optional(),
        name: z.string(),
        icon: z.string().optional(),
        columnSpan: z.number().int().min(1).max(6).optional(),
        columnStart: z.number().int().min(0).max(6).optional(),
        gapBefore: z.number().int().min(0).max(160).optional(),
        direction: z.enum(["horizontal", "vertical"]).optional(),
        visibility: z.enum(["everyone", "signed-in", "hidden"]).optional(),
        position: z.number().int().nonnegative().optional(),
        visible: z.boolean().optional(),
      })
      .parse(request.body);
    const group = groupSchema.parse({
      id: body.id ?? `group-${randomUUID()}`,
      name: body.name,
      icon: body.icon ?? "",
      columnSpan: body.columnSpan ?? 1,
      columnStart: body.columnStart ?? 0,
      gapBefore: body.gapBefore ?? 0,
      direction: body.direction ?? "horizontal",
      position: body.position ?? current.groups.length,
      visible: body.visible ?? true,
      visibility: body.visibility,
      services: [],
    });
    return mutateDashboard(database, `Group “${group.name}” added`, (transaction) => {
      transaction
        .prepare("INSERT INTO dashboard_groups (id, name, icon, column_span, column_start, gap_before, direction, position, visible, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          group.id,
          group.name,
          group.icon,
          group.columnSpan,
          group.columnStart,
          group.gapBefore,
          group.direction,
          group.position,
          group.visible ? 1 : 0,
          group.visibility,
        );
    });
  });

  const updateGroup = async (request: FastifyRequest) => {
    const { id } = routeIdSchema.parse(request.params);
    const existing = findGroup(database, id);
    if (!existing) return undefined;
    const body = z
      .object({
        name: z.string().optional(),
        icon: z.string().optional(),
        columnSpan: z.number().int().min(1).max(6).optional(),
        columnStart: z.number().int().min(0).max(6).optional(),
        gapBefore: z.number().int().min(0).max(160).optional(),
        direction: z.enum(["horizontal", "vertical"]).optional(),
        visibility: z.enum(["everyone", "signed-in", "hidden"]).optional(),
        position: z.number().int().nonnegative().optional(),
        visible: z.boolean().optional(),
      })
      .parse(request.body);
    const visibility = body.visibility ?? (body.visible === undefined ? existing.visibility : body.visible ? "everyone" : "hidden");
    const group = groupSchema.parse({
      ...existing,
      ...body,
      visibility,
      visible: body.visibility ? body.visibility !== "hidden" : body.visible ?? existing.visible,
    });
    return mutateDashboard(database, `Group “${group.name}” updated`, (transaction) => {
      transaction
        .prepare("UPDATE dashboard_groups SET name = ?, icon = ?, column_span = ?, column_start = ?, gap_before = ?, direction = ?, position = ?, visible = ?, visibility = ? WHERE id = ?")
        .run(
          group.name,
          group.icon,
          group.columnSpan,
          group.columnStart,
          group.gapBefore,
          group.direction,
          group.position,
          group.visible ? 1 : 0,
          group.visibility,
          id,
        );
    });
  };

  app.put("/api/groups/:id", { preHandler: auth.requireAuth }, async (request, reply) => {
    return (await updateGroup(request)) ?? reply.code(404).send({ error: "Group not found" });
  });
  app.patch("/api/groups/:id", { preHandler: auth.requireAuth }, async (request, reply) => {
    return (await updateGroup(request)) ?? reply.code(404).send({ error: "Group not found" });
  });

  app.delete("/api/groups/:id", { preHandler: auth.requireAuth }, async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    const existing = findGroup(database, id);
    if (!existing) return reply.code(404).send({ error: "Group not found" });
    return mutateDashboard(database, `Group “${existing.name}” deleted`, (transaction) => {
      for (const service of existing.services) deleteServiceCredentials(transaction, service.id);
      transaction.prepare("DELETE FROM dashboard_groups WHERE id = ?").run(id);
    });
  });

  app.get("/api/services", { preHandler: auth.requireAuth }, async (request) => {
    const query = z.object({ groupId: z.string().optional() }).parse(request.query);
    const services = readDashboard(database).groups.flatMap((group) => group.services);
    return query.groupId ? services.filter((service) => service.groupId === query.groupId) : services;
  });
  app.get("/api/services/:id", { preHandler: auth.requireAuth }, async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    return findService(database, id) ?? reply.code(404).send({ error: "Service not found" });
  });

  app.post("/api/services", { preHandler: auth.requireAuth }, async (request, reply) => {
    const body = z.record(z.string(), z.unknown()).parse(request.body);
    const groupId = typeof body.groupId === "string" ? body.groupId : "";
    const parent = findGroup(database, groupId);
    if (!parent) return reply.code(404).send({ error: "Group not found" });
    const service = serviceSchema.parse({
      ...body,
      id: body.id ?? `service-${randomUUID()}`,
      groupId,
      position: body.position ?? parent.services.length,
      visible: body.visible ?? true,
      statusCheck: body.statusCheck ?? false,
      status: body.status ?? "unknown",
    });
    return mutateDashboard(database, `Service “${service.name}” added`, (transaction) => {
      transaction
        .prepare(`
          INSERT INTO dashboard_services (
            id, group_id, name, href, description, icon, docker_server, container,
            position, visible, status_check, status_source, status, status_message, plugin_config, legacy_config
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          service.id,
          service.groupId,
          service.name,
          service.href,
          service.description,
          service.icon,
          service.dockerServer,
          service.container,
          service.position,
          service.visible ? 1 : 0,
          service.statusCheck ? 1 : 0,
          service.statusSource,
          service.status,
          service.statusMessage ?? null,
          service.plugin ? JSON.stringify(service.plugin) : null,
          service.legacyConfig ? JSON.stringify(service.legacyConfig) : null,
        );
    });
  });

  const updateService = async (request: FastifyRequest) => {
    const { id } = routeIdSchema.parse(request.params);
    const existing = findService(database, id);
    if (!existing) return undefined;
    const body = z.record(z.string(), z.unknown()).parse(request.body);
    const service = serviceSchema.parse({ ...existing, ...body, id });
    if (!findGroup(database, service.groupId)) throw new HomepageYamlError("The selected group does not exist.");
    return mutateDashboard(database, `Service “${service.name}” updated`, (transaction) => {
      transaction
        .prepare(`
          UPDATE dashboard_services SET
            group_id = ?, name = ?, href = ?, description = ?, icon = ?, docker_server = ?, container = ?,
            position = ?, visible = ?, status_check = ?, status_source = ?, status = ?, status_message = ?, plugin_config = ?, legacy_config = ?
          WHERE id = ?
        `)
        .run(
          service.groupId,
          service.name,
          service.href,
          service.description,
          service.icon,
          service.dockerServer,
          service.container,
          service.position,
          service.visible ? 1 : 0,
          service.statusCheck ? 1 : 0,
          service.statusSource,
          service.status,
          service.statusMessage ?? null,
          service.plugin ? JSON.stringify(service.plugin) : null,
          service.legacyConfig ? JSON.stringify(service.legacyConfig) : null,
          id,
        );
      if (!service.plugin) deleteServiceCredentials(transaction, id);
    });
  };

  app.put("/api/services/:id", { preHandler: auth.requireAuth }, async (request, reply) => {
    return (await updateService(request)) ?? reply.code(404).send({ error: "Service not found" });
  });
  app.patch("/api/services/:id", { preHandler: auth.requireAuth }, async (request, reply) => {
    return (await updateService(request)) ?? reply.code(404).send({ error: "Service not found" });
  });
  app.delete("/api/services/:id", { preHandler: auth.requireAuth }, async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    const existing = findService(database, id);
    if (!existing) return reply.code(404).send({ error: "Service not found" });
    return mutateDashboard(database, `Service “${existing.name}” deleted`, (transaction) => {
      deleteServiceCredentials(transaction, id);
      transaction.prepare("DELETE FROM dashboard_services WHERE id = ?").run(id);
    });
  });

  app.get("/api/services/:id/plugin/credentials", { preHandler: auth.requireAuth }, async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    const service = findService(database, id);
    if (!service) return reply.code(404).send({ error: "Service not found" });
    const credentials = service.plugin ? getServiceCredentials(database, id, service.plugin.type) : undefined;
    return { username: credentials?.username ?? "", passwordConfigured: Boolean(credentials?.password) };
  });

  app.put("/api/services/:id/plugin/credentials", { preHandler: auth.requireAuth }, async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    const service = findService(database, id);
    if (!service) return reply.code(404).send({ error: "Service not found" });
    if (!service.plugin) return reply.code(409).send({ error: "Service plugin is not configured" });
    const previous = getServiceCredentials(database, id, service.plugin.type);
    if (service.plugin.type === "steam-wishlist") {
      const body = steamWishlistCredentialsSchema.parse(request.body);
      let steamId: string;
      try {
        steamId = normalizeSteamId(body.username || previous?.username || "");
      } catch (error) {
        throw new HomepageYamlError(error instanceof Error ? error.message : "Invalid SteamID64.");
      }
      setServiceCredentials(database, id, "steam-wishlist", { username: steamId, password: "" });
      return { username: steamId, passwordConfigured: false };
    }
    if (service.plugin.type === "beszel" || service.plugin.type === "proxmox" || service.plugin.type === "mikrotik" || service.plugin.type === "qbittorrent" || service.plugin.type === "nginx-proxy-manager") {
      const provider = service.plugin.type;
      const body = provider === "beszel"
        ? beszelCredentialsSchema.parse(request.body)
        : provider === "proxmox"
          ? proxmoxCredentialsSchema.parse(request.body)
          : provider === "mikrotik"
          ? mikrotikCredentialsSchema.parse(request.body)
          : provider === "qbittorrent"
            ? qbittorrentCredentialsSchema.parse(request.body)
            : nginxProxyManagerCredentialsSchema.parse(request.body);
      const password = body.clearPassword ? "" : body.password || previous?.password || "";
      setServiceCredentials(database, id, provider, { username: body.username, password });
      return { username: body.username, passwordConfigured: Boolean(password) };
    }
    if (service.plugin.type === "plex") {
      const body = plexCredentialsSchema.parse(request.body);
      const password = body.clearToken ? "" : body.token?.trim() || previous?.password || "";
      setServiceCredentials(database, id, "plex", { username: "", password });
      return { username: "", passwordConfigured: Boolean(password) };
    }
    const body = service.plugin.type === "portainer"
      ? portainerCredentialsSchema.parse(request.body)
      : service.plugin.type === "uptime-kuma"
        ? uptimeKumaCredentialsSchema.parse(request.body)
      : service.plugin.type === "jellyfin"
        ? jellyfinCredentialsSchema.parse(request.body)
        : arrCredentialsSchema.parse(request.body);
    const password = body.clearApiKey ? "" : body.apiKey?.trim() || previous?.password || "";
    setServiceCredentials(database, id, service.plugin.type, { username: "", password });
    return { username: "", passwordConfigured: Boolean(password) };
  });

  app.post("/api/services/:id/plugin/test", { preHandler: auth.requireAuth }, async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    const service = findService(database, id);
    if (!service) return reply.code(404).send({ error: "Service not found" });
    const body = z.discriminatedUnion("type", [
      z.object({
        type: z.literal("beszel"),
        config: beszelConfigSchema,
        credentials: beszelCredentialsSchema,
      }),
      z.object({
        type: z.literal("portainer"),
        config: portainerConfigSchema,
        credentials: portainerCredentialsSchema,
      }),
      z.object({
        type: z.literal("proxmox"),
        config: proxmoxConfigSchema,
        credentials: proxmoxCredentialsSchema,
      }),
      z.object({
        type: z.literal("uptime-kuma"),
        config: uptimeKumaConfigSchema,
        credentials: uptimeKumaCredentialsSchema,
      }),
      z.object({
        type: z.literal("jellyfin"),
        config: jellyfinConfigSchema,
        credentials: jellyfinCredentialsSchema,
      }),
      z.object({
        type: z.literal("plex"),
        config: plexConfigSchema,
        credentials: plexCredentialsSchema,
      }),
      z.object({
        type: z.literal("mikrotik"),
        config: mikrotikConfigSchema,
        credentials: mikrotikCredentialsSchema,
      }),
      z.object({
        type: z.literal("radarr"),
        config: arrConfigSchema,
        credentials: arrCredentialsSchema,
      }),
      z.object({
        type: z.literal("sonarr"),
        config: arrConfigSchema,
        credentials: arrCredentialsSchema,
      }),
      z.object({
        type: z.literal("lidarr"),
        config: arrConfigSchema,
        credentials: arrCredentialsSchema,
      }),
      z.object({ type: z.literal("prowlarr"), config: arrConfigSchema, credentials: arrCredentialsSchema }),
      z.object({ type: z.literal("bazarr"), config: arrConfigSchema, credentials: arrCredentialsSchema }),
      z.object({ type: z.literal("qbittorrent"), config: arrConfigSchema, credentials: qbittorrentCredentialsSchema }),
      z.object({ type: z.literal("nginx-proxy-manager"), config: arrConfigSchema, credentials: nginxProxyManagerCredentialsSchema }),
      z.object({ type: z.literal("steam-wishlist"), config: steamWishlistConfigSchema, credentials: steamWishlistCredentialsSchema }),
    ]).parse(request.body);
    if (!service.plugin || service.plugin.type !== body.type) {
      return reply.code(409).send({ error: "Save the selected plugin before testing it" });
    }
    const requestedUrl = "url" in body.config ? body.config.url : undefined;
    const storedForTest = requestedUrl === undefined || requestedUrl === service.plugin.config.url
      ? getServiceCredentials(database, id, body.type)
      : undefined;
    try {
      if (body.type === "beszel") {
        const stored = storedForTest;
        const password = body.credentials.clearPassword ? "" : body.credentials.password || stored?.password || "";
        return await testBeszelConnection(body.config, { username: body.credentials.username, password });
      }
      if (body.type === "portainer") {
        const stored = storedForTest;
        const apiKey = body.credentials.clearApiKey ? "" : body.credentials.apiKey?.trim() || stored?.password || "";
        return await testPortainerConnection(body.config, { apiKey });
      }
      if (body.type === "proxmox") {
        const stored = storedForTest;
        const tokenSecret = body.credentials.clearPassword ? "" : body.credentials.password || stored?.password || "";
        const tokenId = body.credentials.username || stored?.username || "";
        return await testProxmoxConnection(body.config, { tokenId, tokenSecret });
      }
      if (body.type === "uptime-kuma") {
        const stored = storedForTest;
        const apiKey = body.credentials.clearApiKey ? "" : body.credentials.apiKey?.trim() || stored?.password || "";
        return await testUptimeKumaConnection(body.config, { apiKey });
      }
      if (body.type === "jellyfin") {
        const stored = storedForTest;
        const apiKey = body.credentials.clearApiKey ? "" : body.credentials.apiKey?.trim() || stored?.password || "";
        return await testJellyfinConnection(body.config, { apiKey });
      }
      if (body.type === "plex") {
        const stored = storedForTest;
        const token = body.credentials.clearToken ? "" : body.credentials.token?.trim() || stored?.password || "";
        return await testPlexConnection(body.config, { token });
      }
      if (body.type === "mikrotik") {
        const stored = storedForTest;
        const password = body.credentials.clearPassword ? "" : body.credentials.password || stored?.password || "";
        const username = body.credentials.username || stored?.username || "";
        return await testMikrotikConnection(body.config, { username, password });
      }
      if (body.type === "qbittorrent") {
        const stored = storedForTest;
        const password = body.credentials.clearPassword ? "" : body.credentials.password || stored?.password || "";
        const username = body.credentials.username || stored?.username || "";
        return await testQBittorrentConnection(body.config, { username, password });
      }
      if (body.type === "nginx-proxy-manager") {
        const stored = storedForTest;
        const password = body.credentials.clearPassword ? "" : body.credentials.password || stored?.password || "";
        const identity = body.credentials.username || stored?.username || "";
        return await testNginxProxyManagerConnection(body.config, { identity, password });
      }
      if (body.type === "steam-wishlist") {
        const stored = storedForTest;
        const steamId = body.credentials.username || stored?.username || "";
        return await testSteamWishlistConnection(body.config, { steamId });
      }
      const stored = storedForTest;
      const apiKey = body.credentials.clearApiKey ? "" : body.credentials.apiKey?.trim() || stored?.password || "";
      if (body.type === "lidarr") return await testLidarrConnection(body.config, { apiKey });
      if (body.type === "prowlarr") return await testProwlarrConnection(body.config, { apiKey });
      if (body.type === "bazarr") return await testBazarrConnection(body.config, { apiKey });
      return await testArrConnection(body.type, body.config, { apiKey });
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Plugin connection failed" });
    }
  });

  app.get("/api/services/:id/plugin", async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    const service = findService(database, id);
    if (!service?.plugin?.enabled || (!isAdmin(request) && !publishedService(id))) {
      return reply.code(404).send({ error: "Enabled service plugin not found" });
    }
    try {
      if (service.plugin.type === "beszel") {
        const credentials = getServiceCredentials(database, id, "beszel");
        if (!credentials?.password) return reply.code(409).send({ error: "Beszel credentials are not configured" });
        return await fetchBeszelWidget(beszelConfigSchema.parse(service.plugin.config), credentials);
      }
      if (service.plugin.type === "portainer") {
        const credentials = getServiceCredentials(database, id, "portainer");
        if (!credentials?.password) return reply.code(409).send({ error: "Portainer access token is not configured" });
        return await fetchPortainerPlugin(portainerConfigSchema.parse(service.plugin.config), { apiKey: credentials.password });
      }
      if (service.plugin.type === "proxmox") {
        const credentials = getServiceCredentials(database, id, "proxmox");
        if (!credentials?.username || !credentials.password) return reply.code(409).send({ error: "Proxmox API token is not configured" });
        return await fetchProxmoxPlugin(proxmoxConfigSchema.parse(service.plugin.config), {
          tokenId: credentials.username,
          tokenSecret: credentials.password,
        });
      }
      if (service.plugin.type === "uptime-kuma") {
        const credentials = getServiceCredentials(database, id, "uptime-kuma");
        if (!credentials?.password) return reply.code(409).send({ error: "Uptime Kuma API key is not configured" });
        return await fetchUptimeKumaPlugin(uptimeKumaConfigSchema.parse(service.plugin.config), { apiKey: credentials.password });
      }
      if (service.plugin.type === "jellyfin") {
        const credentials = getServiceCredentials(database, id, "jellyfin");
        if (!credentials?.password) return reply.code(409).send({ error: "Jellyfin API key is not configured" });
        return await fetchJellyfinPlugin(jellyfinConfigSchema.parse(service.plugin.config), { apiKey: credentials.password });
      }
      if (service.plugin.type === "plex") {
        const credentials = getServiceCredentials(database, id, "plex");
        if (!credentials?.password) return reply.code(409).send({ error: "Plex token is not configured" });
        return await fetchPlexPlugin(plexConfigSchema.parse(service.plugin.config), { token: credentials.password });
      }
      if (service.plugin.type === "mikrotik") {
        const credentials = getServiceCredentials(database, id, "mikrotik");
        if (!credentials?.username || !credentials.password) return reply.code(409).send({ error: "MikroTik credentials are not configured" });
        return await fetchMikrotikPlugin(mikrotikConfigSchema.parse(service.plugin.config), credentials);
      }
      if (service.plugin.type === "qbittorrent") {
        const credentials = getServiceCredentials(database, id, "qbittorrent");
        if (!credentials?.username || !credentials.password) return reply.code(409).send({ error: "qBittorrent credentials are not configured" });
        return await fetchQBittorrentPlugin(arrConfigSchema.parse(service.plugin.config), credentials);
      }
      if (service.plugin.type === "nginx-proxy-manager") {
        const credentials = getServiceCredentials(database, id, "nginx-proxy-manager");
        if (!credentials?.username || !credentials.password) return reply.code(409).send({ error: "Nginx Proxy Manager credentials are not configured" });
        return await fetchNginxProxyManagerPlugin(arrConfigSchema.parse(service.plugin.config), { identity: credentials.username, password: credentials.password });
      }
      if (service.plugin.type === "steam-wishlist") {
        const credentials = getServiceCredentials(database, id, "steam-wishlist");
        if (!credentials?.username) return reply.code(409).send({ error: "SteamID64 is not configured" });
        return await fetchSteamWishlistPlugin(steamWishlistConfigSchema.parse(service.plugin.config), { steamId: credentials.username });
      }
      const credentials = getServiceCredentials(database, id, service.plugin.type);
      const providerName = service.plugin.type === "radarr" ? "Radarr" : service.plugin.type === "sonarr" ? "Sonarr" : service.plugin.type === "lidarr" ? "Lidarr" : service.plugin.type === "prowlarr" ? "Prowlarr" : "Bazarr";
      if (!credentials?.password) return reply.code(409).send({ error: `${providerName} API key is not configured` });
      if (service.plugin.type === "lidarr") return await fetchLidarrPlugin(arrConfigSchema.parse(service.plugin.config), { apiKey: credentials.password });
      if (service.plugin.type === "prowlarr") return await fetchProwlarrPlugin(arrConfigSchema.parse(service.plugin.config), { apiKey: credentials.password });
      if (service.plugin.type === "bazarr") return await fetchBazarrPlugin(arrConfigSchema.parse(service.plugin.config), { apiKey: credentials.password });
      return await fetchArrPlugin(service.plugin.type, arrConfigSchema.parse(service.plugin.config), { apiKey: credentials.password });
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Service plugin request failed" });
    }
  });

  app.get("/api/services/:id/plugin/artwork/:artworkId", async (request, reply) => {
    const { id, artworkId } = mediaArtworkParamsSchema.parse(request.params);
    const service = findService(database, id);
    if (!service?.plugin?.enabled || (!isAdmin(request) && !publishedService(id)) || !["jellyfin", "plex"].includes(service.plugin.type)) {
      return reply.code(404).send({ error: "Media artwork not found" });
    }
    try {
      const credentials = getServiceCredentials(database, id, service.plugin.type);
      if (!credentials?.password) return reply.code(404).send({ error: "Media artwork not found" });
      const result = service.plugin.type === "jellyfin"
        ? await fetchJellyfinArtwork(jellyfinConfigSchema.parse(service.plugin.config), { apiKey: credentials.password }, artworkId)
        : await fetchPlexArtwork(plexConfigSchema.parse(service.plugin.config), { token: credentials.password }, artworkId);
      return reply
        .header("Cache-Control", "private, max-age=300")
        .header("X-Content-Type-Options", "nosniff")
        .header("Cross-Origin-Resource-Policy", "same-origin")
        .type(result.contentType)
        .send(result.buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Media artwork request failed";
      const status = /reference is invalid|no longer available/i.test(message) ? 404 : 502;
      return reply.code(status).send({ error: status === 404 ? "Media artwork not found" : "Media artwork is unavailable" });
    }
  });

  app.put("/api/settings", { preHandler: auth.requireAuth }, async (request) => {
    const settings = settingsSchema.parse(request.body);
    return mutateDashboard(database, "Appearance and settings updated", (transaction) => {
      transaction.prepare("UPDATE dashboard_settings SET payload = ? WHERE id = 1").run(JSON.stringify(settings));
    });
  });

  app.get("/api/settings", { preHandler: auth.requireAuth }, async () => readDashboard(database).settings);
  app.get("/api/widgets", { preHandler: auth.requireAuth }, async () => readDashboard(database).widgets);
  app.get("/api/widgets/:id", { preHandler: auth.requireAuth }, async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    return findWidget(database, id) ?? reply.code(404).send({ error: "Widget not found" });
  });

  app.post("/api/widgets", { preHandler: auth.requireAuth }, async (request) => {
    const current = readDashboard(database);
    const body = z.record(z.string(), z.unknown()).parse(request.body);
    const widget = widgetSchema.parse({
      ...body,
      id: body.id ?? `widget-${randomUUID()}`,
      position: body.position ?? current.widgets.length,
    });
    return mutateDashboard(database, `Widget “${widget.type}” added`, (transaction) => {
      transaction
        .prepare("INSERT INTO dashboard_widgets (id, type, enabled, position, config) VALUES (?, ?, ?, ?, ?)")
        .run(widget.id, widget.type, widget.enabled ? 1 : 0, widget.position, JSON.stringify(widget.config));
    });
  });

  const updateWidget = async (request: FastifyRequest) => {
    const { id } = routeIdSchema.parse(request.params);
    const existing = findWidget(database, id);
    if (!existing) return undefined;
    const body = z.record(z.string(), z.unknown()).parse(request.body);
    const widget = widgetSchema.parse({ ...existing, ...body, id });
    return mutateDashboard(database, `Widget “${widget.type}” updated`, (transaction) => {
      transaction
        .prepare("UPDATE dashboard_widgets SET type = ?, enabled = ?, position = ?, config = ? WHERE id = ?")
        .run(widget.type, widget.enabled ? 1 : 0, widget.position, JSON.stringify(widget.config), id);
    });
  };

  app.put("/api/widgets/:id", { preHandler: auth.requireAuth }, async (request, reply) => {
    return (await updateWidget(request)) ?? reply.code(404).send({ error: "Widget not found" });
  });
  app.patch("/api/widgets/:id", { preHandler: auth.requireAuth }, async (request, reply) => {
    return (await updateWidget(request)) ?? reply.code(404).send({ error: "Widget not found" });
  });
  app.delete("/api/widgets/:id", { preHandler: auth.requireAuth }, async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    const existing = findWidget(database, id);
    if (!existing) return reply.code(404).send({ error: "Widget not found" });
    return mutateDashboard(database, `Widget “${existing.type}” deleted`, (transaction) => {
      transaction.prepare("DELETE FROM dashboard_widgets WHERE id = ?").run(id);
      deleteWidgetCredentials(transaction, id);
    });
  });

  app.get("/api/widgets/:id/credentials", { preHandler: auth.requireAuth }, async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    const widget = findWidget(database, id);
    if (!widget) return reply.code(404).send({ error: "Widget not found" });
    const credentials = getWidgetCredentials(database, id);
    if (widget.type === "feed-reader") {
      const sources = storedFeedSources(credentials?.password ?? "");
      return { feedConfigured: sources.length > 0, sources: sources.map(({ id, name, url }) => ({ id, name: name || new URL(url).hostname })) };
    }
    if (widget.type === "calendar-agenda") {
      return { feedConfigured: Boolean(credentials?.password) };
    }
    if (widget.type !== "beszel") return reply.code(404).send({ error: "Widget credentials not found" });
    return {
      username: credentials?.username ?? "",
      passwordConfigured: Boolean(credentials?.password),
    };
  });

  app.put("/api/widgets/:id/credentials", { preHandler: auth.requireAuth }, async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    const widget = findWidget(database, id);
    if (!widget) return reply.code(404).send({ error: "Widget not found" });
    if (widget.type === "calendar-agenda") {
      const body = calendarAgendaCredentialsSchema.parse(request.body);
      const previous = getWidgetCredentials(database, id);
      const rawFeedUrl = body.clearFeedUrl ? "" : body.feedUrl?.trim() || previous?.password || "";
      const feedUrl = rawFeedUrl ? normalizeCalendarFeedUrl(rawFeedUrl) : "";
      setWidgetCredentials(database, id, { username: "", password: feedUrl });
      return { feedConfigured: Boolean(feedUrl) };
    }
    if (widget.type === "feed-reader") {
      const body = feedReaderCredentialsSchema.parse(request.body);
      const previous = getWidgetCredentials(database, id);
      let sources = body.clearFeedUrl ? [] : storedFeedSources(previous?.password ?? "");
      if (body.feedUrl?.trim()) sources = [{ id: "legacy", name: "", url: normalizeFeedReaderUrl(body.feedUrl) }];
      if (body.removeId) sources = sources.filter((source) => source.id !== body.removeId);
      if (body.add) {
        const url = normalizeFeedReaderUrl(body.add.feedUrl);
        if (sources.length >= MAX_FEED_SOURCES) return reply.code(400).send({ error: `A widget can use at most ${MAX_FEED_SOURCES} feeds.` });
        if (sources.some((source) => source.url === url)) return reply.code(409).send({ error: "This feed is already added." });
        sources = [...sources, { id: randomUUID(), name: body.add.name, url }];
      }
      setWidgetCredentials(database, id, { username: "", password: sources.length ? JSON.stringify(sources) : "" });
      return { feedConfigured: sources.length > 0, sources: sources.map(({ id, name, url }) => ({ id, name: name || new URL(url).hostname })) };
    }
    if (widget.type !== "beszel") return reply.code(404).send({ error: "Widget credentials not found" });
    const body = beszelCredentialsSchema.parse(request.body);
    const previous = getWidgetCredentials(database, id);
    const password = body.clearPassword ? "" : body.password || previous?.password || "";
    setWidgetCredentials(database, id, { username: body.username, password });
    return { username: body.username, passwordConfigured: Boolean(password) };
  });

  app.post("/api/widgets/beszel/:id/test", { preHandler: auth.requireAuth }, async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    const widget = findWidget(database, id);
    if (!widget || widget.type !== "beszel") return reply.code(404).send({ error: "Beszel widget not found" });
    const body = z.object({
      config: beszelConfigSchema,
      credentials: beszelCredentialsSchema,
    }).parse(request.body);
    const stored = body.config.url === widget.config.url ? getWidgetCredentials(database, id) : undefined;
    const password = body.credentials.clearPassword
      ? ""
      : body.credentials.password || stored?.password || "";
    try {
      return await testBeszelConnection(body.config, {
        username: body.credentials.username,
        password,
      });
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Beszel connection failed" });
    }
  });

  app.get("/api/widgets/beszel/:id", async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    const widget = findWidget(database, id);
    if (!widget || widget.type !== "beszel" || !widget.enabled) {
      return reply.code(404).send({ error: "Enabled Beszel widget not found" });
    }
    const credentials = getWidgetCredentials(database, id);
    if (!credentials) return reply.code(409).send({ error: "Beszel credentials are not configured" });
    try {
      return await fetchBeszelWidget(beszelConfigSchema.parse(widget.config), credentials);
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Beszel request failed" });
    }
  });

  app.post("/api/widgets/calendar-agenda/:id/test", { preHandler: auth.requireAuth }, async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    const widget = findWidget(database, id);
    if (!widget || widget.type !== "calendar-agenda") {
      return reply.code(404).send({ error: "Calendar agenda widget not found" });
    }
    const body = calendarAgendaTestSchema.parse(request.body);
    const stored = getWidgetCredentials(database, id);
    const rawFeedUrl = body.credentials.clearFeedUrl
      ? ""
      : body.credentials.feedUrl?.trim() || stored?.password || "";
    try {
      return await testCalendarAgendaConnection(id, body.config, { feedUrl: rawFeedUrl });
    } catch (error) {
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "Calendar connection failed",
      });
    }
  });

  app.get("/api/widgets/calendar-agenda/:id", async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    const widget = findWidget(database, id);
    if (!widget || widget.type !== "calendar-agenda" || !widget.enabled) {
      return reply.code(404).send({ error: "Enabled calendar agenda widget not found" });
    }
    const credentials = getWidgetCredentials(database, id);
    if (!credentials?.password) return reply.code(409).send({ error: "Calendar feed URL is not configured" });
    try {
      return await fetchCalendarAgenda(id, widget.config, { feedUrl: credentials.password });
    } catch (error) {
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "Calendar request failed",
      });
    }
  });

  app.post("/api/widgets/feed-reader/:id/test", { preHandler: auth.requireAuth }, async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    const widget = findWidget(database, id);
    if (!widget || widget.type !== "feed-reader") {
      return reply.code(404).send({ error: "Feed reader widget not found" });
    }
    const body = feedReaderTestSchema.parse(request.body);
    const stored = getWidgetCredentials(database, id);
    const sources = body.credentials.clearFeedUrl ? [] : storedFeedSources(stored?.password ?? "");
    const testSources = body.credentials.feedUrl?.trim()
      ? [{ id: "test", name: "", url: body.credentials.feedUrl }]
      : body.credentials.add
        ? [{ id: "test", name: body.credentials.add.name, url: body.credentials.add.feedUrl }]
        : sources;
    try {
      return await testFeedReaderConnection(id, body.config, { sources: testSources });
    } catch (error) {
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "Feed connection failed",
      });
    }
  });

  app.get("/api/widgets/feed-reader/:id", async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    const widget = findWidget(database, id);
    if (!widget || widget.type !== "feed-reader" || !widget.enabled) {
      return reply.code(404).send({ error: "Enabled feed reader widget not found" });
    }
    const credentials = getWidgetCredentials(database, id);
    if (!credentials?.password) return reply.code(409).send({ error: "Feed URL is not configured" });
    try {
      return await fetchFeedReader(id, widget.config, { sources: storedFeedSources(credentials.password) });
    } catch (error) {
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "Feed request failed",
      });
    }
  });

  app.get("/api/widgets/custom-api/:id", async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    const widget = findWidget(database, id);
    if (!widget || widget.type !== "custom-api" || !widget.enabled) {
      return reply.code(404).send({ error: "Enabled custom API widget not found" });
    }
    try {
      return await fetchCustomApiWidget(widget);
    } catch (error) {
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "Custom API request failed",
      });
    }
  });

  app.post("/api/reorder", { preHandler: auth.requireAuth }, async (request) => {
    const body = reorderSchema.parse(request.body);
    if (body.groups && duplicateValues(body.groups)) throw new HomepageYamlError("Group order contains duplicate IDs.");
    if (body.widgets && duplicateValues(body.widgets)) throw new HomepageYamlError("Widget order contains duplicate IDs.");
    for (const ids of Object.values(body.services ?? {})) {
      if (duplicateValues(ids)) throw new HomepageYamlError("Service order contains duplicate IDs.");
    }
    return mutateDashboard(database, "Dashboard reordered", (transaction) => {
      const updateGroup = transaction.prepare("UPDATE dashboard_groups SET position = ? WHERE id = ?");
      body.groups?.forEach((id, index) => updateGroup.run(index, id));
      const updateService = transaction.prepare(
        "UPDATE dashboard_services SET position = ? WHERE id = ? AND group_id = ?",
      );
      for (const [groupId, serviceIds] of Object.entries(body.services ?? {})) {
        serviceIds.forEach((id, index) => updateService.run(index, id, groupId));
      }
      const updateWidget = transaction.prepare("UPDATE dashboard_widgets SET position = ? WHERE id = ?");
      body.widgets?.forEach((id, index) => updateWidget.run(index, id));
    });
  });

  app.post(
    "/api/import/preview",
    { preHandler: auth.requireAuth, bodyLimit: MAX_IMPORT_BODY_BYTES },
    async (request) => {
      const { yaml, settingsYaml } = homepagePreviewImportSchema.parse(request.body);
      return parseHomepageYaml(yaml, settingsYaml);
    },
  );

  app.post(
    "/api/import/commit",
    { preHandler: auth.requireAuth, bodyLimit: MAX_IMPORT_BODY_BYTES },
    async (request) => {
      const body = homepageCommitImportSchema.parse(request.body);
    const preview = body.yaml ? parseHomepageYaml(body.yaml, body.settingsYaml) : body.preview;
    if (!preview) throw new HomepageYamlError("No import preview was provided.");
    const groups = preview.groups.map((group, groupPosition) => ({
      ...group,
      position: groupPosition,
      services: group.services.map((service, servicePosition) => ({
        ...service,
        groupId: group.id,
        position: servicePosition,
      })),
    })) as DashboardGroup[];
      return replaceGroups(database, groups, "Homepage YAML imported");
    },
  );

  app.get("/api/export/homepage", { preHandler: auth.requireAuth }, async (_request, reply) => {
    const yaml = exportHomepageYaml(readDashboard(database).groups);
    return reply
      .type("application/yaml; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="services.yaml"')
      .send(yaml);
  });
  app.get("/api/export/homepage.yaml", { preHandler: auth.requireAuth }, async (_request, reply) => {
    const yaml = exportHomepageYaml(readDashboard(database).groups);
    return reply
      .type("application/yaml; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="services.yaml"')
      .send(yaml);
  });

  app.get("/api/export/homepage/settings.yaml", { preHandler: auth.requireAuth }, async (_request, reply) => {
    const yaml = exportHomepageSettingsYaml(readDashboard(database).groups);
    return reply
      .type("application/yaml; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="settings.yaml"')
      .send(yaml);
  });

  app.get("/api/backups", { preHandler: auth.requireAuth }, async (_request, reply) => {
    const date = new Date().toISOString().slice(0, 10);
    reply.header("Content-Disposition", `attachment; filename="dashcenter-backup-${date}.json"`);
    return { version: 1, exportedAt: new Date().toISOString(), dashboard: readDashboard(database) };
  });

  app.post("/api/backups", { preHandler: auth.requireAuth }, async (request) => {
    const body = z.record(z.string(), z.unknown()).parse(request.body);
    const candidate = body.dashboard ?? body;
    const dashboard = asDashboard(dashboardSchema.parse(candidate));
    return replaceDashboard(database, dashboard, "JSON backup restored");
  });

  app.get("/api/revisions", { preHandler: auth.requireAuth }, async () => listRevisions(database));
  app.post("/api/revisions/:id/restore", { preHandler: auth.requireAuth }, async (request, reply) => {
    const { id } = revisionIdSchema.parse(request.params);
    return restoreRevision(database, id) ?? reply.code(404).send({ error: "Revision not found" });
  });

  app.post(
    "/api/appearance/background",
    { preHandler: [auth.requireAuth, limitImageUploads] },
    imageUploadHandler(uploadsDirectory),
  );
  app.post(
    "/api/appearance/icon",
    { preHandler: [auth.requireAuth, limitImageUploads] },
    imageUploadHandler(uploadsDirectory),
  );
  app.post(
    "/api/icons/upload",
    { preHandler: [auth.requireAuth, limitImageUploads] },
    imageUploadHandler(uploadsDirectory),
  );
  app.get("/api/icons/svg/:set/:name", async (request, reply) => {
    const params = z
      .object({
        set: z.enum(["mdi", "si"]),
        name: z.string().trim().min(1).max(160).regex(/^[a-z0-9][a-z0-9._-]*$/i),
      })
      .parse(request.params);
    try {
      const svg = await loadPinnedSvgIcon(params.set as SvgIconSet, params.name);
      return reply
        .header("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400")
        .type("image/svg+xml; charset=utf-8")
        .send(svg);
    } catch {
      return reply.code(404).send({ error: "Icon not found" });
    }
  });

  app.get("/api/docker/connections", { preHandler: auth.requireAuth }, async () => readDashboard(database).connections);

  app.post("/api/docker/connections", { preHandler: auth.requireAuth }, async (request) => {
    const body = z.record(z.string(), z.unknown()).parse(request.body);
    // Connection IDs are internal database identifiers. Always allocate them on
    // the server so a stale or malicious client-provided ID cannot overwrite or
    // collide with an existing connection.
    const connection = connectionSchema.parse({ ...body, id: `docker-${randomUUID()}` }) as DockerConnection;
    return mutateDashboard(database, `Docker connection “${connection.name}” added`, (transaction) => {
      transaction
        .prepare("INSERT INTO docker_connections (id, name, type, endpoint, enabled) VALUES (?, ?, ?, ?, ?)")
        .run(connection.id, connection.name, connection.type, connection.endpoint, connection.enabled ? 1 : 0);
    });
  });

  app.put("/api/docker/connections/:id", { preHandler: auth.requireAuth }, async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    const existing = getConnection(database, id);
    if (!existing) return reply.code(404).send({ error: "Docker connection not found" });
    const body = z.record(z.string(), z.unknown()).parse(request.body);
    const connection = connectionSchema.parse({ ...existing, ...body, id }) as DockerConnection;
    return mutateDashboard(database, `Docker connection “${connection.name}” updated`, (transaction) => {
      transaction
        .prepare("UPDATE docker_connections SET name = ?, type = ?, endpoint = ?, enabled = ? WHERE id = ?")
        .run(connection.name, connection.type, connection.endpoint, connection.enabled ? 1 : 0, id);
    });
  });

  app.delete("/api/docker/connections/:id", { preHandler: auth.requireAuth }, async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    const existing = getConnection(database, id);
    if (!existing) return reply.code(404).send({ error: "Docker connection not found" });
    return mutateDashboard(database, `Docker connection “${existing.name}” deleted`, (transaction) => {
      transaction.prepare("DELETE FROM docker_connections WHERE id = ?").run(id);
    });
  });

  app.post("/api/docker/connections/:id/test", { preHandler: auth.requireAuth }, async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    const connection = getConnection(database, id);
    if (!connection) return reply.code(404).send({ error: "Docker connection not found" });
    return testDockerConnection(connection);
  });

  app.post("/api/docker/connections/test", { preHandler: auth.requireAuth }, async (request) => {
    const body = z.record(z.string(), z.unknown()).parse(request.body);
    const connection = connectionSchema.parse({ ...body, id: body.id ?? `docker-preview-${randomUUID()}` }) as DockerConnection;
    return testDockerConnection(connection);
  });

  app.get("/api/docker/connections/:id/containers", { preHandler: auth.requireAuth }, async (request, reply) => {
    const { id } = routeIdSchema.parse(request.params);
    const connection = getConnection(database, id);
    if (!connection) return reply.code(404).send({ error: "Docker connection not found" });
    try {
      return await listDockerContainers(connection);
    } catch (error) {
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "Could not list Docker containers",
      });
    }
  });

  app.post("/api/health/refresh", { preHandler: auth.requireAuth }, async () => {
    const updates = await healthRefresh.run();
    return { updatedAt: new Date().toISOString(), updates, dashboard: readDashboard(database) };
  });

  app.get("/api/weather", async (request, reply) => {
    const query = z
      .object({
        lat: z.coerce.number().min(-90).max(90).optional(),
        lon: z.coerce.number().min(-180).max(180).optional(),
        label: z.string().trim().max(120).optional(),
      })
      .parse(request.query);
    const settings = readDashboard(database).settings;
    try {
      return await fetchWeather(
        query.label ?? settings.weatherLabel,
        query.lat ?? settings.weatherLatitude,
        query.lon ?? settings.weatherLongitude,
      );
    } catch (error) {
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "Weather service is unavailable",
      });
    }
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (
      frontendDirectory &&
      (options.serveFrontend === true || process.env.NODE_ENV === "production") &&
      request.method === "GET" &&
      !request.url.startsWith("/api/") &&
      !request.url.startsWith("/uploads/") &&
      request.headers.accept?.includes("text/html")
    ) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found" });
  });

  app.addHook("onReady", async () => {
    await uploadPruner.run();
    uploadPruner.start();
    if (options.healthRefreshIntervalMs !== false) healthRefresh.start();
  });

    return app;
  } catch (error) {
    await closeResources();
    throw error;
  }
}

async function start(): Promise<void> {
  const app = await buildApp();
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const host = process.env.HOST ?? "0.0.0.0";
  await app.listen({ port: Number.isFinite(port) ? port : 3000, host });

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

// Kept exported for lightweight integration tests and embedded deployments.
export { createDatabase };

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DashboardData } from "../shared/types.js";
import { createDatabase } from "./database.js";
import { buildApp } from "./index.js";
import { fetchSteamWishlistPlugin, normalizeSteamId, testSteamWishlistConnection } from "./steam-wishlist.js";

const steamId = "76561198000000001";
const config = {
  countryCode: "SK",
  language: "english",
  minDiscount: 20,
  maxItems: 2,
  sortBy: "discount" as const,
  refreshMinutes: 360,
};

function storeItem(appId: number, name: string, discount: number, finalPrice: number) {
  const originalPrice = Math.round(finalPrice / (1 - discount / 100));
  return {
    appid: appId,
    name,
    assets: { asset_url_format: `steam/apps/${appId}/\${FILENAME}`, header: "header.jpg" },
    reviews: { summary_filtered: { percent_positive: 91, review_score_label: "Very Positive" } },
    best_purchase_option: {
      final_price_in_cents: String(finalPrice),
      original_price_in_cents: String(originalPrice),
      formatted_final_price: `${(finalPrice / 100).toFixed(2)}€`,
      formatted_original_price: `${(originalPrice / 100).toFixed(2)}€`,
      discount_pct: discount,
      active_discounts: [{ discount_end_date: 1_800_000_000 }],
    },
  };
}

function mockSteam(calls: string[]) {
  return async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    if (url.pathname.includes("/IWishlistService/GetWishlist/")) {
      assert.equal(url.searchParams.get("steamid"), steamId);
      return new Response(JSON.stringify({ response: { items: [
        { appid: 10, priority: 2, date_added: 100 },
        { appid: 20, priority: 1, date_added: 200 },
        { appid: 30, priority: 3, date_added: 300 },
      ] } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.includes("/IStoreBrowseService/GetItems/")) {
      const inputJson = JSON.parse(url.searchParams.get("input_json") ?? "{}") as {
        ids?: Array<{ appid: number }>;
        context?: { country_code?: string; language?: string };
      };
      assert.deepEqual(inputJson.ids?.map((item) => item.appid), [10, 20, 30]);
      assert.equal(inputJson.context?.country_code, "SK");
      assert.equal(inputJson.context?.language, "english");
      return new Response(JSON.stringify({ response: { store_items: [
        storeItem(10, "Forest Signal", 50, 999),
        storeItem(20, "Neon Harbor", 75, 499),
        storeItem(30, "Quiet Orbit", 10, 1799),
      ] } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };
}

test("Steam wishlist resolves public deals, pricing, artwork and cache without an API key", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = mockSteam(calls) as typeof fetch;
  try {
    const tested = await testSteamWishlistConnection(config, { steamId });
    assert.equal(tested.totalWishlist, 3);
    assert.equal(tested.onSale, 3);
    assert.equal(tested.matching, 2);
    assert.equal(tested.shown, 2);
    assert.equal(tested.highestDiscount, 75);
    assert.deepEqual(tested.deals.map((deal) => deal.name), ["Neon Harbor", "Forest Signal"]);
    assert.equal(tested.deals[0]?.finalPrice, "4.99€");
    assert.equal(tested.deals[0]?.reviewPercent, 91);
    assert.equal(tested.deals[0]?.storeUrl, "https://store.steampowered.com/app/20/");
    assert.match(tested.deals[0]?.imageUrl ?? "", /^https:\/\/shared\.akamai\.steamstatic\.com\/store_item_assets\/steam\/apps\/20\/header\.jpg$/);
    assert.doesNotMatch(JSON.stringify(tested), new RegExp(steamId));

    await fetchSteamWishlistPlugin(config, { steamId });
    await fetchSteamWishlistPlugin(config, { steamId });
    assert.equal(calls.length, 4, "the second dashboard read should use the configured cache");
  } finally {
    globalThis.fetch = original;
  }
});

test("Steam profile input accepts profile URLs and rejects vanity URLs before any request", async () => {
  assert.equal(normalizeSteamId(`https://steamcommunity.com/profiles/${steamId}/`), steamId);
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
  try {
    await assert.rejects(
      testSteamWishlistConnection(config, { steamId: "https://steamcommunity.com/id/example" }),
      /Custom Steam profile names are not supported/,
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("Steam wishlist service routes keep SteamID64 server-side and reuse it for tests", async () => {
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-steam-plugin-"));
  const database = createDatabase(path.join(dataDirectory, "app.db"));
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  process.env.DEV_BYPASS_AUTH = "1";
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = mockSteam(calls) as typeof fetch;
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });
  try {
    const initial = (await app.inject({ method: "GET", url: "/api/dashboard" })).json<DashboardData>();
    const service = initial.groups.flatMap((group) => group.services).find((item) => item.name === "YouTube");
    assert.ok(service);
    const groups = initial.groups.map((group) => ({
      ...group,
      services: group.services.map((item) => item.id === service.id ? {
        ...item,
        plugin: { type: "steam-wishlist" as const, enabled: true, presentation: "expanded" as const, config },
      } : item),
    }));
    const saved = await app.inject({ method: "PUT", url: "/api/dashboard", payload: { ...initial, groups } });
    assert.equal(saved.statusCode, 200, saved.body);
    const credentials = await app.inject({
      method: "PUT",
      url: `/api/services/${service.id}/plugin/credentials`,
      payload: { username: `https://steamcommunity.com/profiles/${steamId}/` },
    });
    assert.equal(credentials.statusCode, 200, credentials.body);
    assert.deepEqual(credentials.json(), { username: steamId, passwordConfigured: false });

    const publicDashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    assert.doesNotMatch(publicDashboard.body, new RegExp(steamId));

    const tested = await app.inject({
      method: "POST",
      url: `/api/services/${service.id}/plugin/test`,
      payload: { type: "steam-wishlist", config, credentials: { username: "" } },
    });
    assert.equal(tested.statusCode, 200, tested.body);
    assert.equal(tested.json().highestDiscount, 75);

    const plugin = await app.inject({ method: "GET", url: `/api/services/${service.id}/plugin` });
    assert.equal(plugin.statusCode, 200, plugin.body);
    assert.equal(plugin.json().deals[0].name, "Neon Harbor");
    assert.doesNotMatch(plugin.body, new RegExp(steamId));
  } finally {
    await app.close();
    globalThis.fetch = original;
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

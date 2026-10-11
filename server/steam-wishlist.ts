import { createHash } from "node:crypto";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_WISHLIST_ITEMS = 500;
const STORE_BATCH_SIZE = 50;
const WISHLIST_ENDPOINT = "https://api.steampowered.com/IWishlistService/GetWishlist/v1/";
const STORE_ITEMS_ENDPOINT = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/";
const STEAM_STORE_ORIGIN = "https://store.steampowered.com";
const STEAM_ASSET_BASE = "https://shared.akamai.steamstatic.com/store_item_assets/";

export interface SteamWishlistConfig {
  countryCode: string;
  language: string;
  minDiscount: number;
  maxItems: number;
  sortBy: "discount" | "price" | "wishlist";
  refreshMinutes: number;
}

export interface SteamWishlistCredentials {
  steamId: string;
}

export interface SteamWishlistDeal {
  appId: number;
  name: string;
  storeUrl: string;
  imageUrl: string;
  finalPrice: string;
  originalPrice: string;
  finalPriceCents: number;
  discountPercent: number;
  discountEndsAt?: string;
  reviewPercent?: number;
  reviewLabel?: string;
}

export interface SteamWishlistPayload {
  totalWishlist: number;
  onSale: number;
  matching: number;
  shown: number;
  highestDiscount: number;
  deals: SteamWishlistDeal[];
  truncated: boolean;
  updatedAt: string;
}

type JsonObject = Record<string, unknown>;
type WishlistItem = { appId: number; priority: number; dateAdded: number; index: number };

const cache = new Map<string, { value: SteamWishlistPayload; expiresAt: number }>();

export function normalizeSteamId(value: string): string {
  const trimmed = value.trim();
  if (/^\d{17}$/.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a 17-digit SteamID64 or a public steamcommunity.com/profiles URL.");
  }
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const profileMatch = url.pathname.match(/^\/profiles\/(\d{17})\/?$/);
  if (hostname !== "steamcommunity.com" || !profileMatch) {
    if (hostname === "steamcommunity.com" && url.pathname.startsWith("/id/")) {
      throw new Error("Custom Steam profile names are not supported yet. Use the profile's 17-digit SteamID64.");
    }
    throw new Error("Enter a 17-digit SteamID64 or a public steamcommunity.com/profiles URL.");
  }
  return profileMatch[1];
}

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function responseJson(response: Response, label: string): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Steam returned too much data.");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Steam returned too much data.");
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Steam could not read this wishlist. Make sure the profile and game details are public.");
    }
    throw new Error(`Steam ${label} request failed with status ${response.status}.`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Steam returned invalid ${label} data.`);
  }
}

async function steamRequest(url: URL, label: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Could not reach Steam.");
  }
  return responseJson(response, label);
}

async function loadWishlist(steamId: string): Promise<{ items: WishlistItem[]; total: number; truncated: boolean }> {
  const url = new URL(WISHLIST_ENDPOINT);
  url.searchParams.set("steamid", steamId);
  const data = objectValue(await steamRequest(url, "wishlist"));
  const response = objectValue(data?.response);
  if (!response || !Array.isArray(response.items)) {
    if (response && Object.keys(response).length === 0) {
      throw new Error("This Steam wishlist is empty or private. Set both the profile and Game details to Public in Steam privacy settings.");
    }
    throw new Error("Steam returned invalid wishlist data.");
  }
  const parsed = response.items.flatMap((entry, index): WishlistItem[] => {
    const item = objectValue(entry);
    const appId = Math.floor(numberValue(item?.appid));
    if (appId <= 0) return [];
    return [{
      appId,
      priority: Math.floor(numberValue(item?.priority)),
      dateAdded: Math.floor(numberValue(item?.date_added)),
      index,
    }];
  });
  const total = parsed.length;
  return { items: parsed.slice(0, MAX_WISHLIST_ITEMS), total, truncated: total > MAX_WISHLIST_ITEMS };
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function loadStoreItems(appIds: number[], config: SteamWishlistConfig): Promise<JsonObject[]> {
  const batches = chunks(appIds, STORE_BATCH_SIZE);
  const responses = await Promise.all(batches.map(async (ids) => {
    const url = new URL(STORE_ITEMS_ENDPOINT);
    url.searchParams.set("input_json", JSON.stringify({
      ids: ids.map((appid) => ({ appid })),
      context: { country_code: config.countryCode, language: config.language },
      data_request: {
        include_basic_info: true,
        include_assets: true,
        include_release: true,
        include_reviews: true,
        include_all_purchase_options: false,
      },
    }));
    const data = objectValue(await steamRequest(url, "store"));
    const response = objectValue(data?.response);
    if (!response || !Array.isArray(response.store_items)) throw new Error("Steam returned invalid store data.");
    return response.store_items.flatMap((item): JsonObject[] => objectValue(item) ? [item as JsonObject] : []);
  }));
  return responses.flat();
}

function steamImageUrl(appId: number, storeItem: JsonObject): string {
  const assets = objectValue(storeItem.assets);
  const filename = stringValue(assets?.header) || stringValue(assets?.main_capsule);
  const format = stringValue(assets?.asset_url_format);
  if (filename && /^[a-zA-Z0-9_.-]+$/.test(filename) && format) {
    const assetPath = format.replaceAll("${FILENAME}", filename).replaceAll("{FILENAME}", filename).replace(/^\/+/, "");
    if (assetPath.startsWith(`steam/apps/${appId}/`) && /^[a-zA-Z0-9_./?=&%-]+$/.test(assetPath)) {
      return new URL(assetPath, STEAM_ASSET_BASE).toString();
    }
  }
  return `${STEAM_ASSET_BASE}steam/apps/${appId}/header.jpg`;
}

function dealFromStoreItem(storeItem: JsonObject): SteamWishlistDeal | undefined {
  const appId = Math.floor(numberValue(storeItem.appid));
  const purchase = objectValue(storeItem.best_purchase_option);
  if (appId <= 0 || !purchase || purchase.hide_discount_pct_for_compliance === true) return undefined;
  const finalPriceCents = Math.max(0, Math.floor(numberValue(purchase.final_price_in_cents)));
  const originalPriceCents = Math.max(0, Math.floor(numberValue(purchase.original_price_in_cents)));
  const discountPercent = Math.max(0, Math.min(100, Math.floor(numberValue(purchase.discount_pct))));
  if (discountPercent <= 0 || originalPriceCents <= finalPriceCents) return undefined;
  const reviews = objectValue(storeItem.reviews);
  const reviewSummary = objectValue(reviews?.summary_filtered) ?? objectValue(reviews?.summary_unfiltered);
  const discountEndsAtSeconds = Math.floor(numberValue(
    Array.isArray(purchase.active_discounts)
      ? objectValue(purchase.active_discounts[0])?.discount_end_date
      : undefined,
  ));
  return {
    appId,
    name: stringValue(storeItem.name) || `Steam app ${appId}`,
    storeUrl: `${STEAM_STORE_ORIGIN}/app/${appId}/`,
    imageUrl: steamImageUrl(appId, storeItem),
    finalPrice: stringValue(purchase.formatted_final_price) || `${(finalPriceCents / 100).toFixed(2)} ${stringValue(purchase.currency_code)}`.trim(),
    originalPrice: stringValue(purchase.formatted_original_price) || `${(originalPriceCents / 100).toFixed(2)} ${stringValue(purchase.currency_code)}`.trim(),
    finalPriceCents,
    discountPercent,
    ...(discountEndsAtSeconds > 0 ? { discountEndsAt: new Date(discountEndsAtSeconds * 1000).toISOString() } : {}),
    ...(numberValue(reviewSummary?.percent_positive) > 0 ? { reviewPercent: Math.floor(numberValue(reviewSummary?.percent_positive)) } : {}),
    ...(stringValue(reviewSummary?.review_score_label) ? { reviewLabel: stringValue(reviewSummary?.review_score_label) } : {}),
  };
}

function sortDeals(deals: SteamWishlistDeal[], wishlist: WishlistItem[], sortBy: SteamWishlistConfig["sortBy"]): SteamWishlistDeal[] {
  const wishOrder = new Map(wishlist.map((item) => [item.appId, item]));
  return [...deals].sort((left, right) => {
    if (sortBy === "price") return left.finalPriceCents - right.finalPriceCents || right.discountPercent - left.discountPercent;
    if (sortBy === "wishlist") {
      const a = wishOrder.get(left.appId);
      const b = wishOrder.get(right.appId);
      return (a?.priority ?? 0) - (b?.priority ?? 0) || (b?.dateAdded ?? 0) - (a?.dateAdded ?? 0) || (a?.index ?? 0) - (b?.index ?? 0);
    }
    return right.discountPercent - left.discountPercent || left.finalPriceCents - right.finalPriceCents;
  });
}

async function load(config: SteamWishlistConfig, credentials: SteamWishlistCredentials): Promise<SteamWishlistPayload> {
  const steamId = normalizeSteamId(credentials.steamId);
  const wishlist = await loadWishlist(steamId);
  const storeItems = wishlist.items.length ? await loadStoreItems(wishlist.items.map((item) => item.appId), config) : [];
  const allDeals = storeItems.flatMap((item): SteamWishlistDeal[] => {
    const deal = dealFromStoreItem(item);
    return deal ? [deal] : [];
  });
  const eligibleDeals = allDeals.filter((deal) => deal.discountPercent >= config.minDiscount);
  const deals = sortDeals(eligibleDeals, wishlist.items, config.sortBy).slice(0, config.maxItems);
  return {
    totalWishlist: wishlist.total,
    onSale: allDeals.length,
    matching: eligibleDeals.length,
    shown: deals.length,
    highestDiscount: allDeals.reduce((highest, deal) => Math.max(highest, deal.discountPercent), 0),
    deals,
    truncated: wishlist.truncated,
    updatedAt: new Date().toISOString(),
  };
}

function cacheKey(config: SteamWishlistConfig, credentials: SteamWishlistCredentials): string {
  const steamIdHash = createHash("sha256").update(normalizeSteamId(credentials.steamId)).digest("hex");
  return `${steamIdHash}\u0000${config.countryCode}\u0000${config.language}\u0000${config.minDiscount}\u0000${config.maxItems}\u0000${config.sortBy}\u0000${config.refreshMinutes}`;
}

export async function testSteamWishlistConnection(config: SteamWishlistConfig, credentials: SteamWishlistCredentials) {
  return { ok: true, ...(await load(config, credentials)) };
}

export async function fetchSteamWishlistPlugin(config: SteamWishlistConfig, credentials: SteamWishlistCredentials): Promise<SteamWishlistPayload> {
  const key = cacheKey(config, credentials);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await load(config, credentials);
  cache.set(key, { value, expiresAt: Date.now() + config.refreshMinutes * 60_000 });
  return value;
}

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CACHE_TTL_MS = 2 * 60_000;
const MAX_SOURCE_ENTRIES = 1_000;

export type FeedReaderMode = "articles" | "releases";

export interface FeedReaderConfig {
  label: string;
  mode: FeedReaderMode;
  maxItems: number;
  maxAgeDays: number;
  showImages: boolean;
}

export interface FeedReaderCredentials {
  feedUrl: string;
}

export interface FeedReaderItem {
  id: string;
  title: string;
  summary: string;
  url?: string;
  imageUrl?: string;
  author: string;
  publishedAt?: string;
  version?: string;
}

export interface FeedReaderResponse {
  label: string;
  mode: FeedReaderMode;
  feedTitle: string;
  homeUrl?: string;
  items: FeedReaderItem[];
  hasMore: boolean;
  updatedAt: string;
}

interface ParsedEntry extends FeedReaderItem {
  sourceIndex: number;
}

const cache = new Map<string, { expiresAt: number; value: FeedReaderResponse }>();

export function normalizeFeedReaderConfig(value: Record<string, unknown>): FeedReaderConfig {
  const mode: FeedReaderMode = value.mode === "releases" ? "releases" : "articles";
  const rawLabel = typeof value.label === "string" ? value.label.trim() : "";
  const rawMaxItems = Number(value.maxItems);
  const rawMaxAgeDays = Number(value.maxAgeDays);
  return {
    label: rawLabel ? rawLabel.slice(0, 120) : mode === "releases" ? "New releases" : "Latest news",
    mode,
    maxItems: Number.isFinite(rawMaxItems) ? Math.max(1, Math.min(20, Math.round(rawMaxItems))) : 6,
    maxAgeDays: Number.isFinite(rawMaxAgeDays) ? Math.max(0, Math.min(3_650, Math.round(rawMaxAgeDays))) : mode === "releases" ? 180 : 30,
    showImages: value.showImages !== false,
  };
}

export function normalizeFeedReaderUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Feed URL is not configured.");
  if (trimmed.length > 4_096) throw new Error("Feed URL is too long.");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Feed URL is invalid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Feed URL must use http:// or https://.");
  }
  if (url.username || url.password) throw new Error("Do not include embedded credentials in the feed URL.");
  return url.toString();
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, key: string) => {
    if (key[0] === "#") {
      const hexadecimal = key[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      try {
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
      } catch {
        return entity;
      }
    }
    return named[key.toLowerCase()] ?? entity;
  });
}

function cleanText(value: string, maxLength: number): string {
  let decoded = value.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, "");
  decoded = decodeEntities(decodeEntities(decoded));
  return decodeEntities(decoded
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function elementBody(source: string, names: string[]): string {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}\\s*>`, "i").exec(source);
    if (match) return match[1];
  }
  return "";
}

function attribute(source: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(source);
  return decodeEntities(match?.[1] ?? match?.[2] ?? "").trim();
}

function safeHttpUrl(value: string): string | undefined {
  if (!value.trim()) return undefined;
  try {
    const url = new URL(decodeEntities(value.trim()));
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return undefined;
    return url.toString().slice(0, 2_048);
  } catch {
    return undefined;
  }
}

function atomLink(source: string, relation = "alternate"): string | undefined {
  const links = [...source.matchAll(/<link\b([^>]*)\/?\s*>/gi)];
  const preferred = links.find((match) => {
    const rel = attribute(match[1], "rel").toLowerCase();
    return relation === "alternate" ? !rel || rel === "alternate" : rel === relation;
  });
  return safeHttpUrl(attribute((preferred ?? links[0])?.[1] ?? "", "href"));
}

function rssLink(source: string): string | undefined {
  return safeHttpUrl(cleanText(elementBody(source, ["link"]), 2_048));
}

function entryImage(source: string, summaryHtml: string): string | undefined {
  const candidates = [
    ...source.matchAll(/<(?:media:content|media:thumbnail|enclosure)\b([^>]*)\/?\s*>/gi),
  ];
  for (const candidate of candidates) {
    const type = attribute(candidate[1], "type").toLowerCase();
    const medium = attribute(candidate[1], "medium").toLowerCase();
    if (type && !type.startsWith("image/") && medium !== "image") continue;
    const url = safeHttpUrl(attribute(candidate[1], "url"));
    if (url) return url;
  }
  const image = /<img\b([^>]*)>/i.exec(summaryHtml);
  return image ? safeHttpUrl(attribute(image[1], "src")) : undefined;
}

function parsedDate(value: string): string | undefined {
  const text = cleanText(value, 200);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function versionFromTitle(title: string): string | undefined {
  const match = /(?:^|\s|release[-_: ]+)(v?\d+(?:\.\d+){1,3}(?:[-+][0-9a-z.-]+)?)(?=$|\s|[,:;()\[\]])/i.exec(title);
  return match?.[1]?.slice(0, 80);
}

function blocks(source: string, tag: "item" | "entry"): string[] {
  return [...source.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi"))]
    .slice(0, MAX_SOURCE_ENTRIES + 1)
    .map((match) => match[1]);
}

function parseEntry(source: string, sourceIndex: number, atom: boolean, showImages: boolean): ParsedEntry | undefined {
  const title = cleanText(elementBody(source, ["title"]), 240) || "Untitled item";
  const summaryHtml = elementBody(source, atom ? ["summary", "content"] : ["description", "content:encoded"]);
  const summary = cleanText(summaryHtml, 360);
  const url = atom ? atomLink(source) : rssLink(source);
  const rawId = cleanText(elementBody(source, atom ? ["id"] : ["guid"]), 500);
  const publishedAt = parsedDate(elementBody(source, atom
    ? ["published", "updated"]
    : ["pubDate", "dc:date", "date"]));
  const authorSource = atom ? elementBody(elementBody(source, ["author"]), ["name"]) : elementBody(source, ["dc:creator", "author"]);
  const author = cleanText(authorSource, 120);
  const id = (rawId || url || `${title}:${publishedAt ?? sourceIndex}`).slice(0, 500);
  const imageUrl = showImages ? entryImage(source, summaryHtml) : undefined;
  const version = versionFromTitle(title);
  return {
    id,
    title,
    summary,
    ...(url ? { url } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    author,
    ...(publishedAt ? { publishedAt } : {}),
    ...(version ? { version } : {}),
    sourceIndex,
  };
}

export function parseFeedReader(
  source: string,
  rawConfig: Record<string, unknown>,
  now = new Date(),
): FeedReaderResponse {
  const config = normalizeFeedReaderConfig(rawConfig);
  const isAtom = /<feed\b[^>]*xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(source)
    || /<feed\b[^>]*>/i.test(source) && /<entry\b/i.test(source);
  const isRss = /<(?:rss|rdf:RDF)\b/i.test(source) && /<item\b/i.test(source);
  if (!isAtom && !isRss) throw new Error("Feed is not valid RSS or Atom data.");

  const sourceEntries = blocks(source, isAtom ? "entry" : "item");
  if (sourceEntries.length > MAX_SOURCE_ENTRIES) throw new Error("Feed contains too many items.");
  const entries = sourceEntries.flatMap((entry, index) => {
    const parsed = parseEntry(entry, index, isAtom, config.showImages);
    return parsed ? [parsed] : [];
  });
  const cutoff = config.maxAgeDays > 0 ? now.getTime() - config.maxAgeDays * 24 * 60 * 60 * 1_000 : Number.NEGATIVE_INFINITY;
  const filtered = entries
    .filter((entry) => !entry.publishedAt || new Date(entry.publishedAt).getTime() >= cutoff)
    .sort((left, right) => {
      const leftTime = left.publishedAt ? new Date(left.publishedAt).getTime() : Number.NEGATIVE_INFINITY;
      const rightTime = right.publishedAt ? new Date(right.publishedAt).getTime() : Number.NEGATIVE_INFINITY;
      return rightTime - leftTime || left.sourceIndex - right.sourceIndex;
    });
  const unique = [...new Map(filtered.map((entry) => [entry.id, entry])).values()];
  const root = isAtom ? source.replace(/<entry\b[\s\S]*$/i, "") : elementBody(source, ["channel"]);
  const feedTitle = cleanText(elementBody(root, ["title"]), 160);
  const homeUrl = isAtom ? atomLink(root) : rssLink(root);
  return {
    label: config.label,
    mode: config.mode,
    feedTitle,
    ...(homeUrl ? { homeUrl } : {}),
    items: unique.slice(0, config.maxItems).map(({ sourceIndex: _sourceIndex, ...entry }) => entry),
    hasMore: unique.length > config.maxItems,
    updatedAt: new Date().toISOString(),
  };
}

async function boundedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Feed returned too much data.");
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Feed returned too much data.");
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Feed returned too much data.");
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

export async function fetchFeedReader(
  widgetId: string,
  rawConfig: Record<string, unknown>,
  credentials: FeedReaderCredentials,
  force = false,
): Promise<FeedReaderResponse> {
  const feedUrl = normalizeFeedReaderUrl(credentials.feedUrl);
  const config = normalizeFeedReaderConfig(rawConfig);
  const cacheKey = `${widgetId}\u0000${feedUrl}\u0000${JSON.stringify(config)}`;
  const cached = cache.get(cacheKey);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;
  let response: Response;
  try {
    response = await fetch(feedUrl, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: "application/atom+xml, application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1",
        "User-Agent": "Dashcenter feed-reader",
      },
    });
  } catch {
    throw new Error("Could not reach the feed.");
  }
  if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}.`);
  const value = parseFeedReader(await boundedText(response), { ...config });
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

export async function testFeedReaderConnection(
  widgetId: string,
  rawConfig: Record<string, unknown>,
  credentials: FeedReaderCredentials,
) {
  const payload = await fetchFeedReader(widgetId, rawConfig, credentials, true);
  return {
    ok: true,
    feedTitle: payload.feedTitle,
    items: payload.items.length,
    hasMore: payload.hasMore,
  };
}

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DashboardData } from "../shared/types.js";
import {
  fetchFeedReader,
  normalizeFeedReaderConfig,
  normalizeFeedReaderUrl,
  parseFeedReader,
} from "./feed-reader.js";
import { createDatabase } from "./database.js";
import { buildApp } from "./index.js";

const rssSource = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Dashcenter Journal</title>
    <link>https://news.example/</link>
    <item>
      <guid>story-1</guid>
      <title>Dashboard &amp; widgets</title>
      <link>https://news.example/dashboard</link>
      <pubDate>Sat, 12 Sep 2026 10:00:00 GMT</pubDate>
      <dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">Dashcenter team</dc:creator>
      <description><![CDATA[<p>A <strong>calmer</strong> dashboard.</p><script>bad()</script>]]></description>
      <media:thumbnail url="https://images.example/dashboard.jpg" />
    </item>
    <item>
      <guid>story-2</guid>
      <title>Older story</title>
      <pubDate>Tue, 01 Sep 2026 10:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const atomSource = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Dashcenter releases</title>
  <link href="https://github.com/example/project/releases" />
  <entry>
    <id>tag:github.com,2026:Release/24</id>
    <title>Release v2.4.1</title>
    <link rel="alternate" href="https://github.com/example/project/releases/tag/v2.4.1" />
    <updated>2026-09-12T11:30:00Z</updated>
    <author><name>Release bot</name></author>
    <content type="html">&lt;p&gt;Fixes &amp;amp; improvements&lt;/p&gt;</content>
  </entry>
</feed>`;

test("feed reader parses and sanitizes RSS articles", () => {
  const result = parseFeedReader(rssSource, {
    label: "Reading list",
    mode: "articles",
    maxItems: 5,
    maxAgeDays: 7,
    showImages: true,
  }, new Date("2026-09-12T12:00:00.000Z"));

  assert.equal(result.label, "Reading list");
  assert.equal(result.feedTitle, "Dashcenter Journal");
  assert.equal(result.homeUrl, "https://news.example/");
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0], {
    id: "story-1",
    title: "Dashboard & widgets",
    summary: "A calmer dashboard.",
    url: "https://news.example/dashboard",
    imageUrl: "https://images.example/dashboard.jpg",
    author: "Dashcenter team",
    publishedAt: "2026-09-12T10:00:00.000Z",
  });
  assert.doesNotMatch(JSON.stringify(result), /script|bad\(\)/i);
});

test("feed reader parses Atom releases and detects the version", () => {
  const result = parseFeedReader(atomSource, {
    mode: "releases",
    maxItems: 8,
    maxAgeDays: 365,
    showImages: false,
  }, new Date("2026-09-12T12:00:00.000Z"));

  assert.equal(result.label, "New releases");
  assert.equal(result.mode, "releases");
  assert.equal(result.feedTitle, "Dashcenter releases");
  assert.equal(result.items[0].version, "v2.4.1");
  assert.equal(result.items[0].author, "Release bot");
  assert.equal(result.items[0].summary, "Fixes & improvements");
  assert.equal(result.items[0].url, "https://github.com/example/project/releases/tag/v2.4.1");
});

test("feed reader clamps settings and rejects unsafe source URLs", () => {
  assert.deepEqual(normalizeFeedReaderConfig({ mode: "releases", maxItems: 99, maxAgeDays: -5 }), {
    label: "New releases",
    mode: "releases",
    maxItems: 20,
    maxAgeDays: 0,
    showImages: true,
  });
  assert.equal(normalizeFeedReaderUrl("https://feeds.example/releases.atom?token=secret"), "https://feeds.example/releases.atom?token=secret");
  assert.throws(() => normalizeFeedReaderUrl("file:///etc/passwd"), /http:\/\/ or https:\/\//);
  assert.throws(() => normalizeFeedReaderUrl("https://user:password@feeds.example/rss"), /embedded credentials/);
  assert.throws(() => parseFeedReader("<html>not a feed</html>", {}), /not valid RSS or Atom/);
});

test("feed reader rejects oversized responses without exposing the private URL", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("oversized", {
    status: 200,
    headers: { "Content-Length": String(2 * 1024 * 1024 + 1) },
  });
  try {
    const privateUrl = "https://feeds.example/private.xml?token=never-show-this";
    await assert.rejects(
      () => fetchFeedReader("oversized", {}, { feedUrl: privateUrl }, true),
      (error: Error) => {
        assert.match(error.message, /returned too much data/);
        assert.doesNotMatch(error.message, /never-show-this|private\.xml/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("feed reader keeps its source URL server-side", async () => {
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  const originalFetch = globalThis.fetch;
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-feed-reader-"));
  const database = createDatabase(":memory:");
  process.env.DEV_BYPASS_AUTH = "1";
  const requestedUrls: string[] = [];
  globalThis.fetch = async (input) => {
    requestedUrls.push(String(input));
    return new Response(atomSource, { status: 200, headers: { "Content-Type": "application/atom+xml" } });
  };
  const app = await buildApp({
    database,
    dataDirectory,
    serveFrontend: false,
    logger: false,
    healthRefreshIntervalMs: false,
  });

  try {
    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/widgets",
      payload: {
        type: "feed-reader",
        enabled: true,
        config: { label: "Project releases", mode: "releases", maxItems: 8, maxAgeDays: 365, showImages: false },
      },
    });
    assert.equal(createdResponse.statusCode, 200);
    const widget = createdResponse.json<DashboardData>().widgets.find((item) => item.type === "feed-reader");
    assert.ok(widget);

    const feedUrl = "https://feeds.example/private/releases.atom?token=server-only-secret";
    const saved = await app.inject({
      method: "PUT",
      url: `/api/widgets/${widget.id}/credentials`,
      payload: { feedUrl },
    });
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(saved.json(), { feedConfigured: true, sources: [{ id: "legacy", name: "feeds.example" }] });

    const credentials = await app.inject({ method: "GET", url: `/api/widgets/${widget.id}/credentials` });
    assert.deepEqual(credentials.json(), { feedConfigured: true, sources: [{ id: "legacy", name: "feeds.example" }] });
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    assert.doesNotMatch(dashboard.body, /server-only-secret|private\/releases\.atom/);

    const feed = await app.inject({ method: "GET", url: `/api/widgets/feed-reader/${widget.id}` });
    assert.equal(feed.statusCode, 200);
    assert.equal(feed.json<{ label: string }>().label, "Project releases");
    assert.doesNotMatch(feed.body, /server-only-secret|private\/releases\.atom/);
    assert.deepEqual(requestedUrls, [feedUrl]);
  } finally {
    await app.close();
    database.close();
    globalThis.fetch = originalFetch;
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

test("multiple feed sources stay server-side and merge dated items with source names", async () => {
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  const originalFetch = globalThis.fetch;
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-multifeed-"));
  const database = createDatabase(":memory:");
  process.env.DEV_BYPASS_AUTH = "1";
  const firstUrl = "https://feeds.example/first.xml?token=first-secret";
  const secondUrl = "https://feeds.example/second.xml?token=second-secret";
  const rss = (title: string, date: string) => `<rss><channel><title>${title}</title><item><guid>${title}</guid><title>${title}</title><pubDate>${date}</pubDate></item></channel></rss>`;
  globalThis.fetch = async (input) => new Response(
    String(input) === firstUrl ? rss("Older", "Sat, 12 Sep 2026 10:00:00 GMT") : rss("Newer", "Sun, 13 Sep 2026 10:00:00 GMT"),
    { status: 200 },
  );
  const app = await buildApp({ database, dataDirectory, serveFrontend: false, logger: false, healthRefreshIntervalMs: false });
  try {
    const created = await app.inject({ method: "POST", url: "/api/widgets", payload: { type: "feed-reader", config: { maxAgeDays: 0 } } });
    const id = created.json<DashboardData>().widgets.find((widget) => widget.type === "feed-reader")?.id;
    assert.ok(id);
    const endpoint = `/api/widgets/${id}/credentials`;
    assert.equal((await app.inject({ method: "PUT", url: endpoint, payload: { add: { name: "First source", feedUrl: firstUrl } } })).statusCode, 200);
    const saved = await app.inject({ method: "PUT", url: endpoint, payload: { add: { name: "Second source", feedUrl: secondUrl } } });
    assert.equal(saved.statusCode, 200);
    const sources = saved.json<{ sources: Array<{ id: string; name: string }> }>().sources;
    assert.deepEqual(sources.map((source) => source.name), ["First source", "Second source"]);
    assert.doesNotMatch(saved.body, /first-secret|second-secret/);
    assert.doesNotMatch((await app.inject({ method: "GET", url: "/api/dashboard" })).body, /first-secret|second-secret/);
    const feed = await app.inject({ method: "GET", url: `/api/widgets/feed-reader/${id}` });
    assert.equal(feed.statusCode, 200);
    const items = feed.json<{ items: Array<{ title: string; sourceName: string }> }>().items;
    assert.deepEqual(items.map((item) => [item.title, item.sourceName]), [["Newer", "Second source"], ["Older", "First source"]]);
    assert.doesNotMatch(feed.body, /first-secret|second-secret/);
    const removed = await app.inject({ method: "PUT", url: endpoint, payload: { removeId: sources[0].id } });
    assert.equal(removed.json<{ sources: unknown[] }>().sources.length, 1);
  } finally {
    await app.close();
    database.close();
    globalThis.fetch = originalFetch;
    rmSync(dataDirectory, { recursive: true, force: true });
    if (previousBypass === undefined) delete process.env.DEV_BYPASS_AUTH;
    else process.env.DEV_BYPASS_AUTH = previousBypass;
  }
});

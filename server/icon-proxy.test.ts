import assert from "node:assert/strict";
import test from "node:test";
import { clearSvgIconCache, loadPinnedSvgIcon, normalizeSvgIconName } from "./icon-proxy.js";

test("SVG icon proxy validates names before making a request", async () => {
  assert.equal(normalizeSvgIconName("Server.svg"), "server");
  assert.throws(() => normalizeSvgIconName("../server"), /Invalid icon name/);

  let requests = 0;
  await assert.rejects(
    loadPinnedSvgIcon("mdi", "../server", async () => {
      requests += 1;
      return new Response();
    }),
    /Invalid icon name/,
  );
  assert.equal(requests, 0);
});

test("SVG icon proxy retries its pinned source and caches a safe response", async () => {
  clearSvgIconCache();
  const requested: string[] = [];
  const request = async (url: string | URL | Request) => {
    requested.push(String(url));
    return requested.length === 1
      ? new Response("Unavailable", { status: 503 })
      : new Response('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h24v24H0z"/></svg>');
  };

  const first = await loadPinnedSvgIcon("mdi", "server", request as typeof fetch);
  const second = await loadPinnedSvgIcon("mdi", "server", request as typeof fetch);
  assert.match(first, /<svg/);
  assert.equal(second, first);
  assert.equal(requested.length, 2);
  assert.match(requested[0], /cdn\.jsdelivr\.net/);
  assert.match(requested[1], /unpkg\.com/);
});

test("SVG icon proxy rejects active or externally linked SVG content", async () => {
  clearSvgIconCache();
  const unsafe = async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  await assert.rejects(loadPinnedSvgIcon("si", "github", unsafe as typeof fetch), /safe SVG/);

  clearSvgIconCache();
  const linked = async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"><style>@import "https://example.com/x.css"</style><path d="M0 0"/></svg>');
  await assert.rejects(loadPinnedSvgIcon("si", "github", linked as typeof fetch), /safe SVG/);

  clearSvgIconCache();
  const embedded = async () => new Response('<html><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg></html>');
  await assert.rejects(loadPinnedSvgIcon("si", "github", embedded as typeof fetch), /safe SVG/);
});

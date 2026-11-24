import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedText } from "./bounded-response.js";

test("the response reader cancels a stream when consumed bytes exceed its limit", async () => {
  let cancelled = false;
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("hello"));
      controller.enqueue(encoder.encode(" world"));
    },
    cancel() { cancelled = true; },
  });
  const response = new Response(body);
  await assert.rejects(readBoundedText(response, 10, "Response exceeds the limit"), /exceeds the limit/);
  assert.equal(cancelled, true);
});

test("the response reader decodes UTF-8 split across chunks", async () => {
  const bytes = new TextEncoder().encode("Žilina");
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 1));
      controller.enqueue(bytes.slice(1));
      controller.close();
    },
  });
  assert.equal(await readBoundedText(new Response(body), bytes.byteLength, "Response exceeds the limit"), "Žilina");
});

import assert from "node:assert/strict";
import test from "node:test";
import { createClientId } from "../shared/id.js";

test("client IDs prefer randomUUID when it is available", () => {
  const id = createClientId("service", {
    randomUUID: () => "123e4567-e89b-42d3-a456-426614174000",
  });

  assert.equal(id, "service-123e4567-e89b-42d3-a456-426614174000");
});

test("client IDs use getRandomValues when randomUUID is unavailable over HTTP", () => {
  const id = createClientId("docker", {
    getRandomValues(values) {
      values.forEach((_, index) => { values[index] = index; });
      return values;
    },
  });

  assert.equal(id, "docker-00010203-0405-4607-8809-0a0b0c0d0e0f");
});

test("client IDs remain unique and valid when browser crypto is unavailable", () => {
  const first = createClientId("group", null);
  const second = createClientId("group", null);

  assert.notEqual(first, second);
  assert.match(first, /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
  assert.match(second, /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
});

test("client IDs fall back when browser crypto methods throw", () => {
  const id = createClientId("service", {
    randomUUID() {
      throw new Error("randomUUID is blocked");
    },
    getRandomValues() {
      throw new Error("getRandomValues is blocked");
    },
  });

  assert.match(id, /^service-[a-z0-9-]+$/);
});

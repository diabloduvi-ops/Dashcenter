import assert from "node:assert/strict";
import test from "node:test";
import { createClockFormatter, normalizeClockFormat } from "../shared/clock.js";

const AFTERNOON = new Date(2026, 7, 20, 16, 5);

test("24-hour clock never includes an AM or PM marker", () => {
  const formatted = createClockFormatter("en-US", "24h").format(AFTERNOON);
  assert.match(formatted, /16[.:]05/);
  assert.doesNotMatch(formatted, /\b(?:am|pm)\b/i);
});

test("12-hour clock includes the expected period marker", () => {
  const formatted = createClockFormatter("en-US", "12h").format(AFTERNOON);
  assert.match(formatted, /04?[.:]05/);
  assert.match(formatted, /\bpm\b/i);
});

test("clock format falls back safely to 24-hour time", () => {
  assert.equal(normalizeClockFormat("12h"), "12h");
  assert.equal(normalizeClockFormat("h12"), "12h");
  assert.equal(normalizeClockFormat("24h"), "24h");
  assert.equal(normalizeClockFormat(undefined), "24h");
  assert.equal(normalizeClockFormat("unexpected"), "24h");
});

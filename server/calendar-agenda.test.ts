import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DashboardData } from "../shared/types.js";
import {
  normalizeCalendarAgendaConfig,
  normalizeCalendarFeedUrl,
  parseCalendarAgenda,
} from "./calendar-agenda.js";
import { createDatabase } from "./database.js";
import { buildApp } from "./index.js";

const calendarSource = `BEGIN:VCALENDAR\r
VERSION:2.0\r
X-WR-CALNAME:Team calendar\r
BEGIN:VEVENT\r
UID:planning\r
DTSTART;TZID=Europe/Bratislava:20260912T100000\r
DTEND;TZID=Europe/Bratislava:20260912T110000\r
SUMMARY:Release \r
 planning\r
LOCATION:Meeting\\, room\r
URL:https://calendar.example/events/planning\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:daily\r
DTSTART:20260913T080000Z\r
DTEND:20260913T083000Z\r
RRULE:FREQ=DAILY;COUNT=3\r
EXDATE:20260914T080000Z\r
SUMMARY:Daily sync\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:holiday\r
DTSTART;VALUE=DATE:20260914\r
DTEND;VALUE=DATE:20260915\r
SUMMARY:Launch day\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:cancelled\r
DTSTART:20260912T090000Z\r
STATUS:CANCELLED\r
SUMMARY:Cancelled meeting\r
END:VEVENT\r
END:VCALENDAR`;

test("calendar agenda parses iCalendar dates, folded text, exclusions and common recurrence", () => {
  const result = parseCalendarAgenda(
    calendarSource,
    { label: "Work", daysAhead: 7, maxEvents: 10 },
    new Date("2026-09-12T07:30:00.000Z"),
  );

  assert.equal(result.label, "Work");
  assert.equal(result.calendarName, "Team calendar");
  assert.equal(result.events.length, 4);
  assert.deepEqual(result.events.map((event) => event.title), [
    "Release planning",
    "Daily sync",
    "Launch day",
    "Daily sync",
  ]);
  assert.equal(result.events[0].start, "2026-09-12T08:00:00.000Z");
  assert.equal(result.events[0].location, "Meeting, room");
  assert.equal(result.events[0].url, "https://calendar.example/events/planning");
  assert.equal(result.events[2].allDay, true);
  assert.equal(result.events.some((event) => event.start === "2026-09-14T08:00:00.000Z"), false);
  assert.equal(result.hasMore, false);
});

test("calendar agenda clamps presentation settings and accepts only credential-free HTTP feed URLs", () => {
  assert.deepEqual(normalizeCalendarAgendaConfig({ label: "", daysAhead: 999, maxEvents: 0 }), {
    label: "Agenda",
    daysAhead: 90,
    maxEvents: 1,
  });
  assert.equal(normalizeCalendarFeedUrl("https://calendar.example/private.ics?token=secret"), "https://calendar.example/private.ics?token=secret");
  assert.throws(() => normalizeCalendarFeedUrl("webcal://calendar.example/private.ics"), /http:\/\/ or https:\/\//);
  assert.throws(() => normalizeCalendarFeedUrl("https://user:password@calendar.example/private.ics"), /embedded credentials/);
});

test("recurring events keep their local wall-clock time across daylight-saving changes", () => {
  const source = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:daily-local\nDTSTART;TZID=Europe/Bratislava:20261024T090000\nDTEND;TZID=Europe/Bratislava:20261024T093000\nRRULE:FREQ=DAILY;COUNT=3\nSUMMARY:Morning sync\nEND:VEVENT\nEND:VCALENDAR`;
  const result = parseCalendarAgenda(source, { daysAhead: 7, maxEvents: 10 }, new Date("2026-10-23T00:00:00.000Z"));
  assert.deepEqual(result.events.map((event) => event.start), [
    "2026-10-24T07:00:00.000Z",
    "2026-10-25T08:00:00.000Z",
    "2026-10-26T08:00:00.000Z",
  ]);
});

test("calendar widget keeps its feed URL server-side and serves only parsed agenda data", async () => {
  const previousBypass = process.env.DEV_BYPASS_AUTH;
  const originalFetch = globalThis.fetch;
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "dashcenter-calendar-widget-"));
  const database = createDatabase(":memory:");
  process.env.DEV_BYPASS_AUTH = "1";
  const requestedUrls: string[] = [];
  globalThis.fetch = async (input) => {
    requestedUrls.push(String(input));
    return new Response(calendarSource, { status: 200, headers: { "Content-Type": "text/calendar" } });
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
        type: "calendar-agenda",
        enabled: true,
        config: { label: "Private agenda", daysAhead: 30, maxEvents: 8 },
      },
    });
    assert.equal(createdResponse.statusCode, 200);
    const widget = createdResponse.json<DashboardData>().widgets.find((item) => item.type === "calendar-agenda");
    assert.ok(widget);

    const feedUrl = "https://calendar.example/private/calendar.ics?token=server-only-secret";
    const saved = await app.inject({
      method: "PUT",
      url: `/api/widgets/${widget.id}/credentials`,
      payload: { feedUrl },
    });
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(saved.json(), { feedConfigured: true });

    const credentials = await app.inject({ method: "GET", url: `/api/widgets/${widget.id}/credentials` });
    assert.deepEqual(credentials.json(), { feedConfigured: true });
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    assert.doesNotMatch(dashboard.body, /server-only-secret|private\/calendar\.ics/);

    const agenda = await app.inject({ method: "GET", url: `/api/widgets/calendar-agenda/${widget.id}` });
    assert.equal(agenda.statusCode, 200);
    assert.equal(agenda.json<{ label: string }>().label, "Private agenda");
    assert.doesNotMatch(agenda.body, /server-only-secret|private\/calendar\.ics/);
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

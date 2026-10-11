const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CACHE_TTL_MS = 60_000;
const MAX_SOURCE_EVENTS = 5_000;
const MAX_RECURRENCE_STEPS = 50_000;

export interface CalendarAgendaConfig {
  label: string;
  daysAhead: number;
  maxEvents: number;
}

export interface CalendarAgendaCredentials {
  feedUrl: string;
}

export interface CalendarAgendaEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  url?: string;
}

export interface CalendarAgendaResponse {
  label: string;
  calendarName: string;
  rangeStart: string;
  rangeEnd: string;
  events: CalendarAgendaEvent[];
  hasMore: boolean;
  updatedAt: string;
}

interface CalendarDate {
  date: Date;
  allDay: boolean;
  timeZone?: string;
}

interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface SourceEvent {
  uid: string;
  title: string;
  location: string;
  url?: string;
  start: CalendarDate;
  end: CalendarDate;
  recurrenceId?: CalendarDate;
  rrule?: string;
  rdates: CalendarDate[];
  exdates: CalendarDate[];
  cancelled: boolean;
}

const cache = new Map<string, { expiresAt: number; value: CalendarAgendaResponse }>();

export function normalizeCalendarAgendaConfig(value: Record<string, unknown>): CalendarAgendaConfig {
  const rawLabel = typeof value.label === "string" ? value.label.trim() : "";
  const rawDaysAhead = Number(value.daysAhead);
  const rawMaxEvents = Number(value.maxEvents);
  return {
    label: rawLabel ? rawLabel.slice(0, 120) : "Agenda",
    daysAhead: Number.isFinite(rawDaysAhead) ? Math.max(1, Math.min(90, Math.round(rawDaysAhead))) : 14,
    maxEvents: Number.isFinite(rawMaxEvents) ? Math.max(1, Math.min(20, Math.round(rawMaxEvents))) : 8,
  };
}

export function normalizeCalendarFeedUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Calendar feed URL is not configured.");
  if (trimmed.length > 4_096) throw new Error("Calendar feed URL is too long.");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Calendar feed URL is invalid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Calendar feed URL must use http:// or https://.");
  }
  if (url.username || url.password) throw new Error("Do not include embedded credentials in the calendar feed URL.");
  return url.toString();
}

function parseContentLine(line: string): ContentLine | undefined {
  const separator = line.indexOf(":");
  if (separator < 1) return undefined;
  const [rawName, ...rawParams] = line.slice(0, separator).split(";");
  const params: Record<string, string> = {};
  for (const rawParam of rawParams) {
    const equals = rawParam.indexOf("=");
    if (equals < 1) continue;
    const key = rawParam.slice(0, equals).trim().toUpperCase();
    const paramValue = rawParam.slice(equals + 1).trim().replace(/^"|"$/g, "");
    if (key) params[key] = paramValue;
  }
  return { name: rawName.trim().toUpperCase(), params, value: line.slice(separator + 1) };
}

function unescapeText(value: string): string {
  return value
    .replace(/\\[nN]/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function partsInTimeZone(date: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.flatMap((part) => {
    const number = Number(part.value);
    return Number.isFinite(number) ? [[part.type, number]] : [];
  }));
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const desired = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = desired;
  for (let index = 0; index < 3; index += 1) {
    const parts = partsInTimeZone(new Date(guess), timeZone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const correction = desired - represented;
    guess += correction;
    if (correction === 0) break;
  }
  return new Date(guess);
}

function parseCalendarDate(value: string, params: Record<string, string>): CalendarDate | undefined {
  const raw = value.trim();
  const isDate = params.VALUE?.toUpperCase() === "DATE" || /^\d{8}$/.test(raw);
  if (isDate) {
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
    if (!match) return undefined;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return Number.isNaN(date.getTime()) ? undefined : { date, allDay: true, timeZone: "UTC" };
  }

  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(raw);
  if (!match) return undefined;
  const values = match.slice(1, 7).map(Number);
  let date: Date;
  try {
    if (match[7]) {
      date = new Date(Date.UTC(values[0], values[1] - 1, values[2], values[3], values[4], values[5]));
    } else if (params.TZID) {
      date = zonedTimeToUtc(values[0], values[1], values[2], values[3], values[4], values[5], params.TZID);
    } else {
      date = new Date(values[0], values[1] - 1, values[2], values[3], values[4], values[5]);
    }
  } catch {
    return undefined;
  }
  return Number.isNaN(date.getTime())
    ? undefined
    : { date, allDay: false, ...(match[7] ? { timeZone: "UTC" } : params.TZID ? { timeZone: params.TZID } : {}) };
}

function parseDuration(value: string): number | undefined {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!match) return undefined;
  const [weeks, days, hours, minutes, seconds] = match.slice(1).map((item) => Number(item || 0));
  return (((weeks * 7 + days) * 24 + hours) * 60 * 60 + minutes * 60 + seconds) * 1_000;
}

function safeEventUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return undefined;
    return url.toString().slice(0, 2_048);
  } catch {
    return undefined;
  }
}

function parseSourceEvent(lines: ContentLine[], index: number): SourceEvent | undefined {
  const get = (name: string) => lines.find((line) => line.name === name);
  const getAll = (name: string) => lines.filter((line) => line.name === name);
  const startLine = get("DTSTART");
  if (!startLine) return undefined;
  const start = parseCalendarDate(startLine.value, startLine.params);
  if (!start) return undefined;
  const endLine = get("DTEND");
  const durationLine = get("DURATION");
  const parsedEnd = endLine ? parseCalendarDate(endLine.value, endLine.params) : undefined;
  const duration = durationLine ? parseDuration(durationLine.value) : undefined;
  const defaultDuration = start.allDay ? 24 * 60 * 60 * 1_000 : 60 * 60 * 1_000;
  const endDate = parsedEnd?.date ?? new Date(start.date.getTime() + (duration || defaultDuration));
  const end = endDate.getTime() > start.date.getTime()
    ? { date: endDate, allDay: parsedEnd?.allDay ?? start.allDay }
    : { date: new Date(start.date.getTime() + defaultDuration), allDay: start.allDay };
  const recurrenceLine = get("RECURRENCE-ID");
  const parseDateList = (name: string) => getAll(name).flatMap((line) => line.value.split(",").flatMap((item) => {
    const parsed = parseCalendarDate(item, line.params);
    return parsed ? [parsed] : [];
  }));
  return {
    uid: unescapeText(get("UID")?.value ?? `calendar-event-${index}`).slice(0, 500),
    title: unescapeText(get("SUMMARY")?.value ?? "Untitled event").slice(0, 500),
    location: unescapeText(get("LOCATION")?.value ?? "").slice(0, 500),
    url: safeEventUrl(unescapeText(get("URL")?.value ?? "")),
    start,
    end,
    recurrenceId: recurrenceLine ? parseCalendarDate(recurrenceLine.value, recurrenceLine.params) : undefined,
    rrule: get("RRULE")?.value,
    rdates: parseDateList("RDATE"),
    exdates: parseDateList("EXDATE"),
    cancelled: get("STATUS")?.value.trim().toUpperCase() === "CANCELLED",
  };
}

function addMonths(start: Date, amount: number): Date | undefined {
  const result = new Date(start);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + amount);
  const expectedMonth = result.getUTCMonth();
  result.setUTCDate(originalDay);
  return result.getUTCMonth() === expectedMonth ? result : undefined;
}

function addYears(start: Date, amount: number): Date | undefined {
  const result = new Date(start);
  const originalMonth = result.getUTCMonth();
  result.setUTCFullYear(result.getUTCFullYear() + amount);
  return result.getUTCMonth() === originalMonth ? result : undefined;
}

interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockParts(value: CalendarDate): WallClockParts {
  if (value.timeZone && value.timeZone !== "UTC") {
    const parts = partsInTimeZone(value.date, value.timeZone);
    return {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
    };
  }
  if (value.timeZone === "UTC" || value.allDay) {
    return {
      year: value.date.getUTCFullYear(),
      month: value.date.getUTCMonth() + 1,
      day: value.date.getUTCDate(),
      hour: value.date.getUTCHours(),
      minute: value.date.getUTCMinutes(),
      second: value.date.getUTCSeconds(),
    };
  }
  return {
    year: value.date.getFullYear(),
    month: value.date.getMonth() + 1,
    day: value.date.getDate(),
    hour: value.date.getHours(),
    minute: value.date.getMinutes(),
    second: value.date.getSeconds(),
  };
}

function wallClockDate(parts: WallClockParts, source: CalendarDate): Date {
  if (source.timeZone && source.timeZone !== "UTC") {
    return zonedTimeToUtc(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second, source.timeZone);
  }
  if (source.timeZone === "UTC" || source.allDay) {
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  }
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function wallClockTemplate(value: CalendarDate): Date {
  const parts = wallClockParts(value);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
}

function recurrenceCandidate(event: SourceEvent, frequency: string, amount: number): Date | undefined {
  const template = wallClockTemplate(event.start);
  let candidate: Date | undefined;
  if (frequency === "DAILY") {
    candidate = new Date(template);
    candidate.setUTCDate(candidate.getUTCDate() + amount);
  }
  if (frequency === "WEEKLY") {
    candidate = new Date(template);
    candidate.setUTCDate(candidate.getUTCDate() + amount * 7);
  }
  if (frequency === "MONTHLY") candidate = addMonths(template, amount);
  if (frequency === "YEARLY") candidate = addYears(template, amount);
  if (!candidate) return undefined;
  return wallClockDate({
    year: candidate.getUTCFullYear(),
    month: candidate.getUTCMonth() + 1,
    day: candidate.getUTCDate(),
    hour: candidate.getUTCHours(),
    minute: candidate.getUTCMinutes(),
    second: candidate.getUTCSeconds(),
  }, event.start);
}

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function recurrenceDates(event: SourceEvent, rangeEnd: Date): Date[] {
  if (!event.rrule) return [event.start.date];
  const rule = Object.fromEntries(event.rrule.split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    return separator > 0 ? [[part.slice(0, separator).toUpperCase(), part.slice(separator + 1)]] : [];
  }));
  const frequency = rule.FREQ?.toUpperCase();
  if (!frequency || !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(frequency)) return [event.start.date];
  const interval = Math.max(1, Math.min(365, Math.round(Number(rule.INTERVAL) || 1)));
  const count = rule.COUNT ? Math.max(1, Math.min(MAX_RECURRENCE_STEPS, Math.round(Number(rule.COUNT) || 1))) : undefined;
  const until = rule.UNTIL ? parseCalendarDate(rule.UNTIL, {})?.date : undefined;
  const byDays = new Set((rule.BYDAY ?? "").split(",").map((day) => day.slice(-2).toUpperCase()).filter((day) => WEEKDAYS.includes(day)));
  const dates: Date[] = [];

  if (frequency === "WEEKLY" && byDays.size > 0) {
    const startTemplate = wallClockTemplate(event.start);
    const startDay = Date.UTC(startTemplate.getUTCFullYear(), startTemplate.getUTCMonth(), startTemplate.getUTCDate());
    const endTime = Math.min(rangeEnd.getTime(), until?.getTime() ?? Number.POSITIVE_INFINITY);
    for (let step = 0, emitted = 0; step < MAX_RECURRENCE_STEPS; step += 1) {
      const dayTime = startDay + step * 24 * 60 * 60 * 1_000;
      const candidateTemplate = new Date(dayTime);
      candidateTemplate.setUTCHours(
        startTemplate.getUTCHours(),
        startTemplate.getUTCMinutes(),
        startTemplate.getUTCSeconds(),
        0,
      );
      const candidate = wallClockDate({
        year: candidateTemplate.getUTCFullYear(),
        month: candidateTemplate.getUTCMonth() + 1,
        day: candidateTemplate.getUTCDate(),
        hour: candidateTemplate.getUTCHours(),
        minute: candidateTemplate.getUTCMinutes(),
        second: candidateTemplate.getUTCSeconds(),
      }, event.start);
      if (candidate.getTime() > endTime) break;
      const weekIndex = Math.floor(step / 7);
      if (weekIndex % interval !== 0 || !byDays.has(WEEKDAYS[candidateTemplate.getUTCDay()])) continue;
      if (candidate.getTime() < event.start.date.getTime()) continue;
      emitted += 1;
      if (!count || emitted <= count) dates.push(candidate);
      if (count && emitted >= count) break;
    }
    return dates;
  }

  for (let step = 0, emitted = 0; step < MAX_RECURRENCE_STEPS; step += 1) {
    const candidate = recurrenceCandidate(event, frequency, step * interval);
    if (!candidate) continue;
    if (until && candidate.getTime() > until.getTime()) break;
    if (candidate.getTime() >= rangeEnd.getTime()) break;
    if (byDays.size > 0 && !byDays.has(WEEKDAYS[candidate.getUTCDay()])) continue;
    emitted += 1;
    if (!count || emitted <= count) dates.push(candidate);
    if (count && emitted >= count) break;
  }
  return dates;
}

function eventOccurrence(event: SourceEvent, start: Date): CalendarAgendaEvent {
  const duration = Math.max(1, event.end.date.getTime() - event.start.date.getTime());
  return {
    id: `${event.uid}:${start.toISOString()}`,
    title: event.title,
    start: start.toISOString(),
    end: new Date(start.getTime() + duration).toISOString(),
    allDay: event.start.allDay,
    location: event.location,
    ...(event.url ? { url: event.url } : {}),
  };
}

export function parseCalendarAgenda(
  source: string,
  rawConfig: Record<string, unknown>,
  now = new Date(),
): CalendarAgendaResponse {
  const config = normalizeCalendarAgendaConfig(rawConfig);
  const unfolded = source.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);
  if (!lines.some((line) => line.trim().toUpperCase() === "BEGIN:VCALENDAR")) {
    throw new Error("Calendar feed is not valid iCalendar data.");
  }
  const calendarName = unescapeText(lines.map(parseContentLine).find((line) => line?.name === "X-WR-CALNAME")?.value ?? "").slice(0, 120);
  const sourceEvents: SourceEvent[] = [];
  let eventLines: ContentLine[] | undefined;
  for (const rawLine of lines) {
    const line = parseContentLine(rawLine);
    if (!line) continue;
    if (line.name === "BEGIN" && line.value.trim().toUpperCase() === "VEVENT") {
      eventLines = [];
      continue;
    }
    if (line.name === "END" && line.value.trim().toUpperCase() === "VEVENT") {
      if (eventLines) {
        const event = parseSourceEvent(eventLines, sourceEvents.length);
        if (event) sourceEvents.push(event);
      }
      eventLines = undefined;
      if (sourceEvents.length > MAX_SOURCE_EVENTS) throw new Error("Calendar feed contains too many events.");
      continue;
    }
    eventLines?.push(line);
  }

  const rangeStart = new Date(now);
  const rangeEnd = new Date(now.getTime() + config.daysAhead * 24 * 60 * 60 * 1_000);
  const overridden = new Set(sourceEvents.flatMap((event) => event.recurrenceId
    ? [`${event.uid}:${event.recurrenceId.date.toISOString()}`]
    : []));
  const excluded = new Set(sourceEvents.flatMap((event) => event.exdates.map((date) => `${event.uid}:${date.date.toISOString()}`)));
  const allEvents = sourceEvents.flatMap((event) => {
    if (event.cancelled) return [];
    const dates = event.recurrenceId
      ? [event.start.date]
      : [...recurrenceDates(event, rangeEnd), ...event.rdates.map((date) => date.date)];
    return dates.flatMap((date) => {
      const recurrenceKey = `${event.uid}:${date.toISOString()}`;
      if ((!event.recurrenceId && overridden.has(recurrenceKey)) || excluded.has(recurrenceKey)) return [];
      const occurrence = eventOccurrence(event, date);
      if (new Date(occurrence.end).getTime() <= rangeStart.getTime() || date.getTime() >= rangeEnd.getTime()) return [];
      return [occurrence];
    });
  });
  const unique = [...new Map(allEvents.map((event) => [event.id, event])).values()]
    .sort((left, right) => left.start.localeCompare(right.start) || left.title.localeCompare(right.title));

  return {
    label: config.label,
    calendarName,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    events: unique.slice(0, config.maxEvents),
    hasMore: unique.length > config.maxEvents,
    updatedAt: new Date().toISOString(),
  };
}

async function boundedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Calendar feed returned too much data.");
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Calendar feed returned too much data.");
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
      throw new Error("Calendar feed returned too much data.");
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

export async function fetchCalendarAgenda(
  widgetId: string,
  rawConfig: Record<string, unknown>,
  credentials: CalendarAgendaCredentials,
  force = false,
): Promise<CalendarAgendaResponse> {
  const feedUrl = normalizeCalendarFeedUrl(credentials.feedUrl);
  const config = normalizeCalendarAgendaConfig(rawConfig);
  const cacheKey = `${widgetId}\u0000${feedUrl}\u0000${config.label}\u0000${config.daysAhead}\u0000${config.maxEvents}`;
  const cached = cache.get(cacheKey);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;
  let response: Response;
  try {
    response = await fetch(feedUrl, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: "text/calendar, text/plain;q=0.9, */*;q=0.1",
        "User-Agent": "Dashcenter calendar-agenda",
      },
    });
  } catch {
    throw new Error("Could not reach the calendar feed.");
  }
  if (!response.ok) throw new Error(`Calendar feed returned HTTP ${response.status}.`);
  const value = parseCalendarAgenda(await boundedText(response), { ...config });
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

export async function testCalendarAgendaConnection(
  widgetId: string,
  rawConfig: Record<string, unknown>,
  credentials: CalendarAgendaCredentials,
) {
  const payload = await fetchCalendarAgenda(widgetId, rawConfig, credentials, true);
  return {
    ok: true,
    calendarName: payload.calendarName,
    upcoming: payload.events.length,
    hasMore: payload.hasMore,
  };
}

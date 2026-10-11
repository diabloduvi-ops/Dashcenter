export type ClockFormat = "12h" | "24h";

export function normalizeClockFormat(value: unknown): ClockFormat {
  return typeof value === "string" && ["12h", "12-hour", "h12"].includes(value.trim().toLowerCase())
    ? "12h"
    : "24h";
}

export function createClockFormatter(locale: string, format: ClockFormat): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    ...(format === "12h" ? { hour12: true } : { hourCycle: "h23" }),
  });
}

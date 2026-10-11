interface WeatherResult {
  label: string;
  latitude: number;
  longitude: number;
  temperature: number | null;
  temperatureUnit: string;
  weatherCode: number | null;
  condition: string;
  description: string;
  isDay: boolean;
  windSpeed: number | null;
  windSpeedUnit: string;
  fetchedAt: string;
  stale?: boolean;
}

interface CacheEntry {
  expiresAt: number;
  result: WeatherResult;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const STALE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function weatherCondition(code: number | null): string {
  if (code === null) return "Unknown";
  if (code === 0) return "Clear sky";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code >= 95) return "Thunderstorm";
  return "Unknown";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function fetchWeather(label: string, latitude: number, longitude: number): Promise<WeatherResult> {
  const cacheKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.result, label };

  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,weather_code,is_day,wind_speed_10m",
    timezone: "auto",
  });

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, {
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "application/json", "User-Agent": "Dashcenter/0.1" },
    });
    if (!response.ok) throw new Error(`Weather provider returned HTTP ${response.status}.`);
    const body = (await response.json()) as {
      latitude?: unknown;
      longitude?: unknown;
      current?: Record<string, unknown>;
      current_units?: Record<string, unknown>;
    };
    const current = body.current ?? {};
    const units = body.current_units ?? {};
    const weatherCode = finiteNumber(current.weather_code);
    const condition = weatherCondition(weatherCode);
    const result: WeatherResult = {
      label,
      latitude: finiteNumber(body.latitude) ?? latitude,
      longitude: finiteNumber(body.longitude) ?? longitude,
      temperature: finiteNumber(current.temperature_2m),
      temperatureUnit: typeof units.temperature_2m === "string" ? units.temperature_2m : "°C",
      weatherCode,
      condition,
      description: condition,
      isDay: current.is_day === 1,
      windSpeed: finiteNumber(current.wind_speed_10m),
      windSpeedUnit: typeof units.wind_speed_10m === "string" ? units.wind_speed_10m : "km/h",
      fetchedAt: new Date().toISOString(),
    };
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, result });
    return result;
  } catch (error) {
    if (cached && cached.expiresAt + STALE_TTL_MS > Date.now()) {
      return { ...cached.result, label, stale: true };
    }
    throw error;
  }
}

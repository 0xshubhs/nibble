import fs from 'fs';
import path from 'path';
import type { WeatherDay, WeatherLocation, WeatherSnapshot } from '../../types';

/**
 * Current conditions and a seven-day forecast, from Open-Meteo -- no API key,
 * no account, and its terms allow non-commercial use with no signup at all.
 *
 * This is the one tool in the notch that has to leave the machine: there is
 * no offline source for tomorrow's weather. Nothing else about it does --
 * the query is a place name or a pair of coordinates, never anything from
 * the memory or the clipboard -- but it is worth being plain about, in an
 * app whose whole pitch elsewhere is that nothing is uploaded.
 */

const CACHE_MS = 20 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

interface Cached {
  location: WeatherLocation | null;
  snapshot: WeatherSnapshot | null;
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function geocode(query: string): Promise<WeatherLocation | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(query)}`;
  const data = (await fetchJson(url)) as {
    results?: Array<{ name: string; admin1?: string; country?: string; latitude: number; longitude: number }>;
  };
  const hit = data.results?.[0];
  if (!hit) return null;
  const place = [hit.name, hit.admin1, hit.country].filter(Boolean).join(', ');
  return { name: place, lat: hit.latitude, lon: hit.longitude };
}

async function fetchForecast(loc: WeatherLocation): Promise<WeatherSnapshot> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code` +
    `&forecast_days=7&timezone=auto`;
  const data = (await fetchJson(url)) as {
    current?: { temperature_2m: number; weather_code: number };
    daily?: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; weather_code: number[] };
  };
  const daily: WeatherDay[] = (data.daily?.time ?? []).map((date, i) => ({
    date,
    max: data.daily!.temperature_2m_max[i],
    min: data.daily!.temperature_2m_min[i],
    code: data.daily!.weather_code[i],
  }));
  return {
    ok: true,
    location: loc,
    current: data.current
      ? { temp: data.current.temperature_2m, code: data.current.weather_code }
      : null,
    daily,
    fetchedAt: Date.now(),
  };
}

export class Weather {
  private readonly file: string;
  private cache: Cached;

  constructor(dir: string) {
    this.file = path.join(dir, 'tools-weather.json');
    this.cache = this.read();
  }

  private read(): Cached {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Cached>;
      return { location: raw.location ?? null, snapshot: raw.snapshot ?? null };
    } catch {
      return { location: null, snapshot: null };
    }
  }

  private write(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.cache));
    } catch {
      /* the next fetch just starts from scratch */
    }
  }

  /** The cached forecast if it's fresh, or a re-fetch for the stored location. */
  async get(): Promise<WeatherSnapshot> {
    if (!this.cache.location) {
      return { ok: false, error: 'No location set', location: null, current: null, daily: [], fetchedAt: null };
    }
    const fresh = this.cache.snapshot && Date.now() - (this.cache.snapshot.fetchedAt ?? 0) < CACHE_MS;
    if (fresh) return this.cache.snapshot!;
    return this.refresh();
  }

  private async refresh(): Promise<WeatherSnapshot> {
    try {
      const snapshot = await fetchForecast(this.cache.location!);
      this.cache.snapshot = snapshot;
      this.write();
      return snapshot;
    } catch (err) {
      const stale = this.cache.snapshot;
      return {
        ok: Boolean(stale),
        error: err instanceof Error ? err.message : String(err),
        location: this.cache.location,
        current: stale?.current ?? null,
        daily: stale?.daily ?? [],
        fetchedAt: stale?.fetchedAt ?? null,
      };
    }
  }

  async setLocation(query: string): Promise<WeatherSnapshot> {
    let loc: WeatherLocation | null;
    try {
      loc = await geocode(query);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        location: this.cache.location,
        current: null,
        daily: [],
        fetchedAt: null,
      };
    }
    if (!loc) {
      return {
        ok: false,
        error: `Couldn't find "${query}"`,
        location: this.cache.location,
        current: null,
        daily: [],
        fetchedAt: null,
      };
    }
    this.cache.location = loc;
    this.cache.snapshot = null;
    this.write();
    return this.refresh();
  }
}

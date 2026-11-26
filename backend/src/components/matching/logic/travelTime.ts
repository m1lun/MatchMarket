import { env } from '../../../shared/config/env';
import type { GeoPoint } from '../../../shared/models/common';

export type TravelMode = 'walk' | 'bike' | 'drive';

// Used until the viewer has saved preferences.
export const DEFAULT_TRAVEL_MODE: TravelMode = 'walk';

// The routing request gives up after this long, so the feed still answers within
// 3 seconds when the routing service is slow (NFR 2).
export const ROUTING_TIMEOUT_MS = 2000;

export const ORS_MATRIX_URL = 'https://api.openrouteservice.org/v2/matrix';

// OpenRouteService's profile for each travel mode.
export function orsProfile(mode: TravelMode): string {
  switch (mode) {
    case 'walk':
      return 'foot-walking';
    case 'bike':
      return 'cycling-regular';
    case 'drive':
      return 'driving-car';
  }
}

const SECONDS_PER_MINUTE = 60;

// Minutes from origin to each destination, in order, or null where there is no route.
// Returns an empty list when the routing service is unavailable, so the feed still
// loads without travel times.
export type TravelTimes = (origin: GeoPoint, destinations: GeoPoint[], mode: TravelMode) => Promise<(number | null)[]>;

// The matrix response has one row per source; there is one source, the origin.
// Each entry is seconds, or null where there is no route.
function durationsOf(body: unknown, count: number): (number | null)[] | null {
  if (typeof body !== 'object' || body === null || !('durations' in body) || !Array.isArray(body.durations)) {
    return null;
  }
  const row: unknown = body.durations[0];
  if (!Array.isArray(row) || row.length !== count || !row.every((value) => value === null || typeof value === 'number')) {
    return null;
  }
  return row as (number | null)[];
}

// One OpenRouteService matrix request from the origin to every destination. A missing
// API key, an error, a rate limit or a timeout all give an empty list.
export const travelTimes: TravelTimes = async (origin, destinations, mode) => {
  const apiKey = env.orsApiKey;
  if (apiKey === undefined || destinations.length === 0) {
    return [];
  }
  try {
    const response = await fetch(`${ORS_MATRIX_URL}/${orsProfile(mode)}`, {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: [origin.coordinates, ...destinations.map((destination) => destination.coordinates)],
        sources: [0],
        destinations: destinations.map((_destination, index) => index + 1),
        metrics: ['duration'],
      }),
      signal: AbortSignal.timeout(ROUTING_TIMEOUT_MS),
    });
    if (!response.ok) {
      return [];
    }
    const seconds = durationsOf(await response.json(), destinations.length);
    return seconds === null ? [] : seconds.map((value) => (value === null ? null : Math.round(value / SECONDS_PER_MINUTE)));
  } catch {
    return [];
  }
};

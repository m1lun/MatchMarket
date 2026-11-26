import type { GeoPoint } from '../models/common';

export type Body = Record<string, unknown>;

export function isObject(value: unknown): value is Body {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseLocation(value: unknown, errors: string[]): GeoPoint {
  const point: GeoPoint = { type: 'Point', coordinates: [0, 0] };
  if (!isObject(value) || !isNumber(value.longitude) || !isNumber(value.latitude)) {
    errors.push('location must be { longitude, latitude }');
  } else if (Math.abs(value.longitude) > 180 || Math.abs(value.latitude) > 90) {
    errors.push('location is out of range');
  } else {
    point.coordinates = [value.longitude, value.latitude];
  }
  return point;
}

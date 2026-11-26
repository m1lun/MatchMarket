import type { GeoPoint } from '../../../shared/models/common';

// Mean radius of the Earth.
const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

// Straight-line ("as the crow flies") distance between two points, using the
// haversine formula. Travel time by road comes from the routing service instead.
export function distanceKm(from: GeoPoint, to: GeoPoint): number {
  const [fromLongitude, fromLatitude] = from.coordinates;
  const [toLongitude, toLatitude] = to.coordinates;
  const latitudeDelta = toRadians(toLatitude - fromLatitude);
  const longitudeDelta = toRadians(toLongitude - fromLongitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(fromLatitude)) * Math.cos(toRadians(toLatitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

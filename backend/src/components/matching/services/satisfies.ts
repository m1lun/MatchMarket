import { CONDITIONS, normaliseKey, type Dimensions, type FieldValue, type RequestField } from '../../../shared/models/common';
import type { Listing } from '../../posts/models/listing';
import type { BuyerRequest } from '../../posts/models/request';
import { distanceKm } from './distance';

// How far a request searches when it has no radius field, as in the design doc.
export const DEFAULT_RADIUS_KM = 10;

const RADIUS_KEY = 'radiuskm';

export function requestValue(request: BuyerRequest, key: string): FieldValue | undefined {
  return request.requestFields.find((field) => field.key === key)?.value;
}

export function radiusKm(request: BuyerRequest): number {
  const radius = requestValue(request, RADIUS_KEY);
  return typeof radius === 'number' ? radius : DEFAULT_RADIUS_KM;
}

// Price and condition are top-level on a listing; everything else is in its fields.
function listingValue(listing: Listing, key: string): FieldValue | undefined {
  if (key === 'price') {
    return listing.price;
  }
  if (key === 'condition') {
    return listing.condition;
  }
  return listing.listingFields.find((field) => field.key === key)?.value;
}

// Position in CONDITIONS, so a lower number is a better condition; -1 if unknown.
export function conditionIndex(value: FieldValue | undefined): number {
  return (CONDITIONS as readonly unknown[]).indexOf(value);
}

function isDimensions(value: FieldValue): value is Dimensions {
  return typeof value === 'object';
}

// Sides largest first, so an item fits in any orientation: a 50×100×40 desk fits a
// 100×50×40 space.
function sides(dimensions: Dimensions): [number, number, number] {
  return [dimensions.width, dimensions.height, dimensions.depth].sort((a, b) => b - a) as [number, number, number];
}

export function fitsWithin(item: Dimensions, space: Dimensions): boolean {
  const [itemLongest, itemMiddle, itemShortest] = sides(item);
  const [spaceLongest, spaceMiddle, spaceShortest] = sides(space);
  return itemLongest <= spaceLongest && itemMiddle <= spaceMiddle && itemShortest <= spaceShortest;
}

// Brand, colour and custom text are compared ignoring case and spacing; numbers and
// yes/no values must be equal.
function sameValue(listingValue: FieldValue, wanted: FieldValue): boolean {
  if (typeof listingValue === 'string' && typeof wanted === 'string') {
    return normaliseKey(listingValue) === normaliseKey(wanted);
  }
  return listingValue === wanted;
}

// Whether the listing meets one request field, or undefined if the listing leaves it blank.
export function meetsField(field: RequestField, listing: Listing): boolean | undefined {
  const value = listingValue(listing, field.key);
  if (value === undefined) {
    return undefined;
  }
  switch (field.key) {
    case 'price':
      return typeof value === 'number' && typeof field.value === 'number' && value <= field.value;
    case 'condition': {
      const have = conditionIndex(value);
      const minimum = conditionIndex(field.value);
      return have !== -1 && minimum !== -1 && have <= minimum;
    }
    case 'dimensions':
      return isDimensions(value) && isDimensions(field.value) && fitsWithin(value, field.value);
    default:
      return sameValue(value, field.value);
  }
}

// The one hard-requirement rule. Both feeds use it, so a listing is in a request's feed
// exactly when that request is in the listing's feed. The feed only passes posts in the
// same category; radius always applies, and any other field applies when the buyer marked
// it hard. A listing that leaves a hard field blank is left out, since it can't be shown
// to meet it.
export function satisfies(request: BuyerRequest, listing: Listing): boolean {
  if (distanceKm(request.location, listing.location) > radiusKm(request)) {
    return false;
  }
  return request.requestFields.every(
    (field) => !field.hard || field.key === RADIUS_KEY || meetsField(field, listing) === true
  );
}

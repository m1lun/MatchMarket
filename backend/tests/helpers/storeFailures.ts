import type { Store } from '../../src/store/types';

export const FAILURE = new Error('MongoDB is unreachable');

export interface FailureCase {
  label: string;
  fail: (store: Store) => jest.SpyInstance;
}

export function rejecting(target: unknown, method: string): jest.SpyInstance {
  const spy = jest.spyOn(target as object, method as never) as unknown as jest.SpyInstance;
  return spy.mockRejectedValue(FAILURE);
}

export function expectServerError(response: { status: number; body: unknown }, spy: jest.SpyInstance): void {
  expect(response.status).toBe(500);
  expect(response.body).toStrictEqual({ error: 'Internal Server Error' });
  expect(spy).toHaveBeenCalledTimes(1);
}

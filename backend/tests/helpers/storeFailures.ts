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

// Takes the response as unknown, since Codacy's ESLint cannot see supertest's types.
export function expectServerError(response: unknown, spy: jest.SpyInstance): void {
  expect(response).toHaveProperty('status', 500);
  expect(response).toHaveProperty('body', { error: 'Internal Server Error' });
  expect(spy).toHaveBeenCalledTimes(1);
}

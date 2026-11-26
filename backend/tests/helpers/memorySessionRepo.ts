import type { RefreshSession } from '../../src/components/users/models/session';
import type { SessionRepo } from '../../src/components/users/store/types';

// Stands in for MongoSessionRepo with the same rules, so auth flows can be
// tested without a database. `rows` is exposed so tests can inspect or age it.
export class MemorySessionRepo implements SessionRepo {
  readonly rows: RefreshSession[] = [];

  insert(session: RefreshSession): Promise<void> {
    this.rows.push({ ...session });
    return Promise.resolve();
  }

  consume(tokenHash: string, now: Date): Promise<RefreshSession | null> {
    const row = this.rows.find(
      (r) => r.tokenHash === tokenHash && r.usedAt === null && r.expiresAt > now
    );
    if (row === undefined) {
      return Promise.resolve(null);
    }
    row.usedAt = now;
    return Promise.resolve({ ...row });
  }

  find(tokenHash: string): Promise<RefreshSession | null> {
    const row = this.rows.find((r) => r.tokenHash === tokenHash);
    return Promise.resolve(row === undefined ? null : { ...row });
  }

  revokeFamily(familyId: string): Promise<void> {
    const kept = this.rows.filter((r) => r.familyId !== familyId);
    this.rows.splice(0, this.rows.length, ...kept);
    return Promise.resolve();
  }
}

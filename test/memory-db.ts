import type { GlobalCounterDbLike, GlobalCounterTransactionLike } from '../src/global-cap';

/**
 * In-memory stand-in for Firestore with OPTIMISTIC transactions: a commit is
 * rejected and the update function re-run when a document read by the
 * transaction changed meanwhile — the contract `runTransaction` gives.
 * `merge: true` merges maps one level deep per nested object, like Firestore.
 */
type Doc = Record<string, unknown>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !(v instanceof Date) && !Array.isArray(v);
}

function deepMerge(base: Doc, patch: Doc): Doc {
  const out: Doc = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k] as Doc, v) : v;
  }
  return out;
}

export class MemoryDb implements GlobalCounterDbLike<string> {
  docs = new Map<string, Doc>();
  versions = new Map<string, number>();
  attempts = 0;
  commits = 0;

  doc(path: string): string {
    return path;
  }

  async runTransaction<T>(fn: (tx: GlobalCounterTransactionLike<string>) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      this.attempts += 1;
      const reads = new Map<string, number>();
      const writes: Array<[string, Doc]> = [];
      const tx: GlobalCounterTransactionLike<string> = {
        get: async (ref) => {
          // Yield so concurrent transactions really interleave.
          await new Promise((r) => setTimeout(r, 0));
          reads.set(ref, this.versions.get(ref) ?? 0);
          const data = this.docs.get(ref);
          return { exists: data !== undefined, data: () => (data ? structuredClone(data) : undefined) };
        },
        set: (ref, data) => {
          writes.push([ref, data]);
        },
      };
      const result = await fn(tx);
      await new Promise((r) => setTimeout(r, 0));
      const stale = [...reads].some(([ref, v]) => (this.versions.get(ref) ?? 0) !== v);
      if (stale) continue;
      for (const [ref, data] of writes) {
        this.docs.set(ref, deepMerge(this.docs.get(ref) ?? {}, data));
        this.versions.set(ref, (this.versions.get(ref) ?? 0) + 1);
        this.commits += 1;
      }
      return result;
    }
    throw new Error('MemoryDb: too much contention');
  }
}

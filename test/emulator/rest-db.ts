import type {
  GlobalCounterDbLike,
  GlobalCounterSnapshotLike,
  GlobalCounterTransactionLike,
} from '../../src/global-cap';

/**
 * `GlobalCounterDbLike` over the Firestore REST API of the EMULATOR — real
 * server-side transactions (`beginTransaction` / transactional read /
 * `commit`) with no SDK, so the package keeps zero Firebase dependency. The
 * consumers run the same function on `firebase-admin` (covered by their own
 * emulator spec). `Authorization: Bearer owner` = emulator admin, no rules.
 */
type Json = Record<string, unknown>;

function encode(value: unknown): Json {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'object' && !Array.isArray(value)) {
    return { mapValue: { fields: encodeFields(value as Json) } };
  }
  throw new Error(`rest-db: unsupported value ${String(value)}`);
}

function encodeFields(data: Json): Json {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, encode(v)]));
}

function decode(value: Json): unknown {
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return new Date(String(value.timestampValue));
  if ('mapValue' in value) return decodeFields(((value.mapValue as Json).fields ?? {}) as Json);
  return null;
}

function decodeFields(fields: Json): Json {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decode(v as Json)]));
}

/** Leaf field paths — what `set(…, { merge: true })` means. */
function leafPaths(data: Json, prefix = ''): string[] {
  return Object.entries(data).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    const isMap = typeof v === 'object' && v !== null && !(v instanceof Date) && !Array.isArray(v);
    return isMap ? leafPaths(v as Json, path) : [path];
  });
}

class Aborted extends Error {}

export class RestFirestore implements GlobalCounterDbLike<string> {
  readonly root: string;
  attempts = 0;

  constructor(
    readonly host: string,
    readonly projectId: string,
  ) {
    this.root = `projects/${projectId}/databases/(default)/documents`;
  }

  doc(path: string): string {
    return path;
  }

  private async call(method: string, url: string, body?: Json): Promise<{ status: number; json: Json }> {
    const res = await fetch(`http://${this.host}/v1/${url}`, {
      method,
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = (text ? JSON.parse(text) : {}) as Json;
    const status = ((json.error as Json | undefined)?.status as string | undefined) ?? '';
    if (res.status === 409 || status === 'ABORTED') throw new Aborted(text);
    return { status: res.status, json };
  }

  async read(path: string): Promise<Json | undefined> {
    const { status, json } = await this.call('GET', `${this.root}/${path}`);
    return status === 404 ? undefined : decodeFields((json.fields ?? {}) as Json);
  }

  async clear(): Promise<void> {
    await fetch(`http://${this.host}/emulator/v1/projects/${this.projectId}/databases/(default)/documents`, { method: 'DELETE' });
  }

  async seed(path: string, data: Json): Promise<void> {
    const { status, json } = await this.call('PATCH', `${this.root}/${path}`, { fields: encodeFields(data) });
    if (status >= 300) throw new Error(`rest-db seed failed: ${JSON.stringify(json)}`);
  }

  async runTransaction<T>(fn: (tx: GlobalCounterTransactionLike<string>) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      this.attempts += 1;
      let transaction: string | undefined;
      try {
        const begin = await this.call('POST', `${this.root}:beginTransaction`, { options: { readWrite: {} } });
        transaction = String(begin.json.transaction);
        const id = transaction;
        const writes: Json[] = [];
        const tx: GlobalCounterTransactionLike<string> = {
          get: async (ref): Promise<GlobalCounterSnapshotLike> => {
            // `batchGet` (POST): the emulator cannot parse the `transaction` bytes as a GET query parameter.
            const { status, json } = await this.call('POST', `${this.root}:batchGet`, { documents: [`${this.root}/${ref}`], transaction: id });
            if (status >= 300) throw new Error(`rest-db get failed: ${JSON.stringify(json)}`);
            const found = ((json as unknown as Json[])[0]?.found ?? undefined) as Json | undefined;
            if (!found) return { exists: false, data: () => undefined };
            const data = decodeFields((found.fields ?? {}) as Json);
            return { exists: true, data: () => data };
          },
          set: (ref, data) => {
            writes.push({
              update: { name: `${this.root}/${ref}`, fields: encodeFields(data) },
              updateMask: { fieldPaths: leafPaths(data) },
            });
          },
        };
        const result = await fn(tx);
        const commit = await this.call('POST', `${this.root}:commit`, { transaction: id, writes });
        if (commit.status >= 300) throw new Error(`rest-db commit failed: ${JSON.stringify(commit.json)}`);
        return result;
      } catch (err) {
        // Release the pessimistic locks of the loser at once (what the SDKs do), then back off.
        if (transaction) await this.call('POST', `${this.root}:rollback`, { transaction }).catch(() => undefined);
        if (!(err instanceof Aborted)) throw err;
        lastError = err;
        await new Promise((r) => setTimeout(r, Math.random() * 60 * (attempt + 1)));
      }
    }
    throw lastError;
  }
}

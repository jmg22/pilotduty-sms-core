import type {
  Consent,
  OptOut,
  SmsMessageRecord,
  SmsStore,
  TwilioClientLike,
  TwilioMessageCreateParams,
  TwilioMessageLike,
} from '../src/types';

export class MemoryStore implements SmsStore {
  consents = new Map<string, Consent>();
  optOuts = new Map<string, OptOut>();
  messages: SmsMessageRecord[] = [];
  orgCounts = new Map<string, number>();
  globalCounts = new Map<string, number>();
  lastMessage = new Map<string, Date>();
  idempotencyKeys = new Set<string>();

  async getConsent(e164: string, orgId: string) {
    return this.consents.get(`${e164}_${orgId}`) ?? null;
  }
  async getOptOut(e164: string) {
    return this.optOuts.get(e164) ?? null;
  }
  async writeOptOut(e164: string, data: OptOut) {
    this.optOuts.set(e164, data);
  }
  async writeMessage(msg: SmsMessageRecord) {
    this.messages.push(msg);
  }
  async incrementCounters(orgId: string, day: string) {
    const month = day.slice(0, 7);
    const orgKey = `${orgId}_${month}`;
    const org = (this.orgCounts.get(orgKey) ?? 0) + 1;
    const global = (this.globalCounts.get(day) ?? 0) + 1;
    this.orgCounts.set(orgKey, org);
    this.globalCounts.set(day, global);
    return { org, global };
  }
  async lastMessageAt(e164: string) {
    return this.lastMessage.get(e164) ?? null;
  }
  async hasIdempotencyKey(key: string) {
    return this.idempotencyKeys.has(key);
  }
}

export class FakeTwilio implements TwilioClientLike {
  calls: TwilioMessageCreateParams[] = [];
  nextError: unknown = null;
  nextResponse: Partial<TwilioMessageLike> = {};
  messages = {
    create: async (params: TwilioMessageCreateParams): Promise<TwilioMessageLike> => {
      this.calls.push(params);
      if (this.nextError) {
        const err = this.nextError;
        this.nextError = null;
        throw err;
      }
      return {
        sid: `SM${(this.calls.length).toString().padStart(4, '0')}`,
        from: '+18005550100',
        status: 'queued',
        numSegments: '1',
        ...this.nextResponse,
      };
    },
  };
}

export function twilioError(code: number, message = `twilio ${code}`) {
  return Object.assign(new Error(message), {
    status: 400,
    code,
    moreInfo: `https://www.twilio.com/docs/errors/${code}`,
  });
}

export function silentLogger() {
  const entries: Array<{ level: string; msg: string; ctx?: Record<string, unknown> }> = [];
  return {
    entries,
    logger: {
      debug: (msg: string, ctx?: Record<string, unknown>) => entries.push({ level: 'debug', msg, ctx }),
      info: (msg: string, ctx?: Record<string, unknown>) => entries.push({ level: 'info', msg, ctx }),
      warn: (msg: string, ctx?: Record<string, unknown>) => entries.push({ level: 'warn', msg, ctx }),
      error: (msg: string, ctx?: Record<string, unknown>) => entries.push({ level: 'error', msg, ctx }),
    },
  };
}

/**
 * @letterapp/node — official Node.js SDK for letter.app
 *
 * Two modes:
 *  - Long-running server (default): auto-batches calls, flushes every 100ms
 *    or 50 events, retries with exponential backoff. Call `await client.close()`
 *    before process exit.
 *  - Serverless (Vercel/Lambda): pass `flushAt: 1` or call the *Sync variants
 *    (`identifySync`, `groupSync`, `trackSync`) which return a promise per call
 *    and never queue.
 */

const SDK_VERSION = "0.1.0";

export type Traits = Record<string, unknown>;

export interface IdentifyOptions {
  userId: string;
  email?: string;
  traits?: Traits;
  timezone?: string;
  timestamp?: Date | string;
  messageId?: string;
}

export interface GroupOptions {
  userId: string;
  accountId: string;
  name?: string;
  traits?: Traits;
  timestamp?: Date | string;
  messageId?: string;
}

export interface TrackOptions {
  userId: string;
  event: string;
  properties?: Traits;
  timestamp?: Date | string;
  messageId?: string;
}

export interface LetterOptions {
  /** API key created in letter.app → Settings → API keys. */
  apiKey: string;
  /** Base URL of the letter.app API. Defaults to https://api.letter.app. */
  baseUrl?: string;
  /** Flush after this many queued events. Default 50. Set to 1 for serverless. */
  flushAt?: number;
  /** Flush every N ms. Default 100. Set to 0 to disable interval flush. */
  flushInterval?: number;
  /** Max retry attempts per request. Default 3. */
  maxRetries?: number;
  /** Override the global fetch (testing, proxies). */
  fetch?: typeof fetch;
  /** Callback for transport-level errors. */
  onError?: (err: Error) => void;
}

type QueueItem =
  | ({ type: "identify" } & SerializedIdentify)
  | ({ type: "group" } & SerializedGroup)
  | ({ type: "track" } & SerializedTrack);

type SerializedIdentify = {
  userId: string;
  email?: string;
  traits: Traits;
  timezone?: string;
  timestamp?: string;
  messageId: string;
};
type SerializedGroup = {
  userId: string;
  accountId: string;
  name?: string;
  traits: Traits;
  timestamp?: string;
  messageId: string;
};
type SerializedTrack = {
  userId: string;
  event: string;
  properties: Traits;
  timestamp?: string;
  messageId: string;
};

export class LetterError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "LetterError";
  }
}

export class Letter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly flushAt: number;
  private readonly flushInterval: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly onError: (err: Error) => void;

  private queue: QueueItem[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;
  private closed = false;

  constructor(opts: LetterOptions) {
    if (!opts.apiKey) throw new LetterError("apiKey is required");
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://api.letter.app").replace(/\/$/, "");
    this.flushAt = opts.flushAt ?? 50;
    this.flushInterval = opts.flushInterval ?? 100;
    this.maxRetries = opts.maxRetries ?? 3;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.onError = opts.onError ?? ((err) => console.error("[letter]", err));
  }

  /** Queue an identify call. Resolves when the call is enqueued (not sent). */
  identify(opts: IdentifyOptions): void {
    this.enqueue({ type: "identify", ...serializeIdentify(opts) });
  }

  /** Queue a group call. */
  group(opts: GroupOptions): void {
    this.enqueue({ type: "group", ...serializeGroup(opts) });
  }

  /** Queue a track call. */
  track(opts: TrackOptions): void {
    this.enqueue({ type: "track", ...serializeTrack(opts) });
  }

  /** Send an identify immediately, awaiting the response. */
  async identifySync(opts: IdentifyOptions): Promise<void> {
    await this.request("/v1/identify", serializeIdentify(opts));
  }
  async groupSync(opts: GroupOptions): Promise<void> {
    await this.request("/v1/group", serializeGroup(opts));
  }
  async trackSync(opts: TrackOptions): Promise<void> {
    await this.request("/v1/track", serializeTrack(opts));
  }

  /** Flush queued items now. Resolves when the in-flight request completes. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) {
      if (this.inflight) await this.inflight;
      return;
    }
    const batch = this.queue.splice(0, this.queue.length);
    const send = this.request("/v1/batch", { batch }).then(
      () => undefined,
      (err) => this.onError(err as Error),
    );
    this.inflight = send;
    try {
      await send;
    } finally {
      if (this.inflight === send) this.inflight = null;
    }
  }

  /** Flush and stop the background timer. Required before process exit. */
  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
    if (this.inflight) await this.inflight;
  }

  private enqueue(item: QueueItem): void {
    if (this.closed) {
      this.onError(new LetterError("Letter client is closed."));
      return;
    }
    this.queue.push(item);
    if (this.queue.length >= this.flushAt) {
      void this.flush();
      return;
    }
    if (this.flushInterval > 0 && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.flushInterval);
      // Allow Node to exit even if a flush is pending.
      const t = this.timer as unknown as { unref?: () => void };
      t.unref?.();
    }
  }

  private async request(path: string, body: unknown): Promise<unknown> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "User-Agent": `letter-node/${SDK_VERSION}`,
          },
          body: JSON.stringify(body),
        });

        if (res.status === 429 && attempt < this.maxRetries) {
          const retryAfter = Number(res.headers.get("retry-after") ?? "1");
          await sleep(retryAfter * 1000);
          continue;
        }
        if (res.status >= 500 && attempt < this.maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new LetterError(
            `Request failed with ${res.status}: ${text || res.statusText}`,
            res.status,
            text,
          );
        }
        return res.headers.get("content-type")?.includes("application/json")
          ? await res.json()
          : await res.text();
      } catch (err) {
        lastErr = err as Error;
        if (attempt >= this.maxRetries) break;
        await sleep(backoff(attempt));
      }
    }
    throw lastErr ?? new LetterError("Request failed for unknown reason");
  }
}

function serializeIdentify(o: IdentifyOptions): SerializedIdentify {
  if (!o.userId) throw new LetterError("identify: userId is required");
  return {
    userId: o.userId,
    email: o.email,
    traits: o.traits ?? {},
    timezone: o.timezone,
    timestamp: toIso(o.timestamp),
    messageId: o.messageId ?? newMessageId(),
  };
}
function serializeGroup(o: GroupOptions): SerializedGroup {
  if (!o.userId) throw new LetterError("group: userId is required");
  if (!o.accountId) throw new LetterError("group: accountId is required");
  return {
    userId: o.userId,
    accountId: o.accountId,
    name: o.name,
    traits: o.traits ?? {},
    timestamp: toIso(o.timestamp),
    messageId: o.messageId ?? newMessageId(),
  };
}
function serializeTrack(o: TrackOptions): SerializedTrack {
  if (!o.userId) throw new LetterError("track: userId is required");
  if (!o.event) throw new LetterError("track: event is required");
  return {
    userId: o.userId,
    event: o.event,
    properties: o.properties ?? {},
    timestamp: toIso(o.timestamp),
    messageId: o.messageId ?? newMessageId(),
  };
}

function toIso(v: Date | string | undefined): string | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return v.toISOString();
  return v;
}

function newMessageId(): string {
  // crypto.randomUUID is available in Node ≥ 14.17 and all browsers.
  return globalThis.crypto.randomUUID();
}

function backoff(attempt: number): number {
  const base = 250 * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 100);
  return base + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

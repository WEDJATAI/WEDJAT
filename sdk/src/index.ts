// ═══════════════════════════════════════════════════════════════════════════════
// @wedjat/sdk — Official WEDJAT Intelligence API SDK (v4 §11, §12, §59, §87-§89)
//
// Design contract (v4 §3: WEDJAT must never be a runtime dependency):
//   • ASYNC BY DEFAULT — publish() acknowledges (202) immediately; processing
//     happens inside WEDJAT after the response.
//   • OUTBOX (§12/§59) — when WEDJAT is unreachable, events are queued
//     locally (memory or a pluggable store) and delivered later. Platforms
//     keep operating.
//   • IDEMPOTENCY (§15/§58) — every publish carries a stable Idempotency-Key
//     (auto-generated per payload unless supplied); retries never duplicate
//     knowledge.
//   • RETRIES (§95) — exponential backoff + jitter on 408/429/5xx/network;
//     never on 4xx policy errors; Retry-After honored.
//   • BACKPRESSURE (§88) — the queue is bounded; overflow raises a typed
//     error instead of unbounded growth.
//   • CRITICALITY (§89) — CRITICAL events jump the retry queue first.
//   • SECRETS — keys are held in memory only; payloads are user data.
// ═══════════════════════════════════════════════════════════════════════════════

export interface WedjatSdkConfig {
  /** Base URL of the WEDJAT deployment, e.g. https://wedjat-ai.vercel.app */
  baseUrl: string;
  /** Scoped service API key (from WEDJAT → Intelligence → Service Identities). */
  apiKey: string;
  /** Default platform slug for this client (ownership is validated server-side). */
  platform: string;
  /** Max attempts per request (default 4). */
  maxAttempts?: number;
  /** Request timeout ms (default 15 000). */
  timeoutMs?: number;
  /** Offline queue bound (default 1000 — §88 backpressure). */
  maxQueueSize?: number;
  /** Custom persistent store for the offline queue (default: in-memory). */
  queueStore?: QueueStore;
  /** Environment label reported in events (default 'production'). */
  environment?: string;
}

export interface QueueStore {
  load(): Promise<QueuedItem[]> | QueuedItem[];
  save(items: QueuedItem[]): Promise<void> | void;
}

interface QueuedItem {
  id: string;
  path: string;
  body: unknown;
  idempotencyKey: string;
  criticality: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
  attempts: number;
  queuedAt: number;
}

export interface PublishResult {
  eventId: string;
  status: 'RECEIVED' | 'PROCESSED' | 'SKIPPED' | 'DUPLICATE';
  jobId: string | null;
  message: string;
}

export interface EventPayload {
  eventType: string;
  payload: Record<string, unknown>;
  eventId?: string;
  sourceVersion?: string;
  sourceCommit?: string;
  occurredAt?: string;
  correlationId?: string;
  causationId?: string;
  criticality?: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
  idempotencyKey?: string;
}

export interface KnowledgePayload {
  title: string;
  content: string;
  type?: string;
  version?: string;
  commit?: string;
  file?: string;
}

export interface SchemaSnapshotPayload {
  database: string;
  version?: string;
  tables: { name: string; columns: { name: string; type: string }[] }[];
}

export interface FeedbackPayload {
  question: string;
  answer?: string;
  correction?: string;
  reason?: string;
}

export interface IncidentPayload {
  title: string;
  description: string;
  severity?: string;
  resolved?: boolean;
  resolution?: string;
}

export interface OutcomePayload {
  outcome: 'IMPLEMENTED' | 'NOT_IMPLEMENTED' | 'PARTIALLY_IMPLEMENTED' | 'FAILED' | 'REVERTED' | 'VALIDATED';
  recommendationId?: string;
  metricName?: string;
  beforeValue?: string;
  afterValue?: string;
  notes?: string;
}

export interface LearningCandidatePayload {
  taskType?: string;
  input: string;
  output: string;
  evidence?: string;
}

export interface AskResult {
  mode: string;
  platform: string;
  answer: string;
  confidence: unknown;
  sources: { rank: number; title: string; heading: string; platform: string; score: number }[];
  generationStatus?: string;
  note?: string | null;
}

export class WedjatQueueOverflowError extends Error {
  constructor(readonly dropped: QueuedItem | null) {
    super('WEDJAT SDK offline queue overflow (§88 backpressure) — item rejected');
    this.name = 'WedjatQueueOverflowError';
  }
}

export class WedjatApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'WedjatApiError';
  }
}

// ── small utils (no dependencies) ────────────────────────────────────────────

function hashString(s: string): string {
  // FNV-1a — stable, dependency-free idempotency key material.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function jitter(base: number): number {
  return Math.round(base * (0.5 + Math.random()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── client ────────────────────────────────────────────────────────────────────

export class WedjatClient {
  private readonly cfg: Required<Pick<WedjatSdkConfig, 'baseUrl' | 'apiKey' | 'platform' | 'maxAttempts' | 'timeoutMs' | 'maxQueueSize' | 'environment'>> & { queueStore: QueueStore };
  private queue: QueuedItem[] = [];
  private flushing = false;
  private seq = 0;

  constructor(cfg: WedjatSdkConfig) {
    this.cfg = {
      baseUrl: cfg.baseUrl.replace(/\/+$/, ''),
      apiKey: cfg.apiKey,
      platform: cfg.platform,
      maxAttempts: cfg.maxAttempts ?? 4,
      timeoutMs: cfg.timeoutMs ?? 15_000,
      maxQueueSize: cfg.maxQueueSize ?? 1000,
      environment: cfg.environment ?? 'production',
      queueStore: cfg.queueStore ?? memoryStore(),
    };
    const loaded = this.cfg.queueStore.load();
    Promise.resolve(loaded as QueuedItem[] | Promise<QueuedItem[]>)
      .then((items: QueuedItem[]) => { this.queue = items ?? []; })
      .catch(() => {});
  }

  // ── core HTTP with §95 retry semantics ────────────────────────────────────

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
      try {
        const res = await fetch(`${this.cfg.baseUrl}${path}`, {
          method,
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${this.cfg.apiKey}`,
            'Content-Type': 'application/json',
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        clearTimeout(timer);
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: T; error?: { code?: string; message?: string } };
        if (res.status >= 200 && res.status < 300 && json.ok !== false) {
          return (json.data ?? (json as unknown)) as T;
        }
        // Retry only transient classes (§95): 408, 429, 5xx.
        const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
        if (retryable && attempt < this.cfg.maxAttempts) {
          const retryAfter = Number(res.headers.get('retry-after') ?? '0');
          await sleep(retryAfter > 0 ? retryAfter * 1000 : jitter(400 * 2 ** (attempt - 1)));
          continue;
        }
        throw new WedjatApiError(res.status, json.error?.code ?? 'HTTP_ERROR', json.error?.message ?? `HTTP ${res.status}`);
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof WedjatApiError) throw err;
        // Network/abort — retry with backoff.
        if (attempt < this.cfg.maxAttempts) {
          await sleep(jitter(400 * 2 ** (attempt - 1)));
          continue;
        }
        throw new WedjatApiError(0, 'NETWORK', err instanceof Error ? err.message : 'network error');
      }
    }
  }

  // ── offline outbox (§12/§59) ───────────────────────────────────────────────

  private enqueue(path: string, body: unknown, idempotencyKey: string, criticality: QueuedItem['criticality']): Promise<PublishResult> {
    if (this.queue.length >= this.cfg.maxQueueSize) {
      // §88: bounded queue — drop the LOWEST criticality item or reject.
      const lowest = [...this.queue].sort((a, b) => critRank(a.criticality) - critRank(b.criticality))[0];
      if (lowest && critRank(lowest.criticality) < critRank(criticality)) {
        this.queue = this.queue.filter((q) => q.id !== lowest.id);
      } else {
        return Promise.reject(new WedjatQueueOverflowError(lowest ?? null));
      }
    }
    const item: QueuedItem = {
      id: `q_${Date.now().toString(36)}_${(this.seq++).toString(36)}`,
      path, body, idempotencyKey, criticality,
      attempts: 0,
      queuedAt: Date.now(),
    };
    this.queue.push(item);
    void this.persist();
    void this.flush();
    // Outbox semantics: acknowledged locally, delivered async.
    return Promise.resolve({ eventId: item.id, status: 'RECEIVED', jobId: null, message: 'queued locally (outbox §12) — delivery in progress' });
  }

  private async persist(): Promise<void> {
    try { await this.cfg.queueStore.save(this.queue); } catch { /* best effort */ }
  }

  /** Delivers queued items; CRITICAL first (§89). Safe to call anytime. */
  async flush(): Promise<{ delivered: number; remaining: number }> {
    if (this.flushing) {
      return { delivered: 0, remaining: this.queue.length };
    }
    this.flushing = true;
    let delivered = 0;
    try {
      this.queue.sort((a, b) => critRank(b.criticality) - critRank(a.criticality) || a.queuedAt - b.queuedAt);
      while (this.queue.length > 0) {
        const item = this.queue[0];
        try {
          await this.request<PublishResult>('POST', item.path, item.body, item.idempotencyKey);
          this.queue.shift();
          delivered += 1;
        } catch {
          item.attempts += 1;
          break; // keep the rest queued; next flush retries
        }
      }
      await this.persist();
    } finally {
      this.flushing = false;
    }
    return { delivered, remaining: this.queue.length };
  }

  queueDepth(): number {
    return this.queue.length;
  }

  // ── §11 SDK surface ────────────────────────────────────────────────────────

  /** Publish a raw event to the fabric (§13). */
  async event(event: EventPayload): Promise<PublishResult> {
    const idem = event.idempotencyKey ?? `sdk-${hashString(`${event.eventType}|${JSON.stringify(event.payload)}`)}`;
    const body = {
      eventId: event.eventId,
      eventType: event.eventType,
      sourcePlatform: this.cfg.platform,
      sourceEnvironment: this.cfg.environment,
      sourceVersion: event.sourceVersion,
      sourceCommit: event.sourceCommit,
      occurredAt: event.occurredAt ?? new Date().toISOString(),
      correlationId: event.correlationId,
      causationId: event.causationId,
      criticality: event.criticality ?? 'NORMAL',
      idempotencyKey: idem,
      payload: event.payload,
    };
    try {
      return await this.request<PublishResult>('POST', '/api/v1/events', body, idem);
    } catch (err) {
      if (err instanceof WedjatApiError && err.status === 0) {
        return this.enqueue('/api/v1/events', body, idem, body.criticality);
      }
      throw err;
    }
  }

  /** Publish validated knowledge (§18). */
  async knowledge(k: KnowledgePayload): Promise<PublishResult> {
    const idem = `sdk-k-${hashString(`${k.title}|${k.content.slice(0, 500)}`)}`;
    const body = { platform: this.cfg.platform, ...k };
    try {
      return await this.request<PublishResult>('POST', '/api/v1/knowledge', body, idem);
    } catch (err) {
      if (err instanceof WedjatApiError && err.status === 0) {
        return this.enqueue('/api/v1/knowledge', body, idem, 'HIGH');
      }
      throw err;
    }
  }

  /** Publish a database schema snapshot (§34). */
  async schema(s: SchemaSnapshotPayload): Promise<PublishResult> {
    const idem = `sdk-s-${hashString(`${s.database}|${s.version ?? ''}|${s.tables.length}`)}`;
    const body = { platform: this.cfg.platform, ...s };
    try {
      return await this.request<PublishResult>('POST', '/api/v1/schemas', body, idem);
    } catch (err) {
      if (err instanceof WedjatApiError && err.status === 0) {
        return this.enqueue('/api/v1/schemas', body, idem, 'HIGH');
      }
      throw err;
    }
  }

  /** Submit feedback / correction (§8 — corrections are additions). */
  async feedback(f: FeedbackPayload): Promise<PublishResult> {
    return this.event({
      eventType: f.correction ? 'ai.answer.corrected' : 'feedback.submitted',
      payload: { platform: this.cfg.platform, ...f },
    });
  }

  /** Report an incident (§38 — failures become knowledge). */
  async incident(i: IncidentPayload): Promise<PublishResult> {
    return this.event({
      eventType: i.resolved ? 'incident.resolved' : 'incident.created',
      criticality: i.resolved ? 'NORMAL' : 'CRITICAL',
      payload: { platform: this.cfg.platform, ...i },
    });
  }

  /** Report a measured outcome (§66 — closed-loop learning). */
  async outcome(o: OutcomePayload): Promise<PublishResult> {
    return this.event({
      eventType: 'outcome.reported',
      criticality: 'HIGH',
      payload: { platform: this.cfg.platform, ...o },
    });
  }

  /** Submit a learning candidate (§44). */
  async learningCandidate(c: LearningCandidatePayload): Promise<PublishResult> {
    const idem = `sdk-lc-${hashString(`${c.taskType ?? 'QA'}|${c.input.slice(0, 300)}|${c.output.slice(0, 300)}`)}`;
    const body = { platform: this.cfg.platform, ...c };
    try {
      return await this.request<PublishResult>('POST', '/api/v1/learning-candidates', body, idem);
    } catch (err) {
      if (err instanceof WedjatApiError && err.status === 0) {
        return this.enqueue('/api/v1/learning-candidates', body, idem, 'NORMAL');
      }
      throw err;
    }
  }

  /** Ask WEDJAT a grounded question (§26). */
  async ask(query: string, opts: { mode?: 'ASK' | 'HISTORICAL' | 'AUDIT' } = {}): Promise<AskResult> {
    return this.request<AskResult>('POST', '/api/v1/query', {
      query,
      platform: this.cfg.platform,
      mode: opts.mode ?? 'ASK',
    });
  }

  /** Request a platform analysis (§76/§113). */
  async analyze(focus: 'resilience' | 'security' | 'architecture' | 'database' | 'performance' | 'cost'): Promise<unknown> {
    return this.request<unknown>('POST', '/api/v1/analyze', { platform: this.cfg.platform, focus });
  }

  /** Liveness/readiness probe (public). */
  async health(): Promise<{ ok: boolean; status: string }> {
    return this.request<{ ok: boolean; status: string }>('GET', '/api/v1/health');
  }
}

function critRank(c: QueuedItem['criticality']): number {
  return c === 'CRITICAL' ? 3 : c === 'HIGH' ? 2 : c === 'NORMAL' ? 1 : 0;
}

function memoryStore(): QueueStore {
  let items: QueuedItem[] = [];
  return {
    load: () => items,
    save: (next) => { items = next; },
  };
}

/** File-backed queue store for Node.js runtimes (persistent outbox §12).
 *  Node resolves the dynamic `node:fs` import; browsers fall back to the
 *  in-memory store, so the SDK works everywhere (§87 offline queue). */
export function fileStore(path: string): QueueStore {
  type FsLike = { readFileSync(p: string, enc: string): string; writeFileSync(p: string, data: string): void };
  let fsMod: FsLike | null = null;
  let fsReady: Promise<void> | null = null;
  const loadFs = (): Promise<void> => {
    if (!fsReady) {
      fsReady = import('node:fs')
        .then((m) => { fsMod = (m as unknown as { default?: FsLike }).default ?? (m as unknown as FsLike); })
        .catch(() => { fsMod = null; });
    }
    return fsReady;
  };
  void loadFs();
  return {
    async load(): Promise<QueuedItem[]> {
      await loadFs();
      if (!fsMod) return [];
      try { return JSON.parse(fsMod.readFileSync(path, 'utf8')) as QueuedItem[]; } catch { return []; }
    },
    async save(items: QueuedItem[]): Promise<void> {
      await loadFs();
      if (!fsMod) return;
      try { fsMod.writeFileSync(path, JSON.stringify(items)); } catch { /* best effort */ }
    },
  };
}

export default WedjatClient;

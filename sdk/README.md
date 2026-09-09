# @wedjat/sdk

Official SDK for the **WEDJAT Intelligence API** (v4 — Knowledge-First Expansion).

Platforms use this SDK to push knowledge, events, incidents, outcomes and
feedback to WEDJAT **without ever depending on it at runtime** (master prompt
§3/§12): requests are asynchronous, idempotent, and survive WEDJAT downtime
through a local outbox.

## Install (local link)

```bash
cd sdk && npm run build
npm install ../sdk  # from any platform repo
```

## Quick start

```ts
import { WedjatClient } from '@wedjat/sdk';

const wedjat = new WedjatClient({
  baseUrl: 'https://wedjat-ai.vercel.app',
  apiKey: process.env.WEDJAT_SERVICE_KEY!,   // scoped key from WEDJAT → Intelligence → Service Identities
  platform: 'sgtx',                          // your platform slug
});

// Publish an event (idempotent — retries never duplicate knowledge)
await wedjat.event({
  eventType: 'platform.deployed',
  sourceVersion: '2.4.1',
  sourceCommit: 'a1b2c3d',
  payload: { environment: 'production', notes: 'failover hardening shipped' },
});

// Publish knowledge → flows through the full ingestion pipeline
await wedjat.knowledge({
  title: 'ADR-012 — Circuit breaker on AIS ingestion',
  content: 'We wrap the AIS stream client in a circuit breaker (5 failures/60s → open 30s)…',
  type: 'DECISION',
});

// Report an incident (CRITICAL — jumps the queue)
await wedjat.incident({ title: 'Ingestion lag', description: 'AIS consumer fell 20 min behind during failover.' });

// Report a measured outcome → closed-loop learning (§65)
await wedjat.outcome({
  outcome: 'VALIDATED',
  recommendationId: 'rec_…',
  metricName: 'p95_latency_ms',
  beforeValue: '940',
  afterValue: '310',
});

// Ask WEDJAT (grounded answers only)
const answer = await wedjat.ask('How do I improve the resiliency of SGTX?');
console.log(answer.answer, answer.sources);
```

## Guarantees (v4 spec mapping)

| Guarantee | Spec | Behavior |
|---|---|---|
| Async-first | §3/§12 | `202` acknowledgement; processing continues inside WEDJAT |
| Idempotency | §15/§58 | Stable `Idempotency-Key` per payload; duplicates return `DUPLICATE` |
| Retries | §95 | Exponential backoff + jitter on 408/429/5xx/network; honors `Retry-After` |
| Offline outbox | §12/§59 | Unreachable WEDJAT → events queued locally, delivered on `flush()` |
| Backpressure | §88 | Queue is bounded (`maxQueueSize`); overflow raises `WedjatQueueOverflowError` |
| Criticality | §89 | `CRITICAL` events are delivered before normal ones |
| Secrets | §96 | Keys held in memory only; never logged |

## Persistent outbox (Node.js)

```ts
import { WedjatClient, fileStore } from '@wedjat/sdk';

const wedjat = new WedjatClient({
  baseUrl: '…', apiKey: '…', platform: 'mtq',
  queueStore: fileStore('/var/lib/mtq/wedjat-outbox.json'),
});
```

## Scope cheat-sheet

| Method | Endpoint | Required scope |
|---|---|---|
| `event()` | `POST /api/v1/events` | `events:write` |
| `knowledge()` | `POST /api/v1/knowledge` | `knowledge:write` |
| `schema()` | `POST /api/v1/schemas` | `schema:write` |
| `feedback()` | `POST /api/v1/feedback` | `feedback:write` |
| `learningCandidate()` | `POST /api/v1/learning-candidates` | `training:candidate` |
| `incident()` / `outcome()` | `POST /api/v1/events` | `events:write` |
| `ask()` / `analyze()` | `POST /api/v1/query` / `/analyze` | `analysis:read` |

DO NOT USE OPENAI. Approved providers: Gemini, Groq, Hugging Face.

# WEDJAT v4 — Intelligence Fabric API Contract (frontend addendum)

Knowledge-first expansion (master prompt v4: **ADD, DON'T REPLACE**). This addendum
covers the NEW capabilities. All existing views/behaviors MUST remain untouched.
Every response uses the existing envelope `{ ok: true, data } | { ok: false, error: {code,message} }`
and the existing `api`/`apiPost` client helpers in `src/lib/wedjat/client.ts`.

Shared types live in `src/lib/wedjat/types.ts` (v4 section at the bottom):
`ServiceIdentityDto`, `ServiceIdentityCreatedDto`, `ApiScope`, `API_SCOPES`,
`EventEnvelopeDto`, `EventSubmitResult`, `DeadLetterDto`, `EventFabricPayload`,
`RecommendationDto`, `PatternDto`, `KnowledgeGapDto`, `TimelineEntryDto`,
`ProvenanceDto`, `MemoryInspectorPayload`, `PlatformRegistryDto`, `FabricAdminPayload`.

## 1. Admin (session-auth) endpoints — power the new "Intelligence" view

### GET `/api/fabric` → `EventFabricPayload`
Event fabric console: recent events (desc), dead letters, stats.
Query: `?platform=&type=&status=&deadletter=` (all optional filters).

### GET / POST `/api/fabric/identities`
- GET → `{ identities: ServiceIdentityDto[] }`
- POST body `{ platformSlug, name, scopes: string[] }` (ADMIN+) →
  `ServiceIdentityCreatedDto` — **`apiKey` is shown ONCE** (render in a copyable
  one-time reveal box with a "this key will not be shown again" warning).

### POST `/api/fabric/identities/[id]/rotate` (ADMIN+) → `ServiceIdentityCreatedDto`
New key issued; old key revoked at `rotatedAt`. Show the new key once.

### POST `/api/fabric/identities/[id]/revoke` (ADMIN+) → `{ revoked: true }`

### POST `/api/fabric/events/[id]/replay` (ADMIN+)
Re-dispatches one event (append-only: derived objects are re-created, event
history preserved). → `{ replayed: true, newRecordId: string }`

### POST `/api/fabric/deadletter/[id]/resolve` (ADMIN+)
Body `{ note?: string, replay?: boolean }` → `{ resolved: true }`

### GET `/api/fabric/recommendations` → `{ recommendations: RecommendationDto[] }`
Optional `?platform=&status=`.

### POST `/api/fabric/recommendations/generate` (ADMIN+)
Body `{ platformSlug?: string }` — runs evidence-based generation from existing
audit/health/drift/pattern findings. → `{ created: number, recommendations: RecommendationDto[] }`

### POST `/api/fabric/recommendations/[id]/lifecycle` (CURATOR+)
Body `{ status: ACCEPTED|REJECTED|IMPLEMENTED|PARTIALLY_IMPLEMENTED|FAILED|REVERTED|VALIDATED, note?: string }`
→ updated `RecommendationDto` (status history is append-only — render as a timeline).

### POST `/api/fabric/recommendations/[id]/outcome` (CURATOR+)
Body `{ outcome, metricName?, beforeValue?, afterValue?, notes?, commitRef?, measuredAt? }`
→ `{ recorded: true, learning: string }` (`learning` = the LESSON_LEARNED knowledge
statement the closed loop stored).

### GET `/api/fabric/patterns` → `{ patterns: PatternDto[] }`
Cross-platform reusable patterns with per-platform evidence chips.

### GET `/api/fabric/memory` → `MemoryInspectorPayload`
Timeline (learning history), open knowledge gaps, memory stats.

### GET `/api/fabric/memory/provenance?recordId=…` → `ProvenanceDto`
"Why does WEDJAT know this?" — source doc, lineage chain, events, model usage.

### GET `/api/fabric/registry` → `{ registry: PlatformRegistryDto[] }`
The 10-platform org registry (WEDJAT, CIRKLE, AURIENTA, SGTX, MTQ, JUDGE SMART,
EGYCOURT, SGTX FABLE, PPE, MTQ SIGMA) with repo/deployment/db coordinates,
connection status, knowledge coverage, last sync.

### POST `/api/fabric/registry/[slug]/connect` (ADMIN+)
Body `{ repositoryUrl?, deploymentUrl?, databaseUrl? }` — registers/refreshes
registry coordinates and marks the platform CONNECTED (status DISCOVERED→CONNECTED).
→ updated `PlatformRegistryDto`. Disconnect = POST `/disconnect` (knowledge preserved!).

### GET `/api/fabric/export` (ADMIN+) → JSON knowledge bundle download
(non-destructive export: `{ exportedAt, counts, knowledge[]… }`)

## 2. Public platform API (`/api/v1/*`) — service-identity auth

Authenticated with `Authorization: Bearer <service key>`. The admin UI shows a
read-only "API Console" tab listing these endpoints + scopes + generated curl and
`@wedjat/sdk` examples (from `GET /api/fabric` → `apiExamples`).

- `POST /api/v1/events` (events:write) — body = event envelope:
  `{ eventId?, eventType, sourcePlatform, sourceEnvironment?, sourceVersion?,
    sourceCommit?, occurredAt?, correlationId?, causationId?, schemaVersion?,
    idempotencyKey?, criticality?, payload }` → `EventSubmitResult`
  (`Idempotency-Key` header also honored; duplicates → status DUPLICATE)
- `POST /api/v1/knowledge` (knowledge:write) — `{ platform, type, title, content,
    version?, commit?, file?, section? }` → `{ knowledgeId, documentVersionId, jobId }`
- `POST /api/v1/schemas` (schema:write) — `{ platform, database, version, tables: [{name, columns:[{name,type}]}] }`
- `POST /api/v1/feedback` (feedback:write) — `{ platform, question, answer?, correction?, reason? }`
- `POST /api/v1/learning-candidates` (training:candidate) — `{ platform, taskType, input, output, evidence? }`
- `POST /api/v1/incidents` (events:write) — `{ platform, title, description, severity?, resolved? }`
- `POST /api/v1/outcomes` (events:write) — `{ platform, recommendationId?, outcome, metricName?, beforeValue?, afterValue? }`
- `GET  /api/v1/knowledge?platform=&q=` (knowledge:read)
- `GET  /api/v1/platforms/[slug]/insights` (analysis:read) — CTO-style summary
- `GET  /api/v1/platforms/[slug]/recommendations` (recommendations:read)
- `POST /api/v1/query` (analysis:read) — `{ query, platform?, mode? }` (ASK|HISTORICAL|AUDIT)
- `POST /api/v1/analyze` (analysis:read) — `{ platform, focus? }`
- `GET  /api/v1/health` — public liveness/readiness summary

## 3. Frontend requirements

Add ONE new nav entry **"Intelligence"** (icon: `Network` or `Share2` from lucide)
between existing entries — a single new view component
`src/components/wedjat/views/intelligence-view.tsx` with tabs:

1. **Overview** — fabric stats cards (events, processed/failed/dead, DLQ count,
   patterns, gaps, corrections), recent events table, criticality badges.
2. **Event Fabric** — filterable events list (platform/type/status), envelope
   detail dialog (expandable JSON payload), replay button per event, DLQ section
   with resolve/replay actions.
3. **Service Identities** — table (platform, name, key preview `••••1234`,
   scopes as badges, status, last used), create dialog (platform select from
   registry, scope multi-select, name), one-time key reveal after create/rotate,
   rotate/revoke actions with confirm dialogs.
4. **Recommendations** — list with priority badges (P0 red → P3 slate), status
   pill, evidence accordion, lifecycle action buttons (accept/reject/implemented/
   validated/reverted), "Record Outcome" dialog (before/after metric fields →
   shows the stored learning statement), "Generate" button, status-history
   timeline per recommendation.
5. **Patterns** — cards with type icon, platform chips (preserving source
   identity), evidence list, confidence bar.
6. **Memory** — learning timeline (vertical, kind icons), gaps list with
   priority + occurrences, provenance search (select a knowledge record →
   "Why does WEDJAT know this?" panel: source doc, lineage chain, events).
7. **Platform Registry** — the 10 platforms as cards/table with repo/deploy/db
   links (external), connection status badge (CONNECTED/DISCOVERED/DISCONNECTED/
   RETIRED), knowledge coverage counts, connect action.
8. **API Console** — read-only endpoint reference + scope chips + copyable curl
   and SDK snippets (from `apiExamples`).

Reuse existing shared components: `SectionHeading`, `StatCard`, `StatusBadge`,
`ScoreBar`, `EmptyState`, `PipelineStages`, source-panel, toasts (sonner),
loading skeletons, `use-api-data` hook patterns, custom scrollbar classes
(`.wedjat-scroll`), markdown prose (`.wedjat-prose`), existing theme tokens.
Long lists: `max-h-96 overflow-y-auto` with the custom scrollbar.
Role gating: identities/rotate/revoke/replay/connect/generate = ADMIN+;
recommendation lifecycle/outcome = CURATOR+; others read for all members.
Keep the emerald/teal + amber brand system and light/dark themes.
NO changes to existing views or the app shell other than adding the nav entry.
Loading/error/empty states for every tab. Toast feedback on every action.

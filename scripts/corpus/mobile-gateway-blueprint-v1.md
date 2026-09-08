# WEDJAT Mobile Gateway Blueprint — v1.0

## Business Objective
The Mobile Gateway delivers the organization's mobile experience: authentication for mobile clients, session management, API aggregation for mobile screens, and push notification delivery. Target: sub-200ms p95 response time at the edge and support for 100k concurrent mobile sessions.

## Architecture Overview
The gateway runs at the edge on Cloudflare Workers with regional colocation. Mobile clients authenticate against the Core Platform through the gateway's auth module. The gateway aggregates responses from the Core Platform and the Analytics Platform semantic layer to compose mobile screen payloads. Push notifications are delivered through a dedicated notification service.

## Technology Stack
- Edge runtime: Cloudflare Workers
- Session store: Redis (Cloudflare-managed) for mobile session tokens with 30-day sliding TTL
- API aggregation: edge-side composition with response caching
- Push delivery: Firebase Cloud Messaging and APNs
- Client API: REST with JSON

## Data Architecture
The gateway stores only session tokens and device metadata — no business data. Sessions are stored in Redis with a 30-day sliding TTL. Device metadata (device id, platform, locale) is replicated nightly to the Analytics Platform for usage analysis.

## Security Architecture
Mobile clients hold refresh tokens in the platform keystore; access tokens are short-lived JWTs issued by the Core Platform. The gateway validates access tokens at the edge using a cached JWKS. Certificate pinning is enforced by the mobile clients. Rate limiting per device is implemented at the edge.

## Integration Architecture
- Session validation: the gateway calls the Core Platform session endpoint. NOTE: the Core Platform v2.0 removed Redis and changed the session validation contract — Mobile Gateway v1.0 must consume the v2.0 read-replica contract; deployments pinned to the v1.0 Redis contract are incompatible.
- Screen aggregation: internal GraphQL API of the Analytics Platform semantic layer.
- Notifications: dedicated notification service also used by the Core Platform.

## Operational Model
Edge deployments are global and progressive (1% → 100% over 2 hours). Observability: edge logs shipped to the central telemetry pipeline with per-request trace ids. No on-call rotation of its own — escalated to the Core Platform rotation.

## Scalability
Cloudflare Workers scale automatically. Redis session store is managed and replicated. Response caching absorbs read-heavy screen traffic.

## Reliability and Known Risks
- Dependency on Core Platform session endpoint availability: if the session endpoint degrades, mobile login is blocked (HIGH risk; mitigation: extended access token TTL allows logged-in users to keep working).
- Redis session store is regional: a regional Redis outage logs out mobile users in that region (MEDIUM risk, accepted).

## Production Blockers
- Contract migration to Core Platform v2.0 session validation (must complete before Core v1.0 decommission date)

## Critical Dependencies
- Core Platform session validation endpoint (v2.0 contract)
- Analytics Platform semantic layer GraphQL API
- Notification service
- Firebase Cloud Messaging and APNs (external)

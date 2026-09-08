# WEDJAT Shared Services Catalog

## Purpose
This reference documents services shared across WEDJAT platforms, their owners, consumers, and lifecycle state. It exists to make cross-platform dependencies explicit so architecture decisions in one platform are made with full knowledge of downstream impact.

## Identity Service
- Owner: Core Platform
- Consumers: Analytics Platform (SSO, tokenization vault), Mobile Gateway (token issuance)
- Contract: SAML 2.0 for SSO, internal token issuance API, tokenization vault API
- Lifecycle: ACTIVE
- Note: any identity service change requires coordination across all three platforms.

## Kafka Event Backbone
- Owner: Core Platform (topics: orders, identity-changes, catalog-price-changes)
- Consumers: Analytics Platform (speed + batch layers)
- Contract: versioned schemas in the Core Platform schema registry
- Lifecycle: ACTIVE (replaced the RabbitMQ order queue in Core Platform v2.0)
- Note: RabbitMQ queues are being decommissioned; dead-letter queues remain until Q3 cleanup.

## Notification Service
- Owner: Core Platform (Notifications module)
- Consumers: Mobile Gateway (push), Core Platform (transactional email)
- Contract: internal queue-based delivery API
- Lifecycle: ACTIVE
- Risk: single shared instance; a defect affects both push and email channels.

## Session Validation Endpoint
- Owner: Core Platform
- Consumers: Mobile Gateway (login validation)
- Contract: v2.0 reads from the PostgreSQL read replica (the v1.0 Redis-backed contract is deprecated and incompatible)
- Lifecycle: v2.0 ACTIVE, v1.0 DEPRECATED
- Migration blocker: Mobile Gateway deployments must complete the v2.0 contract migration before Core Platform v1.0 decommission.

## Shared Recommendations (apply to multiple platforms)
1. All platforms should adopt the OpenTelemetry trace propagation standard already implemented in the Core Platform v2.0.
2. Both Analytics and Mobile Gateway should formalize dependency budget SLOs on the Core Platform services they consume.
3. Restore drills (PITR, ClickHouse replica, OpenSearch snapshots) should be scheduled as a single coordinated program across platforms rather than per-team.

## Cross-Platform Architecture Conflicts to Resolve
- Mobile Gateway still introduces Redis for sessions while the Core Platform v2.0 removed Redis to eliminate its session SPOF — the architecture board should decide whether edge session stores are an accepted exception or must migrate.
- Analytics Platform BI tier and the Core Platform reporting both produce executive revenue dashboards with slightly different numbers; ownership must be consolidated.

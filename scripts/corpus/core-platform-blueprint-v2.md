# WEDJAT Core Platform Blueprint — v2.0

## Business Objective
The Core Platform remains the transactional backbone owning customer identity, billing state, and product catalog. Version 2.0 targets 99.95% availability around the clock, regional failover capability, and a path to multi-region active-active operation within two quarters. Zero data loss for billing records remains a hard requirement.

## Architecture Overview
The modular monolith is retained, but module boundaries are now formalized with an internal event bus. The Identity, Billing, Catalog, Notifications, and Integration modules communicate through a versioned event schema registry. Read models for catalog queries are separated from the transactional schema (CQRS-lite) to decouple read scaling from write safety.

A regional failover tier is introduced: a warm-standby region receives streamed writes and can be promoted within 15 minutes. The decision to prefer warm-standby over active-active was recorded in ADR-004.

## Technology Stack
- Application runtime: Node.js 20 with Next.js
- Primary database: PostgreSQL 15 with synchronous replication to the warm-standby region
- Cache: in-process LRU cache with event-bus invalidation — the Redis cluster has been REMOVED in v2.0 to eliminate the session single point of failure identified in v1.0
- Message broker: Apache Kafka 3.6 (three brokers) replacing RabbitMQ to unify with the Analytics Platform's event backbone and gain ordered, replayable streams
- Search: OpenSearch 2 cluster introduced for catalog search

## Data Architecture
The transactional schema is unchanged from v1.0. Catalog read models are now materialized projections updated from the event bus, allowing independent scaling. Backups moved to continuous point-in-time recovery (PITR) with 7-day point-in-time restore window and cross-region snapshot copies. Data retention policy formalized: billing records kept 10 years, session data 90 days, telemetry 13 months.

## Security Architecture
Authentication still uses short-lived JWT access tokens. Version 2.0 introduces mandatory multi-factor authentication for all administrative accounts — the v1.0 audit finding is resolved. Secrets moved from environment variables to a managed secrets vault with automatic 30-day rotation. Audit logging now covers authentication, authorization, and administrative actions. Web application firewall added in front of the public edge.

## Integration Architecture
The Analytics Platform now consumes order and identity events directly from Kafka topics (replacing the RabbitMQ queue). The Mobile Gateway still validates sessions through a dedicated endpoint, but now reads session state from the Core Platform database through the read replica rather than Redis — this is a breaking change for Mobile Gateway v1.0 deployments. Payment provider integration is unchanged. Signed webhooks added for catalog price changes consumed by the Analytics Platform.

## Operational Model
On-call rotation split into application and data tiers. Deployments are fully automated through the CI pipeline with canary stages (10% traffic for 30 minutes before full rollout). Observability: OpenTelemetry-based distributed tracing is now implemented across all modules with 100% error trace sampling and 5% baseline sampling. SLO dashboards defined for availability, latency (p99 < 300ms) and error rate.

## Scalability
Application tier scales horizontally. Catalog reads scale via materialized projections. Kafka partitions provide parallel consumption for the Analytics integration. OpenSearch cluster scales independently of the transactional database.

## Reliability and Known Risks
- Kafka is now the critical event backbone: broker loss degrades event delivery; replication factor 3 mitigates single-broker failure.
- Warm-standby failover is manual today; automation is a roadmap item and a residual risk.
- OpenSearch index rebuild time after failure is measured in hours; snapshot policy added but restore is untested in production. This is a risk that increased compared to v1.0 where search ran inside PostgreSQL.

## Technical Debt
- The session validation endpoint for the Mobile Gateway still carries Redis-era response shapes (compatibility layer).
- RabbitMQ consumers must be fully decommissioned; some dead-letter queues remain.

## Production Blockers
- Automated failover runbook validation pending
- OpenSearch restore drill pending

## Critical Dependencies
- Payment provider webhooks (external)
- Kafka event backbone (shared with Analytics Platform)
- Managed secrets vault (external)
- Object storage for PITR snapshots (external)

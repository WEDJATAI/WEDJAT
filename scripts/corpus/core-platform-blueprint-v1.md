# WEDJAT Core Platform Blueprint — v1.0

## Business Objective
The Core Platform is the transactional backbone of the organization. It owns customer identity, billing state, and the product catalog that every other WEDJAT platform depends on. The platform must sustain 99.9% availability during business hours and zero data loss for billing records.

## Architecture Overview
The Core Platform is a modular monolith deployed as a single Next.js application behind a regional load balancer. The monolith is split internally into bounded modules: Identity, Billing, Catalog, Notifications, and Integration. All modules share one relational schema owned by the platform.

The decision to start with a modular monolith was made to keep operational complexity low while the product surface is still evolving. Extraction into separate services is planned once module boundaries stabilize.

## Technology Stack
- Application runtime: Node.js 20 with a Next.js frontend and Bun for tooling
- Primary database: PostgreSQL 15 (primary + streaming replica)
- Cache: Redis 7 cluster (three nodes) for session state and hot catalog reads
- Message broker: RabbitMQ 3.12 with mirrored queues for order events
- Search: PostgreSQL full-text search only; no dedicated search cluster yet

## Data Architecture
The database schema is normalized to third normal form. Billing records are append-only; corrections are stored as compensating entries. Identity data is encrypted at rest with envelope encryption using keys managed in the platform key store. Nightly logical backups are shipped to object storage with 30-day retention.

The Redis cache stores session tokens with a 24-hour TTL and catalog snapshots with a 5-minute TTL. Cache invalidation is event-driven via RabbitMQ fanout exchanges.

## Security Architecture
Authentication uses short-lived JWT access tokens (15 minutes) plus refresh tokens stored in the database. All internal service traffic is TLS-encrypted. Secrets are stored in environment variables and rotated manually every 6 months. The security audit of 2024 found that multi-factor authentication enforcement for administrative accounts is missing and must be prioritized. Audit logging covers authentication events only.

## Integration Architecture
The Core Platform exposes a REST API for the Analytics Platform (nightly batch exports) and the Mobile Gateway (session validation). An outbound integration with the payment provider uses signed webhooks. The Analytics Platform consumes order events through a RabbitMQ queue that the Core Platform publishes to.

## Operational Model
A single on-call rotation covers the platform. Deployments happen weekly through a manual checklist. Infrastructure is provisioned through Terraform but monitoring coverage is limited to host-level metrics; application-level distributed tracing is not implemented yet, which is a known observability weakness.

## Scalability
The application tier scales horizontally behind the load balancer. PostgreSQL read traffic is served by the streaming replica. Redis is expected to absorb catalog read growth. RabbitMQ queue depth is the main saturation signal used today.

## Reliability and Known Risks
- The Redis cluster is a single point of failure for sessions: if all nodes are lost, users are forced to re-authenticate. Risk accepted at current scale.
- Nightly backup cadence means up to 24 hours of data loss window for non-billing tables; billing uses synchronous replication so loss window is near zero.
- Manual secret rotation is error-prone and not tracked.

## Production Blockers
- Multi-factor authentication for admin accounts (from security audit, unresolved)
- No automated disaster recovery runbook test in the last 12 months

## Critical Dependencies
- Payment provider webhooks (external)
- Object storage for backups (external)
- RabbitMQ for Analytics Platform integration
- Redis for session validation by the Mobile Gateway

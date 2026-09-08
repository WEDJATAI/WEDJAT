# ADR-004: Regional Failover Strategy for the Core Platform

## Status
Approved

## Context
The Core Platform v1.0 operated in a single region with a single PostgreSQL streaming replica. Availability analysis during the v2.0 planning cycle showed that a full regional outage would exceed the 99.95% availability target by a wide margin. Two options were considered: active-active multi-region operation, or a warm-standby region with scripted promotion.

## Decision
We will operate a warm-standby region with synchronous replication for billing data and asynchronous replication for catalog and identity data. Promotion is a manual decision executed from a runbook with a 15-minute recovery time objective.

Active-active operation is deferred because conflict resolution for the billing schema would require a major data architecture redesign, and the organization currently lacks the operational maturity to run split-brain scenarios safely.

## Consequences
- RPO for billing data is zero (synchronous replication); RPO for identity and catalog data is up to 60 seconds.
- RTO is 15 minutes, gated on human decision.
- The failover runbook must be validated by drill at least twice a year.
- We accept the single-writer limitation for the transactional core.

## Related
- Core Platform Blueprint v2.0 (Reliability and Known Risks)
- Security Audit 2025 (disaster recovery finding)

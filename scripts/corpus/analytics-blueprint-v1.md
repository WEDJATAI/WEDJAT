# WEDJAT Analytics Platform Blueprint — v1.2

## Business Objective
The Analytics Platform delivers product usage insight, revenue reporting, and ML-driven churn prediction to the organization. It must ingest events from the Core Platform with end-to-end latency under 5 minutes for dashboards and under 24 hours for the data warehouse loads. The platform is a revenue-critical decision surface for the executive team.

## Architecture Overview
The platform is a classic lambda architecture: a speed layer for near-real-time dashboards and a batch layer for the warehouse. Events arrive from the Core Platform Kafka backbone (topics: orders, identity-changes, catalog-price-changes). A stream processor maintains real-time aggregates in ClickHouse. Nightly jobs load curated datasets into Snowflake for the warehouse layer, dbt models transform them, and a semantic layer serves reporting.

## Technology Stack
- Stream processing: Kafka consumers on Node.js workers (shared event backbone with the Core Platform v2.0)
- Speed layer store: ClickHouse 23
- Batch warehouse: Snowflake
- Transformation: dbt
- BI: embedded dashboards served by the application tier
- Application runtime: Bun server

## Data Architecture
Event schemas are consumed from the Core Platform schema registry. ClickHouse holds 90 days of raw events and real-time aggregates. Snowflake holds 5 years of curated history with time-travel enabled. PII columns are tokenized at ingestion; the token vault is managed by the Core Platform identity service. Churn prediction features are computed nightly and stored in Snowflake.

## Security Architecture
Access to raw event data requires the analytics-admin role. Warehouse access is row-filtered by organization unit. The platform relies on the Core Platform identity service for SSO through SAML. Audit logging for warehouse queries is enabled with 6-month retention. No dedicated WAF exists for the analytics endpoints because they are internal-only — this decision is documented and accepted by security review.

## Integration Architecture
Inbound: Kafka topics from the Core Platform. Signed webhooks for catalog price changes are also consumed. Outbound: the semantic layer exposes an internal GraphQL API for internal consumers, and executive dashboards are exported nightly to the shared workspace.

A dependency risk exists: the Analytics Platform's RabbitMQ consumer from the Core Platform v1.0 era was decommissioned after the Core Platform moved to Kafka. Any rollback of the Core Platform to v1.0 would break analytics ingestion; this cross-platform coupling is tracked as an architectural risk.

## Operational Model
Business-hours support with automated alerting on pipeline freshness SLOs. Deployments are daily through an automated CI pipeline. Data quality tests run after each dbt model build; failures page the data on-call.

## Scalability
Kafka consumer groups scale per partition. ClickHouse scales vertically with replication. Snowflake warehouses auto-suspend and auto-resume with dedicated warehouse sizes per team. The semantic layer caches aggressively.

## Reliability and Known Risks
- Single Kafka consumer group for identity events: a poison message stalls the pipeline (HIGH risk, mitigation planned).
- ClickHouse replication exists but restore-from-replica is untested (MEDIUM risk).
- Churn model retraining depends on a manual notebook run today; drift is not monitored automatically (MEDIUM risk).

## Performance Review Notes (from 2025 review)
Dashboard p95 latency regressed to 4.1s during peak morning load; recommendation to add materialized rollup tables and increase ClickHouse cache. Ingestion pipeline end-to-end latency is currently 3m40s median, within the 5-minute target but with a thin margin during replay scenarios.

## Production Blockers
None currently open; performance remediation is in progress.

## Critical Dependencies
- Core Platform Kafka event backbone
- Core Platform identity service for SSO and tokenization vault
- Snowflake (external)
- ClickHouse cluster

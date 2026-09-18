---
title: "WASL Database Intelligence — deep probe of the live production database"
docType: REFERENCE
jurisdiction: GLOBAL
sources:
  - https://github.com/cirkle-superapp/wasl
  - https://cirkle-wasl.vercel.app
---

# WASL Database Intelligence — Deep Probe (§34/§35)

Measured facts from a read-only introspection of WASL's **live production Turso
database** (`libsql://wasl-fortleem.aws-us-east-1.turso.io`), performed by WEDJAT
on **2026-09-18**. Method: `sqlite_master` DDL parsing + `COUNT(*)` per table +
safe aggregate distributions (enum breakdowns, boolean ratios, activity
windows). Message content, usernames, emails and every user-identifying field
were deliberately **never extracted** — counts and enum values only.

## Data-store landscape (all measured)

| Store | Coordinate | Status (2026-09-18) |
|---|---|---|
| Turso (libSQL) | `libsql://wasl-fortleem.aws-us-east-1.turso.io` | **LIVE — 36 tables, 95 rows** (the production database) |
| Neon Postgres | `ep-blue-unit-auo5i1kj…neon.tech/WASL` (PostgreSQL 18.6) | **EMPTY — 0 tables** in schema `public` (provisioned, never used) |
| Cloudflare R2 | account `dfe16d9c…` (S3 API) | **R2 not enabled** — 0 buckets on the account (credentials provisioned, service never activated) |
| Vercel | `cirkle-wasl.vercel.app` | Deployment live (HTTP 200) |

The application is 100% database-served by Turso; file uploads use the local
filesystem (per README "Tech Stack — File uploads: local filesystem").

## Measured database state

- **Tables**: 36 (application models; no `sqlite_%`/`_cf_%` internals)
- **Total rows**: 95 — a young production dataset
- **Top tables by rows**: Message=47, User=18, PhoneNumber=10, Participant=10,
  Conversation=3, Reaction=2, plus singletons: Commit, MessageEdit,
  DisappearingSetting, StarredMessage, Thread

### Enum distributions (production data)

| Field | Measured values |
|---|---|
| `Message.type` | text=44, system=2, commit=1 |
| `Message.status` | read=28, sent=19 (no pending/delivered-only) |
| `Message.protected` | null=33 (inherit sender default), false=14, true=0 |
| `Conversation.isGroup` | group=2, direct=1 |
| `Commit.status` | pending=1 |
| `Commit.type` | price=1 |
| `Commit.currency` | SAR=1 |
| `Commit.counterpartySigned` | false=1 (awaiting counterparty signature) |
| `User.verified` | false=10, true=8 |
| `User.ghostMode` | false=18 (feature unused) |
| `User.defaultProtectMessages` | false=18 (feature unused) |

### Scalar aggregates

| Metric | Value |
|---|---|
| users.total | 18 (6 customized their `about` beyond the default) |
| phonenumbers.total | 10 (multi-phone feature in use) |
| messages.total | 47; avg text length 31 chars; edited=1; pinned=1; AI transcriptions=0 |
| business.total | 0 — the entire business layer (Business, BusinessMember, BusinessGroup) is **built but unused** |
| stories / polls / broadcast channels / time capsules / whisper messages / receipt splits / scheduled messages | all 0 rows |
| threads.total | 1 (threaded replies experimentally used) |
| reactions.total | 2; drafts.total = 1 |

### Activity windows (timestamps only)

- `Message.createdAt`: 2026-09-12 → 2026-09-16
- `User.createdAt`: 2026-09-11 → 2026-09-12 (one-day signup cohort)
- Commit/Business windows: absent (≤1/0 rows)

## What this means (interpretation, clearly separated from measurement)

WASL is a **fully-built feature platform running on a seed/demo dataset**: the
schema implements ~40 models of modern messaging (see the WASL Data-Domain
Encyclopedia), but production usage so far is a single-day cohort of 18 users
exchanging 47 short text messages in 3 conversations, with one pending
Commit. The empty tables are honest capability gaps in *usage*, not in
*implementation* — every model exists, is indexed, and is wired into the app.

## Provenance

- Repository state probed at commit `a783955` ("audit: business chat
  comprehensive audit + worklog update").
- Probe tooling: `scripts/probe-wasl-db.ts` (WEDJAT repo) — read-only, secrets
  from gitignored env, never printed.
- The companion document "WASL Database Snapshot — tables, row counts &
  schema" (same blueprint) carries the generic per-table schema inventory
  produced by the automated §34 platform probe.

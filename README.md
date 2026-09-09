# WEDJAT DOMAIN AI

Proprietary domain-intelligence platform: versioned knowledge graph, grounded RAG chat over
your platform estate, and the **Automatic Platform Database Intake Engine** — upload any
platform database (SQLite / SQL dump / CSV / JSON / JSONL) and it is auto-detected, analyzed,
mapped to canonical entities, validated, imported, indexed for RAG, expanded into the knowledge
graph, and turned into gated training candidates. Zero manual mapping.

```
Organization → Platform → Blueprint → Version → Document → Section → Chunk → Knowledge
```

## Stack

Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 + shadcn/ui · Prisma ORM on
libSQL/Turso · in-process RAG (chunking → embeddings → hybrid retrieval → rerank) ·
multi-provider inference gateway with circuit breakers · audit + observability plane.

## Quick start (local)

```bash
bun install
bun run db:generate && bun run db:push
bun scripts/seed.ts && bun scripts/seed-intake.ts
bun run dev        # http://localhost:3000 — owner@wedjat.ai / wedjat
```

## Deploy (Vercel + Turso)

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for the full runbook
(Turso migration script, Vercel env vars, serverless design notes).

## Documentation

| Doc | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design & data model |
| [docs/API_CONTRACT.md](docs/API_CONTRACT.md) | All endpoints & DTOs |
| [docs/RAG_ARCHITECTURE.md](docs/RAG_ARCHITECTURE.md) | Retrieval pipeline |
| [docs/TRAINING.md](docs/TRAINING.md) | Training lifecycle & gates |
| [docs/SECURITY.md](docs/SECURITY.md) | Auth, tenancy, redaction |

WEDJAT DOMAIN AI v1.0 — Proprietary & Confidential.

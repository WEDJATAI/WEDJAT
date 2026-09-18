---
title: "EGYCOURT Platform Overview — Egyptian Judicial Brain architecture and product"
docType: REFERENCE
jurisdiction: Egypt
sources:
  - https://github.com/egycourt/egycourt
---

# EGYCOURT — Egyptian Judicial Brain (Platform Overview)

EGYCOURT is an **Arabic-first judicial intelligence workbench for authorized
Egyptian judges and rapporteurs**, built around verified sources, temporal
awareness, adversarial review, and judge-controlled findings. This overview is
compiled from the private repository `egycourt/egycourt` (pnpm monorepo, HEAD
`88bb5e82`, 2026-08-28; ~438MB working tree).

## Mission & operating principles (from the repo's own docs)

- AI output is presented as **reviewable analysis** — it never becomes a
  judicial finding automatically.
- The pilot uses **source-grounded, typed case data** and explicit
  support/contrary authority direction rather than a generic chatbot.
- The frontend carries a clearly-labeled **demo-safe fallback** when the API
  is unavailable, so reviewability never hides operational status.
- Official-source-first legal corpus policy: *no source is authoritative until
  verified and versioned*.

## Architecture (measured from the workspace)

| Layer | Implementation |
|---|---|
| Monorepo | pnpm workspaces, Node 24, TypeScript 5.9, strict typecheck gate |
| API | Express 5, port 5000 (`artifacts/api-server`) |
| Database | PostgreSQL + Drizzle ORM (`lib/db`) — schema package exists but **no tables defined yet** (placeholder) |
| Validation | Zod v4 + drizzle-zod; OpenAPI contract (`lib/api-spec/openapi.yaml`) is the source of truth, codegen via Orval into React query hooks (`lib/api-client-react`) and Zod schemas (`lib/api-zod`) |
| UI | Vite + React Arabic RTL workbench (`artifacts/egyptian-judicial-brain`) with a full shadcn/ui component set + `mockup-sandbox` design playground |
| Legal corpus | `legal-corpus/` — source registry + verified snapshots (see companion document) |
| Runtime | Replit project (replit.md); no public Vercel deployment; API serves typed demo data pending the DB schema |

## API surface (OpenAPI paths)

- `GET /healthz` — health
- `GET /judicial/dashboard` — active cases, pending reviews, verified sources
  count (demo: 2,847), attention items, recent activity feed
- `GET /judicial/cases` — searchable case list (number, title, chamber,
  stage, risk, tags)
- `GET /judicial/cases/{caseId}` — full case workspace payload (see the
  Judicial Workbench Model document)

## Ecosystem position

EGYCOURT completes the WEDJAT-tracked 12-platform ecosystem as the **legal
intelligence pole**: where WASL handles verified commitments between private
parties and JUDGE-SMART tracks legal KPIs, EGYCOURT targets the judicial
workbench itself — case-level reasoning support for Egyptian courts, in
Arabic, with authority verification.

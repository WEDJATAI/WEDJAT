---
title: "EGYCOURT Judicial Workbench Model — case workspace data contract"
docType: REFERENCE
jurisdiction: Egypt
sources:
  - https://github.com/egycourt/egycourt
---

# EGYCOURT Judicial Workbench Model — the case workspace contract

The typed data model behind the Egyptian Judicial Brain's case workspace,
extracted from `artifacts/api-server/src/routes/judicial.ts` and the
OpenAPI-derived Zod schemas (`lib/api-zod`). The API currently serves one
fully-worked Arabic demo case (commercial-supply dispute ١١٨ لسنة ٢٠٢٤) that
exercises every field of the contract.

## Case list entry

`number` (Arabic numerals, e.g. ١١٨ لسنة ٢٠٢٤), `title`, `chamber`
(e.g. الدائرة التجارية الثانية / دائرة التعويضات / State Council chamber),
`stage` (analysis | review | hearing), `risk` (high | low), `updatedAt`
(relative Arabic time), `tags` (e.g. عقود، تعويضات، إداري).

## Case workspace payload (GET /judicial/cases/{caseId})

- **summary** — Arabic narrative of the dispute (the demo case: a government
  supply contract dated ١٥ يناير ٢٠٢٤, delayed first delivery by 18 days,
  penalty-clause entitlement contested, force-majeure defense pending,
  e-mail correspondence as proof of formal notice under examination).
- **facts[]** — each with `id`, `text`, `status`
  (verified | disputed), `source` citation with page (e.g. "العقد — ص ٣").
- **evidence[]** — `name`, `kind` (مستند / دليل رقمي / مستند رسمي),
  `status` (verified | review), `pages`.
- **issues[]** — `title`, `state` (open | contested | supported), `note`
  (e.g. matching clause ٨ text against correspondence; force-majeure
  impossibility standard; penalty-clause reduction scope).
- **authorities[]** — `citation` (e.g. القانون المدني — م ٢١٥; طعن مدني
  ١٢٣٤ لسنة ٧٥ ق), `title`, `force` (نص تشريعي = statutory text | مبدأ
  قضائي = judicial principle), `temporal` (ساري — ٢٠٢٤ / لاحق — ٢٠١٦ /
  مقارن — ٢٠٠٩), and crucially `direction`: **support | contrary** —
  contrary authority is surfaced, never hidden.
- **integrity[]** — the adversarial-review checklist, each with `state`
  (passed | attention): citation integrity (٣/٣ sources linked), current
  legal version verified (as of ٢٢ أغسطس ٢٠٢٦), substantive-defense coverage
  (force-majeure needs explicit answer), evidence-fact consistency (e-mail
  under review).

## Dashboard aggregates

`activeCases`, `pendingReviews`, `verifiedSources` (2,847 in demo), plus
`recentActivity[]` typed source/case/alert/review events in Arabic.

## Design rules encoded in the contract

1. **Judge-controlled findings**: everything above is *analysis input*; the
   finding/reasoning/draft areas belong to the judge, never auto-generated.
2. **Temporal awareness**: every authority carries currency metadata
   (ساري/لاحق/مقارن) and the integrity checklist re-verifies the "current
   legal version" date.
3. **Adversarial completeness**: contrary authority and attention-state
   checklist items are first-class fields — the system is designed to expose
   what weakens the analysis.
4. **Page-level citation**: facts cite source + page (ص), ready for
   courtroom verification.

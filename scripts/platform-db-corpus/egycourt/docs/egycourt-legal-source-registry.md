---
title: "EGYCOURT Legal Source Registry — verified official Egyptian legal sources"
docType: REFERENCE
jurisdiction: Egypt
sources:
  - https://github.com/egycourt/egycourt
  - https://www.presidency.eg
  - https://register.cc.gov.eg/legislations
  - https://www.sccourt.gov.eg
  - https://esc.gov.eg
  - https://moj.gov.eg
---

# EGYCOURT Legal Source Registry — official Egyptian legal sources

Compiled from `legal-corpus/source-registry.json` (schemaVersion 1.0,
generated 2026-08-23) in the private `egycourt/egycourt` repository. The
registry is EGYCOURT's canonical list of verified Egyptian legal sources under
the policy: **"Official-source-first; no source is authoritative until
verified and versioned."**

## The registry (8 sources)

| ID | Title (Arabic) | Tier | Type | URL |
|---|---|---|---|---|
| constitution-presidency | الدستور المصري (Egyptian Constitution) | مصدر حكومي رسمي (official government source) | constitution | presidency.eg |
| legislation-register | بوابة التشريعات المصرية (Egyptian Legislation Portal) | بوابة تشريعات رسمية (official legislation portal) | legislation | register.cc.gov.eg/legislations |
| cassation | محكمة النقض المصرية (Court of Cassation) | جهة قضائية رسمية (official judicial authority) | judgments | cc.gov.eg |
| constitutional-court | المحكمة الدستورية العليا (Supreme Constitutional Court) | جهة قضائية رسمية | constitutional | sccourt.gov.eg |
| state-council | مجلس الدولة المصري (State Council) | جهة قضائية رسمية | administrative | esc.gov.eg |
| state-lawsuits | هيئة قضايا الدولة (State Lawsuits Authority) | هيئة قضائية رسمية (official judicial body) | state-litigation | sla.gov.eg |
| economic-courts | التقاضي الإلكتروني للمحاكم الاقتصادية (Economic Courts e-Litigation) | منصة قضائية رسمية (official judicial platform) | economic | elec.eecourts.gov.eg |
| justice-ministry | وزارة العدل المصرية (Ministry of Justice) | جهة حكومية رسمية (official government authority) | ministry | moj.gov.eg |

## Verified snapshots (legal-corpus/snapshots/)

Five sources carry archived markdown snapshots (retrieved 2026-08-23), each
stamped with Source ID, tier, URL, retrieval date, and the explicit caution
**"Snapshot only; verify against canonical source before legal reliance"**:

- `cassation.md` — Court of Cassation portal (news, Supreme Judicial Council,
  login services)
- `constitution-presidency.md` — presidency.eg constitution pages
- `constitutional-court.md` — Supreme Constitutional Court portal
- `state-council.md` — State Council portal
- `state-lawsuits.md` — State Lawsuits Authority portal

## Why this registry matters to WEDJAT's ecosystem

This is a machine-verifiable map of Egypt's **primary legal authority
hierarchy** — the same jurisdiction WEDJAT's trade-compliance corpus treats
as its deepest country guide (Egypt customs/ACID/NAFEZA) and the same
authoritative tier JUDGE-SMART measures. Trade disputes in Egypt terminate in
exactly these courts: the Court of Cassation (نقض) for civil/commercial
matters, the State Council (مجلس الدولة) for administrative/customs
decisions, the Economic Courts for commercial fraud/IP — all reachable
through the portal coordinates above.

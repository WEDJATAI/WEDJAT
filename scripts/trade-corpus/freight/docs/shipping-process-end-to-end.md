---
title: "Ocean Shipping End-to-End Process — Export and Import Flows"
docType: SPEC
domain: freight
category: operations
jurisdiction: GLOBAL
sources:
  - https://trirouteshipping.com
  - https://www.searates.com/blog/post/top-10-hidden-costs-in-ocean-freight
  - https://en.wikipedia.org/wiki/Incoterms
---

# Ocean Shipping End-to-End Process — Export and Import Flows

The ocean freight process runs through interconnected steps from booking to final delivery. The export flow below mirrors the import flow in reverse; each step maps to documents in this corpus.

## Export flow (shipper's side)

| # | Step | Documents/actions | References |
| --- | --- | --- | --- |
| 1 | **Quotation & trade terms** | Rate enquiry with POL/POD, commodity, volume; agree Incoterm (2020) | Incoterms reference |
| 2 | **Sales/purchase contract & payment setup** | Commercial terms; documentary credit if used (credit terms drive document requirements) | Documentary credit reference |
| 3 | **Cargo preparation** | Product certification as required: CO, phytosanitary/veterinary, conformity CoC, licences | Country guides; certificate references |
| 4 | **Booking** | Booking request → carrier's booking confirmation with booking number + cut-offs | Booking reference |
| 5 | **Export haulage & gate-in** | Trucking to port; VGM obtained (Method 1/2) and filed before VGM cut-off; container gate-in before CY cut-off | VGM reference |
| 6 | **Export customs clearance** | Export declaration lodged (single window/agent); licences cited; customs release | Customs country guides |
| 7 | **Shipping instructions & B/L** | SI submitted before doc cut-off → draft B/L → issue (originals/waybill/telex/eB/L) | SI and B/L references |
| 8 | **Loading & sailing** | Container loaded, on-board; manifest data to customs (advance filing for destination regimes — ISF/ENS) | Cargo manifest reference |
| 9 | **Transit** | Insurance in force per Incoterm; reefer monitoring; documents couriered/presented (under credit, to the bank) | Insurance reference |

## Import flow (consignee's side)

| # | Step | Documents/actions | References |
| --- | --- | --- | --- |
| 1 | **Pre-arrival** | Carrier's arrival notice; import customs pre-filing where the regime requires (ENS/ISF on the export side; import declarations pre-arrival) | Arrival notice reference |
| 2 | **Import clearance** | Import declaration (HS classification, valuation from invoice), duties/VAT paid, licences/permits, conformity certificates | Customs country guides |
| 3 | **Release & delivery order** | Original B/L surrendered (or telex/waybill identity); freight & charges settled; D/O issued | B/L types; D/O reference |
| 4 | **Pickup within free time** | Terminal gate-out; demurrage clock stops, detention clock starts on leaving | Container terminals reference |
| 5 | **Delivery & unpack** | On-carriage to buyer's premises; unload; return empty before detention free time expires; inspection/claims if damaged | Freight charges reference |

## Roles and interfaces

- **Exporter/shipper**: cargo prep, origin docs, SIs, VGM, export clearance (per Incoterm).
- **Carrier**: booking, transport, B/L issuance, manifests, arrival notice, release.
- **Forwarder/NVOCC**: coordinates the chain; issues house documents (FIATA family).
- **Customs broker**: declarations both ends.
- **Banks**: documentary-credit examination (UCP 600).
- **Insurer**: cargo cover per Incoterm (ICC A/B/C).

## Timeline discipline

The cut-off chain (SI → VGM → CY → customs) and the free-time chain at destination are the two clocks that cause most avoidable cost: plan cargo readiness, document data quality and customs pre-clearance against them.

Provenance: synthesized from the cited references and the document references in this corpus.

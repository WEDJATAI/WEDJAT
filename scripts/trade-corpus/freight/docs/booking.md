---
title: "Booking Confirmation — Ocean Booking Process and Booking Number"
docType: REFERENCE
domain: freight
category: encyclopedia
jurisdiction: GLOBAL
sources:
  - https://www.freightos.com
  - https://www.icontainers.com
  - https://en.wikipedia.org/wiki/Charter_party
---

# Booking Confirmation — Ocean Booking Process and Booking Number

The **booking** is the contract of carriage for a liner shipment, concluded when the carrier accepts the shipper's booking request and issues a **booking confirmation** (booking note). It fixes the ship, equipment and cargo details for the shipment; the bill of lading later evidences the same contract at loading.

## Booking request → confirmation flow

1. The shipper/forwarder requests a quotation (rate, validity, surcharges, transit time).
2. The shipper submits a **booking request**: ports (POL/POD), commodity, HS code if known, container type and count, cargo weight/volume, hazardous status, Incoterm, required shipping window.
3. The carrier allocates space and equipment and returns the **booking confirmation** including the **booking number** (container/art) — the key reference quoted on all documents and EDI messages for the shipment.
4. Any change (rollover, equipment substitution, port pair change) re-issues or amends the confirmation.

## What the booking confirmation contains

| Field | Typical content |
| --- | --- |
| Booking number | Carrier's unique reference for the shipment |
| Vessel / voyage | Assigned vessel name and voyage number (subject to change/rollover) |
| POL / POD | Port of loading and port of discharge |
| Equipment | Container size/type and quantity (e.g. 1 × 40HC) |
| Commodity & HS | Description and Harmonized System code if supplied |
| Shipper / consignee | Parties (may differ on the eventual B/L) |
| Cargo deadlines | Document cut-off (shipping instructions), VGM cut-off, CY gate-in cut-off |
| Service terms | Whether freight prepaid or collect, service contract/quotation reference |

A booking confirmation serves as a receipt for the main shipment leg (ocean or air) and includes the booking number, equipment used (size and numbers), ports, and dates.

## Key deadlines set at booking

- **Shipping instructions (SI) cut-off** — the deadline for submitting B/L instructions before the vessel.
- **VGM cut-off** — the deadline for the verified gross mass (SOLAS VI/2; see the VGM reference).
- **CY cut-off / gate-in cut-off** — the last moment the loaded container can enter the container yard before loading.

## Booking in tramp vs liner context

In tramp (non-scheduled) shipping the equivalent instrument is the **charter party** (voyage or time charter), with loading/discharging terms, laytime and demurrage agreed contractually. Liner bookings incorporate the carrier's standard terms and tariff instead.

## Practice notes

- Quote the booking number on the packing list, VGM, and gate-in documents.
- Rollovers (vessel full) and equipment shortages are common; confirm the latest confirmation before gating in.
- Dangerous-goods bookings require declaration data (IMDG class, UN number, packaging group) at booking stage, not later (see the Dangerous goods documents reference).

Provenance: synthesized from the cited references; carrier booking terms vary — the confirmation's own terms govern.

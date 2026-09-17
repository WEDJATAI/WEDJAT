---
title: "Maersk — Carrier Profile and Documentation Requirements"
docType: REFERENCE
domain: freight
category: carrier
jurisdiction: GLOBAL
sources:
  - https://en.wikipedia.org/wiki/Maersk
  - https://www.maersk.com/support/faqs/how-to-submit-shipping-instructions
---

# Maersk — Carrier Profile and Documentation Requirements

## Carrier overview

**A.P. Moller–Maersk** (Maersk) is an integrated Danish shipping and logistics company based in **Copenhagen, Denmark**, with subsidiaries and offices across **130 countries** and over **100,000 employees** (2024). Maersk Line — the largest operating unit by revenue and staff — described itself in 2013 as the world's largest overseas cargo carrier with over **600 vessels** and **3.8 million TEU** capacity; as of January 2021 its container fleet held **17% of global TEU**. The group's activities include port operation, supply chain management, warehousing and air freight (an integrated logistics strategy beyond pure liner shipping).

## Documentation requirements (standard ocean set)

| Document | Maersk practice |
| --- | --- |
| Booking confirmation | Issued per booking request (portal/EDI), states booking number, vessel/voyage, cut-offs |
| Shipping instructions | Submitted via Maersk.com portal (the support FAQ "How do I submit my shipping instructions" documents portal submission), EDI, or e-mail; drives the draft B/L workflow |
| Bill of lading | Issued as original negotiable, sea waybill, or telex release per SI election |
| VGM | Submitted per SOLAS VI/2 through the portal/EDI before the VGM cut-off (see the VGM reference) |
| Dangerous goods | IMDG declaration data required at booking stage; DGD + SDS to be provided per the Dangerous goods reference |
| Arrival notice / D/O | Destination office issues arrival notices to consignee/notify parties; release against originals, telex, or waybill identity |

## Shipping instructions process

1. Book (portal/API/EDI or through a forwarder).
2. Submit SIs in the portal before the documentation cut-off; the carrier validates against the booking.
3. Review the **draft B/L** in the portal; confirm to trigger issuance.
4. Elect document form: originals (courier), **telex release** (surrender at origin), or electronic transfer where available (see the Electronic bill of lading reference).

## Charges and free time

Maersk publishes demurrage/detention tariffs per location: **free time** defines the number of days a container can be used free of charge; beyond it, demurrage (inside port) and detention (outside port) apply with escalating daily rates — schedule pickups and customs clearance to clear before free time expires. Destination charge lists are published per port on the carrier's portal.

## Digital services

Maersk operates an extensive self-service portal (booking, SI submission, draft-B/L confirmation, VGM filing, tracking) and publishes country-specific import/export guides through maersk.com. Group digital brands have historically included Twill (forwarding) and Captain Peter (reefer visibility).

## Notes for shippers

- One of the founders (with Hapag-Lloyd) of the **Gemini Cooperation** operational network (from February 2025).
- Verify local documentation requirements (e.g., chamber-certificate rules, conformity schemes) against the destination-country guide in this corpus.

Provenance: company facts from the cited references; operational practice per the general freight-document references in this corpus plus the carrier's published portals.

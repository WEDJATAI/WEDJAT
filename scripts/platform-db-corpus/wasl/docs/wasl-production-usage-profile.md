---
title: "WASL Production Usage Profile — what the live data says is used vs dormant"
docType: REFERENCE
jurisdiction: GLOBAL
sources:
  - https://github.com/cirkle-superapp/wasl
  - https://cirkle-wasl.vercel.app
---

# WASL Production Usage Profile — measured usage vs dormant capability

Derived exclusively from the 2026-09-18 read-only probe of the live Turso
database (see "WASL Database Intelligence — deep probe"). Every number below
is measured; interpretation is marked as such.

## Adoption profile

| Capability (schema-implemented) | Production usage (measured) | Verdict |
|---|---|---|
| Core messaging (User/Conversation/Participant/Message) | 18 users, 3 conversations, 47 messages | **ACTIVE** |
| Read receipts (Message.status, Participant.lastReadAt) | read=28 / sent=19 | ACTIVE |
| Multi-phone numbers (PhoneNumber) | 10 numbers across 18 users | ACTIVE |
| Group conversations | 2 groups vs 1 direct | ACTIVE |
| Cirkle Commitments (Commit) | 1 pending price-type Commit, SAR, counterparty unsigned | **PILOT** |
| Message edits / pinning | 1 edited, 1 pinned | PILOT |
| Threaded replies (Thread/ThreadMessage) | 1 thread | PILOT |
| Reactions | 2 | PILOT |
| Drafts | 1 | PILOT |
| Disappearing messages (DisappearingSetting) | 1 conversation configured | PILOT |
| Identity verification (User.verified) | 8 of 18 users verified | ACTIVE |
| Business accounts (Business*) | 0 rows | **DORMANT** |
| Stories, Polls, Broadcast channels, Time capsules, Whisper messages, Receipt splits, Scheduled messages | 0 rows | DORMANT |
| Privacy hardening (ghostMode, defaultProtectMessages, protected messages) | 0 users enabled; protected=null on 33 msgs / false on 14 | DORMANT |
| AI voice transcription (Message.transcription) | 0 transcribed | DORMANT |

## Message composition (measured)

- Type mix: text 94% (44/47), system 4% (2/47), commit 2% (1/47); image/voice/
  poll messages: 0.
- Average text-message length: **31 characters** (short-chat pattern).
- Read ratio: 60% read / 40% sent-only at probe time.

## Activity timeline (measured, timestamps only)

- Signups: one cohort concentrated 2026-09-11 → 2026-09-12.
- Message activity: 2026-09-12 → 2026-09-16 (4-day active window, then quiet).
- No user identifiers, message content, or media were extracted by the probe.

## Interpretation (clearly separated from measurement)

WASL is in **demo/pilot stage**: the platform's engineering surface (40
models, AI router, Socket.io, PWA, business verification queue) is far ahead
of its organic usage. The single Commit record — pending, price type, SAR,
counterparty signature awaited — matches the "AI-verified agreements" pilot
flow described in the README. For WEDJAT's ecosystem view: WASL contributes a
mature *capability map* and a young *data footprint*; any cross-platform
analysis should treat WASL's business/broadcast/ephemeral features as
designed-not-adopted.

## Provenance

- Live Turso instance `libsql://wasl-fortleem.aws-us-east-1.turso.io`,
  probed read-only 2026-09-18 (counts and enum distributions only).
- Repository `cirkle-superapp/wasl` @ `a783955` for the capability map.

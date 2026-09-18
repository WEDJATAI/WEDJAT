---
title: "WASL Data-Domain Encyclopedia — the 40-model messaging schema as domain knowledge"
docType: REFERENCE
jurisdiction: GLOBAL
sources:
  - https://github.com/cirkle-superapp/wasl
  - https://cirkle-wasl.vercel.app
---

# WASL Data-Domain Encyclopedia — the 40-model messaging schema

Domain knowledge compiled from the WASL production Prisma schema
(`prisma/schema.prisma`, 833 lines, 40 models, SQLite/Turso provider) at commit
`a783955`. WASL is a WhatsApp-class real-time messenger with Cirkle-ecosystem
extensions (AI-verified commitments, business accounts, broadcast channels).
This document explains the data model as a referenceable domain map.

## 1. Identity & account domain

- **User** — username-unique identity with password, name, email, phone,
  `about` (default "Hey there! I am using Wasl."), avatar + avatarColor,
  presence (`online`, `lastSeen`), identity verification (`verified`,
  `idDocPath`, `verifiedAt`), and privacy switches: `defaultProtectMessages`,
  `privacyAlwaysAllow`, `ghostMode`, `hideLastSeen`.
- **PhoneNumber** — the multi-phone feature: multiple numbers per user, each
  with `label` and an `active` flag; the active number is stamped on every
  message (`Message.fromPhone`) for display provenance.
- **Contact** — user-to-user address book entries.

## 2. Conversation & message core

- **Conversation** — direct or group (`isGroup`), name/avatar/avatarColor/
  description, `createdBy`, `inviteToken` for group invites.
- **Participant** — membership with `joinedAt`, `lastReadAt` (read-receipt
  watermark), `muted`, `archived`.
- **Message** — the core record: `content`, `type`
  (text|image|system|commit|voice|poll), `status` (sent→delivered→read),
  `replyToId` threading, `commitId` link when the message *is* a Commit,
  business display override (`senderLabel`, `senderLabelColor`,
  `senderAvatarPath` — display-only, senderId stays the real user), privacy
  `protected` tri-state (null → inherit sender default), `edited`,
  `pinned` (one pinned message per conversation), and `transcription`
  (AI-generated voice-note transcription, populated by
  POST /api/ai/transcribe).
- **MessageEdit** — append-only history of edited message versions.
- **DeletedForMe** — per-user visibility removal without affecting other
  participants.
- **ForwardRequest** — forwarding bookkeeping.
- **Draft** — per-user conversation drafts.
- **Reaction / StarredMessage / Bookmark** — engagement layer (emoji
  reactions; star = pin to personal list; bookmark = save-for-later).

## 3. Cirkle-style Commitments (the flagship extension)

**Commit** — an in-conversation enforceable agreement between exactly two
parties:

- `type`: price | work | service | rental | group_buy
- `title`, `description`, `amount` + `currency` (default SAR), optional
  `deadline`, JSON-encoded `conditions` (string[])
- **Lifecycle**: `status` pending → active → completed | disputed
- **AI verification**: `fairnessScore` 0–100 + `fairnessNote` (the AI
  router scores agreement fairness)
- **Signing**: `creatorSigned` (default true) + `counterpartySigned` with
  separate signed-at timestamps; a Commit becomes binding when both sign
- `hash` — content hash for tamper evidence
- When created, a `type='commit'` Message is inserted and linked via
  `Message.commitId`.

## 4. Privacy & protection systems

- **DisappearingSetting** — per-conversation `enabled` + `duration`.
- **WhisperMessage** — ephemeral messages that expire (`expiresAt`) and track
  `read`.
- **ScreenshotAttempt** — logged attempts to screenshot protected messages.
- **AppLock** — app-level lock configuration.
- `Message.protected` blocks screenshot/forward for protected messages.

## 5. Business layer

- **Business** — business account with `status`
  (pending → approved | rejected) admin-review queue, `rejectionReason`,
  document uploads (`registrationDocPath`, `taxDocPath`, `idDocPath`),
  `verifiedAt`, `hidePhone`, `defaultProtectMessages`.
- **BusinessMember / BusinessGroup** — staff membership and public/private
  business groups.
- **ServiceProvider / ServiceProviderMessage (+Read/Dismissed)** —
  service-provider messaging inbox with per-user read/dismiss state.

## 6. Broadcast & scheduled content

- **BroadcastChannel** — one-to-many channel (`name`, `description`, `owner`,
  `subscriberCount`) with **BroadcastSubscriber** and **BroadcastMessage**.
- **ScheduledMessage** — future-dated message delivery.
- **TimeCapsule** — messages locked until `unlockAt` (`opened` flag).
- **Story / StoryView** — 24-hour ephemeral stories (`type`, `content`,
  `bgColor`, `expiresAt`) with per-viewer read tracking.
- **Poll / PollVote** — single/multi-choice polls (`multiChoice`,
  `anonymous`) with live progress.
- **ChatFolder / FolderConversation** — user-side conversation folders.

## 7. Threads & extra surfaces

- **Thread / ThreadMessage** — side-thread replies off a parent message
  (`parentMessageId`).
- **ReceiptSplit / ReceiptSplitParticipant** — split-a-receipt tool inside
  conversations (`totalAmount`, `currency`, `splitCount`).

## 8. AI layer (repository facts)

`src/lib/ai.ts` — a two-tier unified AI router with automatic fallback across
**4 providers** (nvidia → groq → openrouter → gemini):

- *Fast tier* (short replies): gemma-3-4b-it / llama-3.1-8b-instant /
  llama-3.2-3b-instruct:free / gemini-flash
- *Full tier* (summary, tone, action-items): deepseek-v4-flash /
  llama-3.3-70b-versatile / llama-3.3-70b-instruct / gemini-flash
- Used for: bot demo companion, smart replies, conversation summary, and the
  Commit fairness scorer.

## 9. Real-time & deployment (repository facts)

- Socket.io mini-service (`mini-services/chat-service`) for typing
  indicators, read receipts, presence, live message push.
- Next.js 16 App Router + Prisma (SQLite/libSQL), bcrypt + cookie sessions,
  in-memory sliding-window rate limiting on all API routes, PWA with web push
  (VAPID keys), Arabic RTL with EN/AR toggle, Cirkle gold/teal/cream theme
  switchable to WhatsApp green, dark mode.
- Deployment: Vercel (`cirkle-wasl.vercel.app`); database: Turso.

## 10. Honest gaps (measured 2026-09-18)

The DB intelligence probe measured 36 tables / 95 rows total: usage so far
covers the core (users, conversations, messages, one Commit, threads,
reactions, drafts). **Zero rows**: Business*, Story*, Poll*, Broadcast*,
TimeCapsule, WhisperMessage, ReceiptSplit*, ScheduledMessage,
ServiceProvider* — all built and wired, none yet exercised by production
traffic.

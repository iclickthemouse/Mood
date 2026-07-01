# mood — monetization plan

Status: **planning only.** Nothing here is wired into the app yet. We ship free
while testing; this doc is the ready-to-go playbook for when usage validates it.

---

## Model summary

Two ways to pay, one honest free tier:

| Tier | Price | What you get |
|------|-------|--------------|
| **Free** | $0 | 3 boards, all core features, BYO models (LM Studio / Ollama / own API keys) |
| **Lifetime** | $39 one-time (launch: $29) | Unlimited boards, all Pro features, BYO models only |
| **Pro** (later) | $8/mo or $60/yr | Everything in Lifetime + hosted vision model (zero setup) + board sync/backup |

Rationale: the app is local-first with ~zero marginal cost per user, so a
one-time license is honest and shippable in days. The subscription only exists
once we run real infrastructure (hosted model, sync) that costs us money.

## Phase 0 — free testing (now)

Goal: validate that people hit the walls we intend to charge at.

- Keep everything free and unlimited. No gates.
- Add lightweight, privacy-respecting local telemetry counters (opt-in or
  fully local until we have consent flow): boards created, images per board,
  syntheses run, formats used, LM Studio vs API-key vs hosted interest.
- Watch for: what % of active users create a 4th board? Which Pro-candidate
  features (Deep Director, prompt history) get real use?
- Exit criteria to start Phase 1: a meaningful cohort (~50+ regular users)
  and evidence the 4th-board moment happens for engaged users.

## Phase 1 — lifetime license + board limit

Shippable in days. No backend of our own.

**Payments/licensing:** Lemon Squeezy (or Paddle) — handles checkout, VAT,
license key generation and a license-validation API. No accounts needed;
a license key pasted into Settings is enough.

**Gate design (keep it soft):**
- Free = 3 boards. Creating a 4th opens an upgrade modal instead.
- Existing boards over the limit are never locked or deleted — read/write
  still works; only *new* board creation is gated. Never hold data hostage.
- License check: validate key against Lemon Squeezy API once, cache result
  in localStorage with periodic (weekly) revalidation; fail open when offline.
- Accept that a localStorage gate is honor-system. Don't spend effort on
  anti-tamper; spend it on making Pro desirable.

**What's Pro at this phase (candidates — confirm against Phase 0 data):**
- Unlimited boards
- Deep Director format
- Prompt history / versioning beyond last N
- Batch re-analysis
- (Free keeps: 3 boards, JSON / FLUX / Ideogram / Midjourney formats,
  full analysis + weighting + editing)

**Pricing:** $39 lifetime, launch discount $29. Anchor: Milanote $9.99/mo,
indie desktop creative tools $20–50 one-time.

## Phase 2 — Pro subscription (hosted AI + sync)

Only when we're ready to run infrastructure.

- **Hosted vision model:** a thin proxy (per-user API key/token) in front of a
  vision model. This removes ALL setup friction — the biggest onboarding wall
  we have (the LM Studio wizard mitigates it, but "click and it works" beats
  a 5-minute install). Cost control: rate limits + monthly fair-use cap.
- **Sync/backup:** boards + prompt library synced to a small backend
  (or object storage). Requires accounts (email magic-link is enough).
- **Price:** $8/mo or $60/yr. Includes everything in Lifetime.
- Lifetime owners get a discount on Pro (they paid for features, not compute).

## Phase 3 — expansion (optional, later)

- **Teams/shared boards** — where the ceiling rises; teams expense tools.
  Price per seat (~$12/seat/mo) when shareable boards exist.
- **v2 voice boards** — headline feature for Pro at launch of v2.

## Where the gates live in code (for future implementation)

- Board creation: `createBoard()` in `src/App.jsx` — check
  `boards.length >= FREE_BOARD_LIMIT && !license.valid` → show upgrade modal.
- License state: new `license` slice in persisted config
  (`normalizePersistedConfig`), key entry field in `SettingsModal`.
- Format gating: `PROMPT_FORMATS` entries get a `pro: true` flag; the format
  picker renders a lock + upgrade prompt.
- Upgrade modal: reuse the modal pattern (onboarding/setup wizard styling).

## Principles

1. Never lock or delete user data behind a paywall.
2. Fail open (offline license checks pass; server hiccups never block work).
3. Free tier must stay genuinely useful — it's the marketing.
4. Charge for removed friction (hosted AI, sync) and depth (formats, history),
   not for basics.
5. Don't fight pirates; a bypassed local gate is a user we weren't going to
   convert anyway.

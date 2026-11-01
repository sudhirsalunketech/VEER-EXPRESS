# Architecture

## Modular monolith (API)

One deployable NestJS app, one Postgres database, and one module per business area. Modules call each other only through exported services.

```
apps/api/src/
  main.ts  app.module.ts  core.module.ts   ← config, storage, JWT, external adapters (global)
  config.ts  common/                        ← roles & branch scope, zod validation
  database/                                 ← Repository interface, MemoryRepository (demo), PgRepository
  modules/
    auth/          login (+ throttle), /auth/me, global AuthGuard, @Public/@Roles/@CurrentUser
    audit/         AuditService (used by other modules), GET /audit
    org/           branches & staff, role-creation rules
    shipments/     booking, allocation & tracking queues, allocation, manual tracking, counter collection, public tracking, partner webhooks
    ledger/        journal rules (booking, payment, allocation, commission, settlement) and GET /ledger
    billing/       company GST settings and invoices
    pincodes/      PIN lookup: local India Post directory, then the free India Post service
    reports/       dashboard KPIs, partner listing, allocation preview, health
    couriers/      per-courier adapters, used only for partner listing and signed webhooks
    payments/      payment gateway adapters (simulated / Razorpay)
    notifications/ templates + simulated channels
```

Milestone 3 moved the shipments API onto migration 0002: bookings start unallocated (rate card gives the price and an estimated cost), staff record the aggregator booking as an allocation, tracking is entered manually with verification, and counter collections issue receipts. Each of these writes its ledger journal in the same database transaction. `courier_awb_mappings` is no longer written. 

Milestone 4 (migration 0003) adds billing: each booking issues an invoice in the same transaction (gapless company-wide number per financial year; a tax invoice only once a GSTIN is configured). Invoices are append-only in the database. Defaults: CGST + SGST split (intra-state B2C), SAC 996812.

**Single branch.** The business has one branch, Kamothe (`BR-KMT`). Franchise features (franchise roles, wallets, commission, settlements) were removed from the API and the web app. Migrations 0001/0003 still create the `franchises`, `wallets`, `wallet_transactions`, `commissions` and `settlements` tables, which are now unused; since nothing has been deployed yet they can be dropped before the first production migration if preferred. Branch scoping stays in the code as a general security rule.

## Overview

```
 Browser (Vercel)                         API (Render, NestJS)                         Supabase Postgres
 ┌───────────────────────┐   HTTPS/JSON   ┌───────────────────────────────┐   SQL/TLS   ┌──────────────────┐
 │ Presentation  /       │ ─────────────► │ AuthGuard (JWT) + @Roles      │ ──────────► │ 25 tables, RLS on │
 │ Public site   /home   │                │ PublicController  (no costs)  │             │ is_demo flags     │
 │ Staff console /admin  │                │ ShipmentsController (scoped)  │             └──────────────────┘
 │ (menu by role)        │                │ WebhooksController (signed)   │
 └───────────────────────┘                │ ShipmentsService ── @veer/core│──► CourierRegistry ─► adapters
                                          │ PaymentGateway  NotificationSvc│──► Razorpay / WhatsApp / SMS / Email
                                          └───────────────────────────────┘
```

`@veer/core` holds pure business logic (weights, zones, pricing, allocation, tracking numbers, status normalisation). The web app (for the demo) and the API (for real requests) use the same code, so the demo's prices match what the server will charge.

## Booking flow (API)

1. Validate the input with zod: PIN, weight ≤ 70 kg, dims ≤ 200 cm, mobile number, address.
2. `allocate()` builds a quote for every enabled partner and drops partners that can't serve the route, then picks one by mode:
   - `CHEAPEST`: lowest partner cost, ties broken by priority.
   - `RULE_BASED`: the first matching rule (zone, service, weight range → partner), falling back to priority.
   - `MANUAL`: the partner chosen by staff, provided it is eligible.
3. Payment: the simulated gateway in demo, or Razorpay signature verification (`order_id|payment_id` HMAC) in production. Public callers cannot use credit accounts.
4. Generate a `VX` + yymmdd + 6 digits + check digit tracking number. Uniqueness is checked before insert and enforced by a unique index.
5. No courier is chosen at booking: the rate card gives the price and an estimated courier cost. Operations staff allocate the courier later (aggregator reference, courier, AWB, actual cost).
6. One DB transaction inserts the shipment (Kamothe branch), both addresses, the package, the first tracking event, any payment received with its receipt number, the invoice, the address-book entries and the balanced ledger journals.
7. Write an audit log entry and send notifications (simulated).

## Pricing

```
volumetric  = L × W × H / partner.volumetric_divisor
chargeable  = max(actual, volumetric)
partnerCost = max(base + ceil((chargeable − baseWeight)/step) × additional, minCharge)
              + fuel% + remote-area surcharge (SPECIAL zone)
freight     = partnerCost + markupFlat + partnerCost × markupPct
insurance   = max(insuranceMin, declared × insurancePct)        (optional)
GST         = (freight + insurance) × gstPct
total       = freight + insurance + GST
margin      = freight − partnerCost                            (internal only)
```

Zones (`LOCAL`, `WITHIN_STATE`, `METRO`, `REST_OF_INDIA`, `SPECIAL`) are derived from the PIN prefix and postal circle. In production, `courier_serviceability` (exact PIN or prefix rules) refines them. **All rates in the seed are sample figures, not partner tariffs.**

## Courier adapters

All partners implement `CourierProvider` (`apps/api/src/couriers/courier-provider.ts`):
`capabilities() · checkServiceability() · createShipment() · track() · parseWebhook()`.

| Adapter | State |
|---|---|
| `MockCourierProvider` | Working. Used for demo and tests; HMAC-signed webhooks. |
| `BlueDartProvider` | Structure only. Throws `ProviderNotConfiguredError` until the endpoints, credentials and payload mappings are implemented from the official docs and verified in the partner's sandbox. |
| `TrackonProvider` | Same as Blue Dart. |
| `GenericCourierProvider` | For partners with no API access: staff book on the partner portal, then enter the AWB and status updates (`POST /shipments/:tn/events`). |

To add a partner, create an adapter class, add it to `ADAPTERS` in `courier-registry.ts`, insert a `courier_partners` row with `adapter = '<ClassName>'`, and store its credentials encrypted in `courier_credentials`. The booking code does not change.

Partner statuses are mapped to the unified set (`BOOKED … DELIVERED, EXCEPTION`) through `DEFAULT_STATUS_MAP` plus the per-partner `courier_partners.status_map`. Unknown statuses are ignored, not guessed.

> Current limitation: `AppModule` registers the demo partner set in every mode. Loading partners from `courier_partners` and decrypting `courier_credentials` with `CREDENTIAL_ENCRYPTION_KEY` is Phase 1 work, as are DB-backed rate cards (currently from `@veer/core` seed).

## Security model

| Concern | Control |
|---|---|
| Authentication | bcrypt password hashes; JWT (HS256, `JWT_TTL`); global `AuthGuard`, opt-out only via `@Public()` |
| Authorization | `@Roles()` per controller/route; `branchScope(user)` passed as a **required** argument to every repository read |
| Tenant isolation | Cross-branch reads return 404 (no existence leak). Postgres RLS enabled on every table so Supabase anon/authenticated keys read nothing. |
| Internal economics | `toPublicTracking` / `toCustomerQuote` projections at public boundaries; `toInternal` strips cost for non-finance roles |
| Secrets | Env only; `courier_credentials` encrypted at rest and `REVOKE`d from client roles; partner listing exposes only `hasCredentials` |
| Payments | No card data touches the server; only gateway order and payment IDs are stored |
| Webhooks | Signature verification per adapter; invalid → 401 |
| Audit | `audit_logs` for login, booking, status changes (extend to rate/partner/finance edits) |

## Migration 0002: aggregator model & manual operations

| Area | What the database enforces |
|---|---|
| `aggregators` | The external aggregator account (MANUAL now, API later). No credentials are stored for manual mode |
| `shipments` | `partner_id`/`partner_cost` are nullable: the courier isn't known at booking. `estimated_partner_cost` stores the rate-card hint |
| `shipment_allocations` | Aggregator ref, courier, AWB, partner cost, who/when. **One active allocation per shipment**; an AWB is active on only one shipment per courier; re-allocation supersedes the old row instead of overwriting it |
| `shipment_tracking_events` | `recorded_at`, `recorded_by`, `verified`. A `MANUAL` event must name the staff member and be verified; `occurred_at` can't be after `recorded_at`. **Append-only** |
| `payments` | `receipt_no` (unique per branch), `reference`. A captured counter payment must have a collector and a receipt. `next_receipt_no(branch)` gives gapless per-branch numbers |
| `shipment_payment_summary` | View that derives payment status from payment rows only, independent of shipment status |
| `ledger_entries` | Double-entry lines grouped by `journal_id`. A deferred trigger rejects any journal that doesn't balance at commit. **Append-only**; corrections are reversals |
| `audit_logs`, `wallet_transactions` | **Append-only** |

The migration is additive and carries existing `courier_awb_mappings` over as allocations (under a disabled `LEGACY` aggregator). Tests in `apps/api/test/db.rules.integration.test.ts` exercise each rule against a real database.

## Data model

The migration in `supabase/migrations/` creates `roles, permissions, role_permissions, franchises, branches, users, customers, courier_partners, courier_credentials, courier_rate_cards, courier_serviceability, pricing_settings, shipments, shipment_addresses, shipment_packages, shipment_tracking_events, courier_awb_mappings, payments, invoices, wallets, wallet_transactions, settlements, commissions, notification_logs, audit_logs`.

It includes foreign keys throughout, indexes on every common access path, `updated_at` triggers, `deleted_at` soft delete on user-managed entities, `is_demo` flags on seedable data, check constraints for enums, PIN format, tracking number format and percentages, and a generated `gross_margin` column.

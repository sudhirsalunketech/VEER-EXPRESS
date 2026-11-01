# API reference: `/api/v1`

Auth: `Authorization: Bearer <accessToken>` from `POST /auth/login`. Validation errors return `400 { message, issues: [{path, message}] }`.

## Public (no auth; never returns partner data)

| Method | Path | Body / notes |
|---|---|---|
| GET | `/health` | `{ status, mode, time }` |
| POST | `/public/quote` | `{ originPin, destPin, actualWeightKg, dims:{lengthCm,widthCm,heightCm}, service:'EXPRESS'\|'STANDARD'\|'SURFACE', declaredValue?, insurance? }` → `{ zone, chargeableWeightKg, volumetricWeightKg, freight, insurance, gst, total, estimatedDays, sample }`. Returns 422 if the route isn't serviceable. |
| POST | `/public/payment-orders` | Same body as quote → gateway order (`SIMULATED` or `RAZORPAY` with public `keyId`) |
| POST | `/public/bookings` | Quote body + `kind, packageType?, sender{name,phone,address}, receiver{…}, paymentMode:'UPI'\|'ONLINE'\|'COUNTER', payment?{orderId,paymentId,signature}, originCity?, destCity?` → `{ trackingNumber, quote, shipmentStatus, paymentStatus, balanceDue, receiptNo, simulatedPayment }`. No courier is chosen at booking. |
| GET | `/public/track/:trackingNumber` | `{ trackingNumber, bookedAt, origin, destination, status, statusLabel, estimatedDelivery, dispatched, lastUpdatedAt, updateNotice, events[] }`. Never includes courier, AWB, aggregator, cost or staff names. |
| GET | `/public/pincodes/:pin` | `{ pin, found, label, district, state, areas[], deliverable, source, unverified }`. Local India Post directory first, then the free India Post service (cached 24 h). `unverified: true` means the outside service could not be reached; never blocks booking |
| POST | `/webhooks/couriers/:partnerCode` | Partner-signed payload. Returns 401 for a bad signature and 404 for an unknown partner, otherwise `{ received, applied }` |

## Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{ email, password }` → `{ accessToken, user }`. 5 failed attempts for one email within 15 min → `429` |
| GET | `/auth/me` | Current user, re-read from storage |

Every authenticated request re-checks that the account is still active, so deactivation takes effect immediately.

## Organisation (branches & staff)

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/org/branches` | Super Admin, Admin, Accountant | The branch list (today: Kamothe only) |
| GET | `/org/staff` | Super Admin, Admin | All staff accounts |
| POST | `/org/staff` | same | `{ email, name, role, branchId?, password }`. Password ≥ 10 chars with a letter and a digit. Branch-scoped creators always create in their own branch. 403 for a role above the creator's, 409 for a duplicate email |
| POST | `/org/staff/:id/deactivate` · `/activate` | same | 404 outside the caller's branch; 400 on your own account |

Who can create whom: Super Admin → any staff role; Admin → Accountant, Booking (counter) Staff. Counter staff and accountants cannot create accounts.

## Audit

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/audit?entity=&action=&page=&pageSize=` | Super Admin, Admin, Accountant | Newest first. Audit rows are append-only in the database |

## Staff (roles in brackets; branch-scoped unless the role is global)

| Method | Path | Notes |
|---|---|---|
| GET | `/shipments?status=&q=&page=&pageSize=` | [all staff] Each row has `paymentStatus`, `balanceDue`, `payments[]`, `events[]` (with `recordedBy`), `lastUpdatedAt`, `allocated`. `allocation{aggregator, aggregatorRef, courierName, awb, partnerCost, allocatedBy, allocatedAt}`, `estimatedPartnerCost` and `grossMarginExGst` only for Super Admin, Admin and Accountant |
| GET | `/shipments/:tn` | Same shape. 404 if the shipment is outside the caller's branch |
| POST | `/shipments` | Booking body + `branchId?` (honoured for global roles only). Staff may use `paymentMode:'CASH'` (receipt issued at once) or `'CREDIT'` |
| GET | `/shipments/queues/allocation` | [Super Admin, Admin] Open shipments with no courier yet, oldest first, with `waitingHours` |
| GET | `/shipments/queues/tracking` | [Super Admin, Admin] Allocated, undelivered shipments, longest since last update first, with `hoursSinceUpdate` and `stale` (≥ 12 h) |
| POST | `/shipments/:tn/allocation` | [Super Admin, Admin] `{ aggregatorRef, courierName, awb, partnerCost, aggregatorCode?, reason? }` after booking in the aggregator account. `reason` is required to re-allocate; history is kept and the old cost is reversed in the ledger. 409 if the AWB is active on another shipment |
| POST | `/shipments/:tn/tracking` | [Super Admin, Admin] `{ status, occurredAt, location, remarks?, verified:true }`, as read from the courier's tracking page. 422 if not allocated, out of order, in the future, earlier than the last update, unverified, or an exception without remarks |
| POST | `/shipments/:tn/payments` | [Super Admin, Admin, counter staff] `{ method:'CASH'\|'COUNTER_UPI'\|'COUNTER_CARD', amount, reference? }` → `{ receipt{receiptNo,…}, paymentStatus, balanceDue, shipmentStatus }`. Gapless receipt numbers per branch (`PUN-R-000012`). UPI/card need a reference; 422 if over the balance due, 409 if nothing is due |
| GET | `/aggregators` | [Super Admin, Admin] Aggregator accounts (no credentials stored) |
| GET | `/ledger?branchId=&page=&pageSize=` | [Super Admin, Admin, Accountant] Append-only double-entry ledger lines and the trial balance for the scope |
| GET | `/dashboard` | KPIs incl. `awaitingAllocation`, `paymentDueCount`, `paymentDueAmount`; `partnerPayable`/`grossProfit` for finance roles only |
| GET | `/admin/courier-partners` | [Super Admin, Admin] Config without secrets |
| POST | `/admin/allocation/preview` | [finance roles] Quote body + `mode`, `partnerCode?` → all candidates with costs |
| GET | `/admin/notifications` | [Super Admin, Admin] Recent (simulated) notification log |

## Billing

| Method | Path | Notes |
|---|---|---|
| GET | `/settings/company` | [all staff] Seller details printed on invoices: `{ legalName, gstin, address, stateCode, invoicePrefix }` |
| PUT | `/settings/company` | [Super Admin] `{ legalName, gstin\|null, address\|null, stateCode\|null }`. GSTIN format and state code are validated. Affects new invoices only |
| GET | `/invoices?page=&pageSize=` | [all staff] One invoice per booking. Number `VX/26-27/00001`: company-wide, per financial year, gapless. `isTaxInvoice` is false until a GSTIN is set |
| GET | `/invoices/:number` | URL-encode the number. 404 outside the caller's branch |

## Contacts

| Method | Path | Notes |
|---|---|---|
| GET | `/contacts?q=` | [Super Admin, Admin, counter staff] Address-book search by name or mobile (≥ 2 characters), 8 results. Every booking adds or updates its sender and receiver. Never public |

Single branch: public bookings belong to `HEAD_BRANCH_CODE` (default `BR-KMT`, Kamothe).

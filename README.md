# Veer Express Courier

**One Brand. Every Delivery. One Tracking Experience.**

A courier aggregator platform for Veer Express, Kamothe (Navi Mumbai). Customers book, pay and track with Veer Express; internally, each shipment is routed to a courier partner (Blue Dart, Trackon, DTDC, others) and mapped back to one Veer tracking number.

> **Status:** Milestone 1 (client demo) is complete, built for the confirmed business model: shipments are booked through an external **aggregator account**, staff record the aggregator reference, courier and AWB in Veer, and **tracking is updated manually** by operations staff (never advertised as real-time). Everything in the demo is sample data. **No real aggregator, courier, payment gateway or messaging service is connected.** The backend is rebuilt module by module: Milestone 2 (database rules, staff, audit) and Milestone 3 (allocation, manual tracking, counter collection, ledger APIs) and Milestone 4 (invoices, company GST settings, PIN lookup, saved customers, consignment-note PDF) are done, and the website can run against the API (live mode, below) or on browser demo data (default).

## Repository layout

```
apps/web        React + TypeScript + Tailwind: presentation site, public website, staff console
apps/api        NestJS REST API: auth/RBAC, pricing, allocation, bookings, tracking, webhooks
packages/core   Shared pure logic: volumetric/chargeable weight, zones, pricing, allocation, tracking numbers, demo seed
supabase/       PostgreSQL migrations (Supabase)
docs/           Architecture, API reference, deployment guide
render.yaml     Render blueprint for the API
```

## Quick start

```bash
npm install
npm run dev:web          # http://localhost:5173  (demo mode, no backend needed)
npm run dev:api          # http://localhost:3000/api/v1  (APP_MODE=demo → in-memory sample data)
npm test                 # core + API tests
```

### Website connected to the API (live mode)

```bash
# terminal 1: API (in-memory sample data; or set APP_MODE=development + DATABASE_URL for Postgres)
cd apps/api && APP_MODE=demo PORT=3100 CORS_ORIGINS=http://localhost:5174 npx tsx watch src/main.ts
# terminal 2: website in live mode
cd apps/web && VITE_APP_MODE=live VITE_API_URL=http://localhost:3100 npx vite --port 5174
```

In live mode, sign-in, booking, tracking and the operations screens (allocation, tracking desk, counter collection, payments, ledger, audit) use the API. Pages that still show sample data (customers, reports, rate cards, notifications) are hidden until their APIs exist. The presentation page always uses demo data.

### Routes (web)

| Path | What it is |
|---|---|
| `/` | Client proposal / presentation (19 sections, live embedded demos) |
| `/home` | Public website: Home, Services, Rates, Book, Track, About, Contact, FAQ, Privacy, Terms |
| `/login` | Demo staff login |
| `/admin` | Admin console, including the operations screens: **Allocation Queue**, **Tracking Desk**, **Counter Collection**, **Financial Ledger** |

## Demo access

**Demo only.** These accounts work only with sample data and must never exist in production.

| Email | Password | Role |
|---|---|---|
| `admin@demo.veer` (web) / `superadmin@demo.veer` (API) | `Demo@123` | Super Admin |
| `ops@demo.veer` (API) | `Demo@123` | Admin (operations: allocation, tracking desk) |
| `staff@demo.veer` | `Demo@123` | Counter staff, Kamothe |
| `accounts@demo.veer` | `Demo@123` | Accountant |

Veer Express runs **one branch: Kamothe** (`BR-KMT`). All bookings, receipts (`KMT-R-…`) and invoices belong to it. There are no franchise roles, wallets, commissions or settlements; every staff member uses the same console, with a menu that matches their role.

Presenter tip: on `/`, the **Operations demo** section lets you allocate a courier, record a tracking update and collect a counter payment. In **Tracking demo**, *Record next staff update* moves the showcase shipment forward exactly as an operations executive would (audited). **Reset demo data** in the last section restores the seed.

## Environments

| | `demo` | `development` | `production` |
|---|---|---|---|
| Web data | browser sample store | API | API |
| API data | in-memory seed | Postgres (local/Supabase) | Supabase Postgres |
| Payments | simulated | simulated | Razorpay (when keys set) |
| Notifications | simulated | simulated | simulated until providers are wired |
| Startup checks | none | none | requires strong `JWT_SECRET`, `DATABASE_URL`, `CREDENTIAL_ENCRYPTION_KEY` |

Copy `apps/web/.env.example` and `apps/api/.env.example`, then fill in the values.

## PIN code directory

The booking form shows the area, district and state for each PIN. The API looks a PIN up in the `pincode_directory` table first, then falls back to the free India Post lookup service (api.postalpincode.in; no key, no guarantee, and some real PINs are missing). For complete, offline coverage, download the free **All India Pincode Directory** CSV from data.gov.in and load it:

```bash
DATABASE_URL=... npm run db:import-pincodes -w apps/api -- ./all-india-pincode-directory.csv
```

## Database

```bash
supabase db push                                  # applies every file in supabase/migrations in order (0001, 0002, …)
#   or: for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
DATABASE_URL=postgres://... npm run db:seed       # empty DB after all migrations; every row is_demo = true; refuses in production
TEST_DATABASE_URL=postgres://... npm -w apps/api test   # also runs Postgres integration + database-rule tests
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): system design, courier adapters, allocation, pricing, security
- [docs/API.md](docs/API.md): REST endpoints
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Vercel, Render and Supabase setup

## Ground rules

- Customer-facing responses never contain the partner name, partner AWB, partner cost or margin. Tests enforce this.
- Courier credentials and payment secrets live only in server env or encrypted DB columns, never in the browser.
- Counter staff never see courier names, AWBs, aggregator references or costs; only admins manage staff. Tests enforce this.
- No paid service, domain or live credential is used without explicit approval.

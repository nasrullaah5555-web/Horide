# Musride — System Architecture

## 1. Overview

```
 Passenger app (Flutter) ─┐                       ┌─ PostgreSQL 16 + PostGIS
 Driver app (Flutter) ────┼─ HTTPS REST + WSS ──► │  NestJS API  ├─ Private object storage (driver documents)
 Admin dashboard (Next) ──┤                       │ (modular     ├─ SMS provider (OTP)
 Website (Next) ──────────┘                       │  monolith)   ├─ Routing provider
                                                  └──────────────┴─ Firebase Cloud Messaging
```

One backend process owns all business rules. Clients never compute fares, eligibility or trip transitions.

## 2. Repository layout

```
musride/
├─ apps/
│  ├─ backend/        NestJS API (TypeScript)
│  ├─ admin/          Next.js admin dashboard
│  └─ website/        Next.js public website
├─ mobile/
│  ├─ passenger/      Flutter passenger app
│  └─ driver/         Flutter driver app
├─ packages/
│  └─ musride_core/    Shared Dart: API client, models, design system
├─ infra/             docker-compose, Render blueprint, scripts
└─ docs/              Plans, registers, reports
```

## 3. Backend modules (`apps/backend/src/modules`)

| Module | Responsibility |
|---|---|
| config | Validates environment variables at startup; refuses dev adapters in production |
| database | Kysely instance, migrations, transaction helper |
| auth | OTP challenges, sessions, refresh rotation, guards |
| admin-auth | Admin password + TOTP, RBAC permissions |
| audit | Append-only audit log writer |
| users | Passenger and driver profiles |
| drivers | Onboarding, vehicles, documents, approval |
| storage | Private file storage adapter, signed URLs |
| geo | Service zones, routing adapter |
| pricing | Fare versions, fare engine, quotes |
| subscriptions | Plans, subscriptions, subscription payments, eligibility |
| locations | Driver availability and location ingestion |
| matching | Find eligible drivers, create and expire offers |
| trips | State machine, lifecycle endpoints |
| payments | Ride payment records, confirmations, disputes |
| feedback | Ratings, complaints, emergency events |
| notifications | FCM adapter, in-app notifications |
| realtime | WebSocket gateway |
| admin | Admin read/management endpoints |

Rule: modules talk through exported services, never by reading each other's tables directly, except read-only reporting in `admin`.

## 4. Key flows

### Ride request
1. Passenger requests `POST /quotes` with pickup, destination, category. Server validates zone, calls routing, applies current fare version, returns signed quote (expires 5 min).
2. Passenger `POST /trips` with quote token. Server verifies signature, expiry, ownership; creates trip `SEARCHING`.
3. Matching selects up to N eligible drivers nearest by PostGIS KNN within radius, creates `trip_offers` (expire 20 s), pushes via WebSocket + FCM.
4. Driver `POST /trips/:id/accept`. Conditional update wins or loses atomically.
5. No acceptance → next wave with larger radius → after max waves trip `EXPIRED`.

### Driver eligibility (single SQL predicate, used by matching and go-online)
approved driver ∧ not suspended ∧ approved vehicle of requested category ∧ subscription active and `ends_at > now()` ∧ online ∧ location fresh (< 30 s) ∧ no active trip.

### Weak connectivity
- REST calls idempotent where they create things (`Idempotency-Key` header on trip creation and payment recording).
- WebSocket for push; on reconnect the client calls `GET /trips/active` to resynchronise. WebSocket is never the only source of truth.
- Location updates are batched if sent late; server discards points older than 60 s for "live" purposes but keeps them in trip history.

## 5. Real-time

Socket.IO over WSS, authenticated with the access token at handshake. Rooms: `driver:{id}`, `passenger:{id}`, `trip:{id}`. Events: `offer.created`, `offer.cancelled`, `trip.updated`, `driver.location`.

## 6. Technology versions (target)

| Component | Version |
|---|---|
| Node.js | 22 LTS |
| NestJS | 11 |
| TypeScript | 5.x |
| PostgreSQL / PostGIS | 16 / 3.4+ |
| Next.js | 15 |
| Tailwind CSS | 4 |
| Flutter | latest stable at build time |
| Riverpod / GoRouter | latest stable |

Exact versions are pinned in lockfiles.

## 7. Environments

| Env | Database | SMS | Routing | Storage |
|---|---|---|---|---|
| local | Local Postgres/PostGIS | Console (logs code) | Straight-line estimate | Local disk |
| test (CI) | Ephemeral PostGIS | In-memory fake | Fake | Temp dir |
| staging | Supabase (separate project) | Real provider, test numbers | Real | Private bucket |
| production | Supabase | Real | Real | Private bucket |

Production startup fails if any development adapter is configured.

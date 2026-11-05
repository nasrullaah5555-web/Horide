# Architecture Decision Records

Format: context → decision → consequences. Status: Accepted unless marked otherwise.

## ADR-001 Monorepo

**Decision:** One Git repository. `apps/backend` (NestJS), `apps/admin` (Next.js), `apps/website` (Next.js), `mobile/passenger`, `mobile/driver` (Flutter), `packages/horide_core` (shared Dart package). JavaScript workspaces managed with pnpm.
**Why:** One source of truth, shared CI, atomic changes across API and clients.

## ADR-002 Database access: Kysely + SQL migrations

**Context:** PostGIS types (geography, KNN `<->`) are poorly supported by Prisma. TypeORM's migrations are error-prone for beginners to read.
**Decision:** Kysely (typed SQL query builder) with its built-in Migrator. Migrations are written as SQL inside TypeScript files so they read like plain SQL.
**Consequences:** Queries stay close to SQL, parameterised by default (SQL injection protection). PostGIS functions are used via `sql` template tags.

## ADR-003 Own phone-OTP authentication (not Supabase Auth)

**Decision:** NestJS issues sessions. Short-lived JWT access token (15 min) + opaque refresh token (30 days), rotated on every use, stored hashed, with reuse detection that revokes the whole session family.
**Why:** SMS provider must be Ethiopian-capable and swappable; full control over OTP limits, lockouts and driver/passenger roles. Avoids splitting user identity across two systems.

## ADR-004 Supabase = managed Postgres + private storage only

**Decision:** If Supabase is used, it provides PostgreSQL+PostGIS and a private S3-compatible bucket. The backend connects with a server-side connection string. Supabase's auto-generated public REST API and Auth are not used; Row Level Security is enabled on all tables with no public policies, so the public API exposes nothing.
**Consequences:** Database is portable to any Postgres host.

## ADR-005 Redis deferred (change from master prompt)

**Context:** Master prompt lists Redis. Pilot scale in Jijiga is estimated at under 500 drivers. At 1 update / 5 s that is ~100 writes/s worst case, which PostgreSQL handles.
**Decision:** Pilot runs on PostgreSQL only: `driver_locations` (one row per driver, upserted) with a GiST index. Single backend instance, so WebSocket rooms and rate-limit counters are in-process.
**Trigger to add Redis:** more than one backend instance, or location writes > 300/s, or p95 matching query > 200 ms.
**Why:** One less paid service and one less system to learn and secure.

## ADR-006 Routing provider behind an adapter

**Decision:** `RoutingProvider` interface. Implementations: `DevStraightLineRouting` (haversine × 1.3, labelled `isEstimate: true`, refused when `NODE_ENV=production`), `GoogleRoutesProvider`, `OsrmProvider`.
**Open question (OA-09):** Google has better geocoding/search in Ethiopia but costs per request; OSRM on OpenStreetMap is free but Jijiga road coverage must be verified on the ground.

## ADR-007 SMS provider behind an adapter

**Decision:** `SmsProvider` interface. `ConsoleSmsProvider` for development (refused in production), `AfroMessageSmsProvider` for production pending OA-08.

## ADR-008 Payments are records, not transactions

**Decision:** `payments` row per trip with method, amount (= locked fare), status. Driver records receipt; passenger confirms or disputes. eBirr adds a transaction reference typed by the driver. No reference is "verified" until an eBirr commercial API exists (BR-06).
**Fake-confirmation protection:** confirmation only by the trip's own driver/passenger, only after COMPLETED, once each, with audit trail; disputes go to finance admins.

## ADR-009 Passenger web booking deferred (change from autonomous directive)

**Decision:** Website v1 = public information site + legal pages. Passenger web booking after pilot.
**Why:** Web booking needs browser geolocation, a second client to secure and maintain, and gives little value when nearly all users in Jijiga will book from a phone.

## ADR-010 Money as integer santim

All amounts are `bigint` santim. Display formatting only at the edge.

## ADR-011 Trip state machine and atomic acceptance

**Decision:** Allowed transitions defined in one module. Every transition is a conditional update: `UPDATE trips SET status=$new WHERE id=$id AND status=$expected RETURNING *`. Acceptance additionally requires `driver_id IS NULL`. A partial unique index allows only one active trip per driver and per passenger.
**Consequences:** Double acceptance is impossible at the database level, not just in application code.

## ADR-012 Hosting

**Decision (pending owner accounts):** Render paid web service for the API (WebSockets need an always-on instance; the free tier sleeps). Admin and website on Render. Database region Frankfurt (closest common region to Ethiopia).
**Open (OA-07):** Hosting outside Ethiopia is a cross-border transfer under Proclamation 1321/2024 — needs a legal basis (adequacy, safeguards or consent).

## ADR-013 Navigation hand-off

Turn-by-turn navigation is handed to the phone's maps app via a deep link instead of being built in. Building navigation is out of scope and unsafe to do badly.

## ADR-016 Admin dashboard served same-origin with the API's /admin routes

**Context:** The API's admin session cookie is `httpOnly`, `SameSite=Strict`, `path=/admin`. A dashboard on a different origin would need CORS with credentials and a looser cookie.
**Decision:** The Next.js dashboard serves its pages at `/`, `/drivers`, … and forwards every `/admin/*` request to the API's `/admin/*` (Next.js rewrites). To the browser, dashboard and API are one origin, so the cookie works unchanged, no CORS is needed, and the CSRF header (token returned at sign-in, kept in the tab's localStorage) still guards every change.
**Also:** Strict security headers on the dashboard (CSP allowing only self and OpenStreetMap tile images, frame-ancestors none, no third-party scripts). All data is fetched in the browser with the admin's own session; the dashboard server holds no credentials.
**Consequences:** Dashboard pages must never use paths under `/admin`. Behind the proxy the API sees the dashboard server's address, so audit-log IPs are only accurate if the proxy forwards `X-Forwarded-For` and `trust proxy` is set for the hop count in production (checked at deployment, T-045).

## ADR-015 scrypt and a minimal built-in JWT (no native or ESM-only crypto packages)

**Context:** argon2 needs a native add-on; popular JWT libraries are now ESM-only and clash with the CommonJS NestJS build (the same problem hit Kysely 0.29).
**Decision:** Admin passwords use Node's built-in scrypt (N=2^17, r=8, p=1, parameters stored in the hash). Access tokens use a ~40-line HS256 implementation on Node's crypto that accepts only HS256. TOTP (RFC 6238) is implemented in-house and verified against the RFC test vector.
**Consequences:** Nothing to compile on deployment; every security-relevant line is in this repository and covered by tests.

## ADR-014 Flutter apps cannot be compiled in the cloud workspace

**Context:** The build environment blocks Flutter SDK and pub.dev downloads.
**Decision:** Mobile code is written in the repository and checked in CI on GitHub (which can download Flutter) and on the owner's laptop. Mobile tasks are marked "Implemented — not compiled" until CI or the owner confirms a build.

## ADR-017 Production adapters built before credentials exist, and labelled unverified

Context: SMS, routing, document storage and push each need an account the owner has not created yet (OA-08, OA-09, OA-11, OA-12). Leaving them unimplemented would make deployment wait for development after the accounts exist.

Decision: implement each adapter against the provider's public API and test it with a local stand-in: S3 storage against the moto S3 emulator; Google Routes, OSRM, FCM HTTP v1 and AfroMessage against fake HTTP servers that check the request format. FCM signs its own OAuth assertion with Node's crypto (no SDK). Each adapter's code comment and COMPLETED_TASKS say "not verified against the real service". Configuration refuses to start if an adapter is selected without its credentials. Failures surface as plain errors (routing down → 503 "prices unavailable", never a guessed price).

Consequences: when an account exists, going live is configuration plus one real check per service (listed in OWNER_ACTION_REGISTER). AfroMessage was written from public SDKs because the official developer page couldn't be opened from the development environment; it carries the highest risk of a mismatch.

## ADR-018 One design-token file for every part of Horide, enforced in CI

Context: the owner requires every layout, button and colour to be constant across the project. Before this, the apps, console and website each had their own copies of the colours and many one-off sizes (over 300 hardcoded values found).

Decision: `design/tokens.json` is the single source. `scripts/gen-tokens.mjs` generates Dart constants for the apps, a CSS/Tailwind theme for the console and website, and a TypeScript colour map. Screens are built from shared components (`HorideButton` and friends in `horide_core`; `.sign` classes in `packages/design-tokens/components.css`). `scripts/check-design.mjs` fails CI on any hardcoded colour, size, font size, corner, padding or custom button outside the token and component files.

Consequences: a look change is one edit plus `pnpm tokens`. Some spacing values were rounded to the nearest step of the scale (e.g. 10 → 12, 6 → 8), which slightly changes a few layouts on purpose. Tailwind's spacing scale (4 px steps) stays allowed on the web because it is itself a fixed scale.

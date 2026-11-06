# Architecture Decision Records

Format: context → decision → consequences. Status: Accepted unless marked otherwise.

## ADR-001 Monorepo

**Decision:** One Git repository. `apps/backend` (NestJS), `apps/admin` (Next.js), `apps/website` (Next.js), `mobile/passenger`, `mobile/driver` (Flutter), `packages/musride_core` (shared Dart package). JavaScript workspaces managed with pnpm.
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

## ADR-018 One design-token file for every part of Musride, enforced in CI

Context: the owner requires every layout, button and colour to be constant across the project. Before this, the apps, console and website each had their own copies of the colours and many one-off sizes (over 300 hardcoded values found).

Decision: `design/tokens.json` is the single source. `scripts/gen-tokens.mjs` generates Dart constants for the apps, a CSS/Tailwind theme for the console and website, and a TypeScript colour map. Screens are built from shared components (`MusrideButton` and friends in `musride_core`; `.sign` classes in `packages/design-tokens/components.css`). `scripts/check-design.mjs` fails CI on any hardcoded colour, size, font size, corner, padding or custom button outside the token and component files.

Consequences: a look change is one edit plus `pnpm tokens`. Some spacing values were rounded to the nearest step of the scale (e.g. 10 → 12, 6 → 8), which slightly changes a few layouts on purpose. Tailwind's spacing scale (4 px steps) stays allowed on the web because it is itself a fixed scale.

## ADR-019 Product renamed from Horide to Musride (2026-11-05)

Decision by the owner. Everything in the repository now uses Musride: app names ("Musride", "Musride Driver"), website, staff console, SMS and notification texts, app IDs (`et.musride.passenger`, `et.musride.driver` — not yet published, so still changeable), code names (`musride_core`, `MusrideButton`, `@musride/*`), environment variables (`MUSRIDE_API_URL`, `MUSRIDE_KEYSTORE_*`), local database names, and docs. Earlier commit messages keep the old name.

Not renamed here (owner actions): the GitHub repository (`nasrullaah5555-web/Horide`; GitHub redirects after a rename), the Claude project name, and anything already created outside the repository. The launcher icons use a temporary "M" sign until the owner's logo arrives.

## ADR-020 A super admin may give themselves other staff roles (2026-11-06)

Decision by the owner, so a small team can run Musride from one account. A super admin can add or remove their own Support, Verification, Finance and Operations roles from Staff accounts; the console reloads to show the new menu. Two rules stay: nobody can remove their own Super role (so the company is never left without someone able to manage staff), and nobody can disable their own account. Every role change, including your own, is written to the audit log with who made it.

Trade-off accepted by the owner: separation of duties now depends on who is given Super, not on the software. One person holding Super can reach driver documents and money records. Keep the number of Super accounts small, and review `admin.roles_changed` in the audit log regularly.

## ADR-021 Kenya test mode for staging (2026-11-06)

Decision by the owner: try the apps in Kenya before the Jijiga pilot. One server setting, `KENYA_TEST_MODE=true` (staging only; the API refuses to start with it in production), does two things: it accepts Kenyan mobile numbers written with the country code (+254 7… or +254 1…), and it turns on a test service area, "Nairobi (TEST only)", a rectangle around Nairobi (lng 36.65–37.10, lat −1.45 to −1.10). Setting it back to false makes that area inactive again. The staging test apps are built with `MUSRIDE_ALLOW_KENYAN_PHONES=true`; store builds never are.

A number without +254 is always read as Ethiopian, because 07… numbers exist in both countries. Prices, currency (ETB), SMS wording and legal texts stay Jijiga's: this mode is for testing the app flow, not for running a Kenyan service. Real SMS to Kenyan numbers would need an SMS provider that sends to Kenya (staging uses the server log, so this doesn't matter yet).

## ADR-022 Ride PIN to start a trip (2026-11-06)

Like Uber's "Verify your ride". When a driver accepts, the server creates a random 4-digit PIN (operating-system random source) that only the passenger's app shows. The driver must enter it to start the trip, which proves the passenger is in the right car and stops a driver starting a trip without the passenger. Five wrong PINs lock the start for that trip (support or a cancellation is needed), so the PIN can't be guessed. The PIN is deleted when the trip starts, ends or is cancelled. Trade-off: one extra step for drivers at every pickup, and a passenger with a dead phone can't give the PIN (support can cancel; a staff override is a possible later addition).

## ADR-023 "Share my trip" links (2026-11-06)

Like Uber's "Share trip status". A passenger taps "Share trip with family" and sends a link by WhatsApp, Telegram, SMS or copy. The link opens a page on the Musride website (`/share/#<secret>`) that shows the trip's progress, the driver's first name, the car and plate, and the driver's position on a map, refreshing every 10 seconds. It never shows phone numbers or anything about the passenger. The secret (24 random bytes) sits after `#`, which browsers never send to web servers, and the database keeps only its SHA-256 hash. Once the trip ends or is cancelled the link shows only "Trip ended"; unknown links look the same. At most 5 links per trip. `POST /share/view` is the only new route open without a login (added to the route-security allowlist). Settings: `PUBLIC_WEB_URL` on the API (sharing is off without it) and `NEXT_PUBLIC_MUSRIDE_API_URL` on the website; the website must be in the API's `CORS_ORIGINS`.

## ADR-024 Place search through the server (2026-11-06)

Passengers search for pickups and destinations by name with suggestions while typing, and the pickup is named from the phone's location. The apps call `/places/search`, `/places/details` and `/places/reverse` on the Musride API; the API calls a provider, so a paid key never ships inside an app. Providers: `google` (Places API (New) Autocomplete + Place Details with one session token per search, Geocoding API for naming a map point; needs the owner's key, OA-26), `photon` (free OpenStreetMap search; the public server is allowed for testing only, production refuses it), `dev` (a few sample places; refused in production). Production must choose explicitly. Trade-off: Google costs money beyond its monthly free allowance; OpenStreetMap is free but has fewer small businesses in Jijiga and Nairobi.

## ADR-025 One market per deployment; staging can be Nairobi (2026-11-06)

Owner decision: make staging fully usable in Nairobi for testing, while the launch market stays Jijiga. Replaces ADR-021's Kenya test mode. `MARKET` on the API (`ET` default, `KE`) and the same choice when building the apps (`MUSRIDE_MARKET`) and website (`NEXT_PUBLIC_MUSRIDE_MARKET`) set: city name, currency (ETB or KES; amounts stay in minor units), payment methods (cash + eBirr, or cash + M-Pesa; both only recorded, never processed), phone numbers (Jijiga: Ethiopian only; Nairobi: Kenyan, plus Ethiopian written with +251), emergency numbers (991/907/939/945, or 999/112), where maps start, which service area is active, and the illustrative DEV prices and plan (KES test prices: car 150 + 40/km, tuk-tuk 70 + 25/km, not researched). The API publishes these at `GET /market` (public, nothing private); apps and console load it at start. Production refuses `KE`.

Not covered, on purpose: serving both cities from one deployment at the same time (per-city prices, currencies and payments in one database), and anything needed for a real Kenyan service: NTSA transport network company licence, registration with Kenya's Data Protection Commissioner, an M-Pesa (Daraja) business account, Kenyan terms and privacy policy. Those are owner decisions before any real Kenyan operation.

## ADR-026 Booking map: search first, pickup from GPS, two distinct markers (2026-11-06)

The owner's phone video showed three faults: every place search failed on staging, the pickup was wherever the map's centre pin happened to be (so scrolling the map moved it), and pickup and destination looked alike, ending in a 0.6 km trip that was not the one wanted. Changed, following Faras and Bolt:
- The pickup starts at the phone's position. Scrolling or zooming the map only looks around and never moves the pickup or the destination. The map cannot be rotated.
- Pickup and destination are chosen by searching by name; tapping a result is the answer, with no pin to adjust. "Use my current location" is offered first for the pickup. Dragging the map under a fixed pin is still there as "Choose on the map", for a spot without a name, and shows the trip's other end so the two can't be confused.
- Pickup = round green dot, destination = navy square, a dashed line between them (direction only; the price still uses the server's road distance), and the map fits both above the bottom panel. Same markers on the trip screens of both apps.
- The landmark for the driver is a separate optional field. A landmark typed after the prices came, or prices older than 5 minutes, get fresh prices before booking; if the price changed, the new one is shown instead of booking.
- Place search on staging failed because Photon's public server blocks requests with generic agents such as Node's default `node`; fixed separately in PR #22 (Photon requests now name Musride and a contact). Not verified against Photon from the development workspace (the site is not reachable from it).

Not done: drawing the actual road route (needs a routing provider's geometry, OA-09) and showing nearby available cars before booking.

# Horide — Task Register

Status values: TODO · IN PROGRESS · DONE (acceptance met, tests pass) · IMPLEMENTED – NOT COMPILED (mobile, awaiting CI/owner build) · BLOCKED – OWNER ACTION REQUIRED.

Each task lists: objective · depends on · components · security · acceptance · tests.

## Phase 0 — Foundation

**T-001 Planning documents** — DONE
Objective: PRD, architecture, DB design, security plan, roadmap, ADRs, registers. · Depends: — · Components: `docs/` · Acceptance: all 14 tracking documents exist and agree with the master prompt. · Tests: manual consistency review.

**T-002 Monorepo foundation** — DONE
Objective: Git repo, pnpm workspace, folder layout, `.gitignore`, `.editorconfig`, Prettier, env templates, README, commit convention. · Depends: T-001 · Security: `.env*` ignored except `.example`. · Acceptance: `pnpm install` succeeds; no secrets tracked. · Tests: `git check-ignore .env` passes.

**T-003 Local infrastructure** — DONE
Objective: `infra/docker-compose.yml` (PostGIS), non-Docker setup script, `.env.example` per app. · Depends: T-002 · Acceptance: database starts and `CREATE EXTENSION postgis` works. · Tests: script smoke run.

**T-004 CI pipeline** — IMPLEMENTED (awaiting first GitHub run)
Objective: GitHub Actions: install, lint, typecheck, backend tests against PostGIS service container, admin/website build, Flutter analyze + test, gitleaks, dependency audit. · Depends: T-002, OA-01 to run · Acceptance: workflow valid; green run on GitHub (verified only after OA-01).

## Phase 1 — Backend foundation

**T-005 NestJS skeleton** — DONE
Objective: app bootstrap, config validation (zod), `/health`, pino logging with redaction, Helmet, CORS allow-list, global validation, uniform error format. · Depends: T-002 · Security: startup refuses dev adapters in production. · Acceptance: `/health` returns DB status; invalid env aborts boot. · Tests: e2e health, config unit tests.

**T-006 Database layer & identity migrations** — DONE
Objective: Kysely, migrator, migration 001 (extensions, enums, users, profiles, otp_challenges, auth_sessions, admin_users, admin_roles, audit_logs). · Depends: T-005 · Acceptance: migrate up/down/up clean. · Tests: migration test.

**T-007 Fleet, geo, pricing migrations** — TODO
vehicles, driver_documents, service_zones, driver_locations, saved_locations, fare_settings, fare_versions. Acceptance: GiST indexes present; constraints tested.

**T-008 Trip, payment, subscription, feedback migrations** — TODO
trips (partial unique indexes), trip_offers, trip_events, trip_destination_changes, trip_locations, payments, payment_confirmations, subscription_plans, subscriptions (exclusion constraint), subscription_payments, ratings, complaints, emergency_events, notifications, device_tokens. Acceptance: constraint tests prove one active trip per driver and no overlapping subscriptions.

**T-009 Development seed** — TODO
Jijiga service zone (approximate polygon, marked DEV), illustrative fares, test plan. Refuses to run in production.

## Phase 2 — Authentication

**T-010 SMS adapter** — TODO · Console + fake providers; AfroMessage adapter written, untested until OA-08.
**T-011 OTP flow** — TODO · Request/verify with limits, expiry, replay protection. Tests: brute force, replay, expiry, rate limits.
**T-012 Sessions** — TODO · Access/refresh, rotation, reuse detection, logout, role guards. Tests: rotation, reuse revokes family.
**T-013 Admin auth & RBAC** — TODO · Argon2id, TOTP, permission decorator, audit service. Tests: role matrix, MFA required.

## Phase 3 — Domain backend

**T-014 Passenger profile & saved locations** — TODO
**T-015 Storage adapter & secure uploads** — TODO · Local disk + S3-compatible; magic-byte checks; signed URLs.
**T-016 Driver onboarding** — TODO · Profile, vehicle, documents, status.
**T-017 Admin verification** — TODO · Approve/reject documents, vehicles, drivers; audited.
**T-018 Service zones & routing adapter** — TODO · Point-in-zone; dev routing estimate flagged; Google/OSRM adapters (live test blocked by OA-09).
**T-019 Fare engine & quotes** — TODO · Pure fare function (integer maths), versions, signed quotes. Tests: table-driven fare tests, min fare, rounding, tampered quote rejected.
**T-020 Subscriptions & eligibility** — TODO · Plans, manual payment recording, eligibility predicate. Tests: expired/suspended/unapproved excluded; active trip unaffected by expiry.
**T-021 Availability & location ingestion** — TODO · Online/offline, plausibility checks, staleness.
**T-022 Trip request & matching** — TODO · KNN, waves, offer expiry, trip expiry.
**T-023 Atomic acceptance** — TODO · Tests: 20 concurrent accepts → exactly 1 winner.
**T-024 Trip lifecycle & cancellation** — TODO · State machine, events, cancellation rules. Tests: every illegal transition rejected.
**T-025 Destination change** — TODO · Re-quote + passenger approval.
**T-026 Realtime gateway** — TODO · Socket.IO auth, rooms, resync endpoint.
**T-027 Ride payment records** — TODO · Record, confirm, dispute, admin resolve. Tests: non-party cannot confirm; no confirm before completion.
**T-028 Ratings, complaints, emergency** — TODO
**T-029 Notifications** — TODO · FCM adapter (live test blocked by OA-11), in-app list.
**T-030 Admin APIs & reports** — TODO · Real aggregates only.
**T-031 API-wide rate limiting & authz test suite** — TODO

## Phase 4 — Admin dashboard

**T-032 Admin foundation** — design tokens, layout, login + MFA.
**T-033 Drivers & verification screens**
**T-034 Trips, passengers, live map**
**T-035 Pricing, subscriptions, payments, complaints**
**T-036 Admin accounts, roles, audit viewer, reports**

## Phase 5 — Mobile (compiled only in CI / on owner laptop — ADR-014)

**T-037 horide_core package** — API client, models, secure token storage, design system, connectivity handling.
**T-038 Passenger: auth, map home, quote, booking**
**T-039 Passenger: tracking, payment, rating, history, complaints, SOS**
**T-040 Driver: auth, onboarding, documents, subscription status**
**T-041 Driver: online/offline, background location, offers, trip flow, payments, earnings**

## Phase 6 — Website

**T-042 Public website** — home, how it works, drivers, safety, privacy, terms, contact.

## Phase 7 — Hardening and release

**T-043 Security review & scanning**
**T-044 Load test: matching & location ingestion**
**T-045 Deployment configuration** — Render blueprint, migration procedure, backups, health checks, Cloudflare guide (live deploy blocked by OA-12/13/14).
**T-046 Mobile release configuration** — signing, store listings (BLOCKED by OA-04/05).
**T-047 Pilot runbook** — incident response, breach notification, support process.

# Completed Tasks

Only tasks whose acceptance criteria are met, with evidence.

## T-001 Planning documents — 2026-11-04
Evidence: 14 documents in `docs/`. Facts checked against sources: Ethiopia Personal Data Protection Proclamation No. 1321/2024 (cross-border transfer limits, ECA registration, 72-hour breach notice); absence of a dedicated national ride-hailing regulator (Capital Ethiopia, July 2026).
Workspace verification: Node 22.23, pnpm, Git 2.43, PostgreSQL 16 with PostGIS installed and `CREATE EXTENSION postgis` succeeded. Flutter SDK host and pub.dev return HTTP 403 → ADR-014.

## T-002 Monorepo foundation — 2026-11-04
Evidence: see commit history. `pnpm install` result and ignore checks recorded in TEST_REPORT.md.

## T-003 Local infrastructure — 2026-11-04
Evidence: `infra/docker-compose.yml`, `infra/setup-local-postgres.sh`. Script run successfully here. The Docker path was not run (no Docker daemon in this workspace) — it is exercised by the owner and indirectly by CI, which uses the same `postgis/postgis:16-3.4` image.

## T-005 NestJS skeleton — 2026-11-04
Evidence: `apps/backend/src`. Config validation refuses development adapters, non-SSL database and non-https CORS in production. Health endpoint, Helmet headers, CORS allow-list, 100 kB body limit, uniform error format, log redaction. Tests: `src/config/env.spec.ts`, `test/health.e2e-spec.ts`.

## T-006 Database layer & identity migrations — 2026-11-04
Evidence: `apps/backend/src/database`. Migration 0001 with Ethiopian phone format check, one account per phone per role, suspension reason required, approval must record approver, append-only audit log enforced by trigger. Tests: `test/migrations.int-spec.ts` (up/down/up and every constraint).

## T-007/T-008 Remaining migrations — 2026-11-05
Evidence: migrations 0002 and 0003; `test/migrations-domain.int-spec.ts`.

## T-009 Development seed — 2026-11-05
Evidence: `src/database/seed-dev.ts`; `test/seed.int-spec.ts`. Zone and fares are explicitly marked DEV/illustrative.

## T-010–T-012 Passenger and driver authentication — 2026-11-05
Evidence: `src/modules/auth`; `test/auth.e2e-spec.ts`, `src/modules/auth/auth-units.spec.ts`. Production SMS adapter intentionally not implemented (OA-08).

## T-013 Admin authentication, RBAC and audit — 2026-11-05
Evidence: `src/modules/admin-auth`, `src/modules/audit`; `test/admin-auth.e2e-spec.ts`, `src/modules/admin-auth/admin-units.spec.ts`.

## T-014 Passenger profile & saved places — 2026-11-05
Evidence: `src/modules/users`; `test/onboarding.e2e-spec.ts`.

## T-015–T-017 Uploads, driver onboarding, admin verification — 2026-11-05
Evidence: `src/modules/storage`, `src/modules/drivers`; `test/onboarding.e2e-spec.ts`, `src/modules/storage/storage.spec.ts`. Required documents list in `driver-requirements.ts` (insurance/permits pending OA-16).

## T-018–T-019 Zones, routing, fare engine, quotes — 2026-11-05
Evidence: `src/modules/pricing`, `src/modules/geo`; `src/modules/pricing/pricing-units.spec.ts`, `test/pricing.e2e-spec.ts`.

## T-020 Subscriptions & eligibility — 2026-11-05
Evidence: `src/modules/subscriptions`, `driver-eligibility.service.ts`; `test/subscriptions.e2e-spec.ts`.

## T-021–T-024 Core ride flow — 2026-11-05
Evidence: `src/modules/locations`, `src/modules/trips` (state machine, matching, acceptance, lifecycle, views), migration 0005; `test/trips.e2e-spec.ts`, `src/modules/trips/trip-state.spec.ts`.
Known limits: matching sweeper runs in-process every 5 s (single instance, ADR-005); a driver cancelling after acceptance cancels the trip rather than re-dispatching it (re-dispatch is a candidate improvement).

## T-025–T-028 Destination change, realtime, payments, feedback — 2026-11-05
Evidence: `src/modules/trips/destination-change.service.ts`, `src/modules/realtime`, `src/modules/payments`, `src/modules/feedback`; `test/ride-extras.e2e-spec.ts`, `test/realtime.e2e-spec.ts`.
Emergency numbers (Police 991, Ambulance 907, Fire 939, Traffic 945) from Wikipedia's list; local confirmation is owner action OA-19.

## T-029–T-031 Notifications, admin operations, rate limiting — 2026-11-05
Evidence: `src/modules/notifications`, `src/modules/admin-ops`, `src/common/rate-limit.ts`; `test/ops.e2e-spec.ts`, `test/route-security.e2e-spec.ts`.
Backend v1 scope complete. Remaining backend items are blocked on owner actions: SMS (OA-08), routing (OA-09), storage bucket (OA-12), push (OA-11), eBirr API (OA-10).

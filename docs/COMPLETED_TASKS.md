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

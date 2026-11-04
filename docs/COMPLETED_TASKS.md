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

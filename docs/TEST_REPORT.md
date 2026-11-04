# Test Report

Only results that were actually run. Format: date · task · command · result.

| Date | Task | What was run | Result |
|---|---|---|---|
| 2026-11-04 | T-001 | `CREATE EXTENSION postgis; SELECT postgis_full_version();` on local PostgreSQL 16 | Passed |
| 2026-11-04 | T-001 | HTTPS reachability: storage.googleapis.com (Flutter), pub.dev | 403 — Flutter cannot be installed in this workspace |
| 2026-11-04 | T-003 | `infra/setup-local-postgres.sh` (socket path adapted for this workspace) | Passed — `horide` and `horide_test` created with postgis, pgcrypto, citext |
| 2026-11-04 | T-005/T-006 | `pnpm --filter @horide/backend test` (Jest, local PostgreSQL 16 + PostGIS) | Passed — 34/34 tests, 3 suites |
| 2026-11-04 | T-005/T-006 | `pnpm typecheck`, `pnpm lint`, `pnpm build` | Passed |
| 2026-11-04 | T-005 | Started `dist/main.js`, `GET /health` | `{"status":"ok","database":"up"}`; unknown route 404 |
| 2026-11-04 | T-005 | Production boot with development adapters | Refused, all 5 problems listed |
| 2026-11-04 | T-006 | `pnpm migrate` run twice on development database | First applied 0001, second "up to date" |
| 2026-11-04 | T-004 | `pnpm audit --prod --audit-level high` | First run: 1 high (multer < 2.5.0 DoS, via Nest). Fixed with override to 2.5.0; re-run: no known vulnerabilities |

Defects found by tests and fixed: oversized JSON returned 500 instead of 413; malformed JSON returned the parser's raw message (could echo request fragments) — now a fixed `INVALID_JSON` error.
Not yet verified: CI on GitHub (first run happens after this push).
| 2026-11-04 | T-004 | First GitHub Actions run on `main` (run 41909539260) | Passed: backend job (lint, typecheck, 34 tests against PostGIS, build) and security job |
| 2026-11-04 | T-004 | Dependabot PR runs | Failed: gitleaks needed `pull-requests: read`. Fixed; Dependabot now groups minor/patch and skips majors |

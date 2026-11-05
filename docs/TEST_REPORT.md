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

| 2026-11-05 | T-007/T-008 | Constraint tests for migrations 0002–0003 | Passed (plates, one active vehicle, private document keys, immutable fares, category-matched pricing, one active trip per driver/passenger, no overlapping subscriptions, single payment confirmation per party) |
| 2026-11-05 | T-009 | Seed run twice on dev DB; production refusal | Idempotent; production refused |
| 2026-11-05 | T-010–T-012 | OTP + session e2e tests | Passed: brute force lock, replay, expiry, cooldown, per-phone/IP limits, enumeration, SMS failure, rotation, reuse detection, logout, forged and alg=none tokens |
| 2026-11-05 | T-013 | Admin e2e + unit tests | Passed: RFC 6238 vector, MFA required, TOTP replay, lockout, CSRF, idle timeout, permission matrix, audit of admin actions |
| 2026-11-05 | T-013 | `pnpm admin:create` on dev DB | Created admin; duplicate refused |
| 2026-11-05 | all | Full backend suite | 128/128 passed |

| 2026-11-05 | T-014–T-017 | Profile, upload, onboarding and verification e2e tests | Passed: IDOR on saved places, content-sniffed uploads (disguised HTML rejected), 8 MB limit, path traversal, storage keys never exposed, approval only when complete, audited downloads, role separation, suspension takes driver offline, SQL/wildcard-safe search |
| 2026-11-05 | T-018–T-019 | Fare engine worked examples + quote/pricing e2e | Passed: 7 hand-calculated fares, exact integer maths, tampered/expired quotes rejected, zone checks, short-trip check, client-sent price rejected, versioned prices audited, invalid zone shape rejected |
| 2026-11-05 | T-020 | Subscription e2e tests | Passed: payment makes driver eligible, early renewal extends without overlap, 3 concurrent renewals never overlap, amount/date/reference validation, expiry and cancellation remove eligibility, finance-only |
| 2026-11-05 | all | Full backend suite | 187/187 passed |

| 2026-11-05 | T-021 | Availability/location e2e + unit tests | Passed: ineligible driver can't go online (reasons shown), inaccurate/future fixes refused, teleport dropped, out-of-order point can't overwrite newer one |
| 2026-11-05 | T-022 | Matching e2e | Passed: only nearby eligible drivers of the right category get offers (excluded: wrong category, far, stale fix, expired subscription, suspended); reject → next driver; wave 2 reaches further; trip expires after search limit; same quote books once; no second open trip; another passenger's quote refused |
| 2026-11-05 | T-023 | 20 concurrent accepts on one trip | Passed: exactly 1 winner, 19 × 409, one `accepted` event, fare locked. Repeated 5× in isolation: 5/5 passed |
| 2026-11-05 | T-024 | Lifecycle e2e + state-machine unit tests | Passed: full ride with event trail, payment record for locked fare, out-of-order and wrong-party steps refused, nobody but admin cancels in progress, expiring subscription does not interrupt an accepted trip (BR-05), IDOR, phone hidden after trip, stale location labelled not live |
| 2026-11-05 | all | Full backend suite | 214/214 passed |

| 2026-11-05 | T-025 | Destination change e2e | Passed: server re-price, fare unchanged until approval, reject keeps fare, expired proposal refused, outside-zone refused, drivers/strangers refused |
| 2026-11-05 | T-027 | Payment record e2e | Passed: cash confirm flow, eBirr reference rules, not before completion, not by strangers, once per party, dispute → finance resolve (support refused), resolved is final, audited |
| 2026-11-05 | T-028 | Ratings/complaints/emergency e2e | Passed: one rating per party, driver average recomputed from ratings only, unfinished/stranger trips refused, complaint names other party, audited resolution, finance can't handle complaints, emergency recorded with position and returns numbers, never refused for a bad trip id |
| 2026-11-05 | T-026 | Socket.IO e2e (real server on a port) | Passed: invalid token disconnected, driver receives offer, passenger receives accepted trip with vehicle, live location delivered, a stranger's socket receives nothing |
| 2026-11-05 | T-026 | Built server started; `/health` and `/realtime` polling handshake | Both responded |
| 2026-11-05 | all | Full backend suite | 230/230 passed |

| 2026-11-05 | T-029 | Notifications e2e | Passed: accepted/arrived notifications stored and pushed to the registered device, read/read-all, IDOR on read refused, device token moves to latest account, broadcast audited and operations-only |
| 2026-11-05 | T-030 | Admin ops e2e | Passed: dashboard counts change with real trips, daily report covers empty days, live map freshness, trip detail with event trail, admin cancel of in-progress trip audited (finance refused), passenger suspend/reinstate blocks and restores quotes |
| 2026-11-05 | T-031 | Rate limit e2e + unit | Passed: 21st quote in a minute → 429 with Retry-After, other users unaffected, health never limited, window reset |
| 2026-11-05 | T-031 | Route security audit (all controllers) | Passed. Verified it detects problems by removing one admin permission and one user guard: both reported, then restored |
| 2026-11-05 | all | Full backend suite | 247/247 passed; production build OK |

| 2026-11-05 | T-032–T-036 | Admin dashboard `pnpm lint`, `typecheck`, `build` (Next.js 15.5) | Passed; 18 routes built |
| 2026-11-05 | T-032–T-036 | `apps/backend/scripts/dev-demo.ts` (sample data through the real HTTP API) + `apps/admin/e2e/screenshots.mjs` (Playwright, real sign-in with TOTP) | All 17 desktop screens + 3 mobile screens rendered with no error messages, no failed requests, no console errors |
| 2026-11-05 | T-036 | Created a support-only account through the dashboard, signed in as it | Menu limited to 6 permitted sections; driver page shows no approve/reject/suspend/download; direct GET /admin/pricing → 403 |
| 2026-11-05 | T-034 | Live map | Driver markers, legend, freshness and attribution render. Map tiles NOT verified: this workspace's network blocks tile.openstreetmap.org |

Defects found during dashboard screenshot review and fixed: sidebar footer could overlap the menu on short screens; "Ebirr"/"National id" labels; "Approve driver" clickable before requirements were met (server already refused it); service-area outline outside the initial map view; misaligned price inputs; status badges wrapping on mobile; screenshot script initially re-used a TOTP code, correctly refused by the server's replay protection.

Defects found by tests and fixed: oversized JSON returned 500 instead of 413; malformed JSON returned the parser's raw message (could echo request fragments) — now a fixed `INVALID_JSON` error.
Not yet verified: CI on GitHub (first run happens after this push).
| 2026-11-04 | T-004 | First GitHub Actions run on `main` (run 41909539260) | Passed: backend job (lint, typecheck, 34 tests against PostGIS, build) and security job |
| 2026-11-04 | T-004 | Dependabot PR runs | Failed: gitleaks needed `pull-requests: read`. Fixed; Dependabot now groups minor/patch and skips majors |
| 2026-11-05 | T-004 | CI secret scan after T-013 | Failed: 3 findings, all intentional public values (dev placeholder key, fake test secret, RFC 6238 test vector). Allowlisted by exact value, not by file. Local gitleaks: history clean; a planted fake key in `test/` is still detected |

# Musride — Security Plan

Baselines: OWASP ASVS (backend/web), OWASP MASVS (mobile), OWASP API Security Top 10.

## 1. Threats specific to Musride

| Threat | Control | Test |
|---|---|---|
| OTP brute force | 6 digits, 5 min expiry, 5 attempts per challenge, 3 challenges / phone / 15 min, 10 / IP / hour; codes hashed (HMAC-SHA256 with server pepper) | Unit + integration |
| OTP replay | `consumed_at` set atomically on success; second use fails | Integration |
| SMS pumping (cost abuse) | Ethiopia-only number prefix (+251), per-IP and global hourly caps, alerting | Integration |
| Account takeover via refresh token theft | Rotation + reuse detection revokes family; tokens hashed at rest; mobile stores in Keychain/Keystore | Integration |
| IDOR (reading another user's trip) | Every query scoped by owner in the WHERE clause; authorization tests per endpoint | Dedicated authz test suite |
| Broken admin access control | Permission decorator per route, deny by default | Role matrix tests |
| Duplicate trip acceptance | Conditional update + partial unique index (ADR-011) | Concurrent acceptance test |
| Fare tampering | Server-side fare, signed quote token, fare version stored | Unit + negative tests |
| Subscription bypass | Eligibility checked in SQL at offer time and at accept time | Integration |
| Fake payment confirmation | Only trip parties, only after completion, once each, audited | Integration |
| GPS spoofing / teleport | Reject points with impossible speed (> 150 km/h between points), poor accuracy (> 100 m), future timestamps, and points Android reports as mock locations (logged for staff) | Integration |
| Driver document leak | Private bucket, server-generated signed URLs (5 min) only for verification admins; downloads audited | Integration |
| Malicious upload | Size cap 8 MB, magic-byte type check (JPEG/PNG/PDF only), random storage keys, never served from API origin | Unit |
| SQL injection | Kysely parameterised queries only; raw `sql` with bound params; lint rule forbids string concatenation into `sql.raw` | Code review + tests |
| XSS (admin) | React escaping, no `dangerouslySetInnerHTML`, strict CSP | Header check |
| CSRF (admin) | Admin session in httpOnly SameSite=Strict cookie + CSRF token on mutations | Integration |
| Secrets in repo | `.env` gitignored, `.env.example` only, gitleaks in CI | CI |
| Vulnerable dependencies | `pnpm audit`, Dependabot | CI |

## 2. Authentication

- Users: phone OTP → access JWT (15 min, EdDSA or HS256 with 256-bit secret) + refresh token (30 days, rotating).
- Admins: email + scrypt password (N=2^17) + TOTP (mandatory, replay-protected, secret encrypted with AES-256-GCM), 12 h absolute session, 30 min idle timeout, lockout after 10 failures.
- Logout revokes the session family.

## 3. Authorization

- Role guard (passenger/driver) + resource ownership in queries.
- Admin permissions map: support, verification, finance, operations, super. Super admin cannot read driver documents unless also verification role.

## 4. Transport and headers

HTTPS only (Cloudflare + Render TLS), HSTS, Helmet defaults, CORS allow-list (admin and website origins only; mobile apps don't need CORS).

## 5. Rate limiting

Global 100 req/min per user, stricter per endpoint (OTP, quotes 20/min, location 30/min).

## 6. Data protection and privacy (Proclamation No. 1321/2024)

- Register as a data controller with the Ethiopian Communications Authority before processing (OA-07).
- Cross-border transfer (non-Ethiopian hosting) needs a lawful basis — owner/legal decision (OA-07).
- Breach notification to the authority within 72 hours of awareness; runbook in DEPLOYMENT_GUIDE.
- Data minimisation: no email for passengers; trip location history retention 180 days (hourly purge, `RetentionService`); account deletion in both apps (`POST /account/delete`, removes personal data and driver documents, keeps anonymous trip/payment records). Tested — see TEST_REPORT 2026-11-05 T-048. Legal retention periods for business records: OA-07.
- Driver identity documents treated as highly sensitive.

## 7. Mobile (MASVS)

Tokens in flutter_secure_storage; no secrets in the app bundle (only public API base URL and Maps SDK key restricted by package/bundle ID); release builds obfuscated; certificate pinning considered after pilot (risk of lock-out on cert change); no sensitive data in logs.

## 8. Monitoring

Structured JSON logs (no OTP codes, tokens or document URLs), error tracking, alerts on: OTP volume spikes, 5xx rate, failed admin logins, refresh-token reuse events.

## 9. Verification status (security review T-043, 2026-11-05)

"Tested" means an automated test exercises the control and is recorded in TEST_REPORT.md. "Implemented" means the code exists but has no automated test. Nothing here has had an external penetration test.

| Control | Status | Evidence |
|---|---|---|
| OTP limits, expiry, replay, hashing, enumeration | Tested | `test/auth.e2e-spec.ts` |
| Refresh rotation, reuse detection, logout | Tested | `test/auth.e2e-spec.ts` |
| Admin password + TOTP, replay, lockout, CSRF, idle timeout, role matrix | Tested | `test/admin-auth.e2e-spec.ts` |
| Every route has a login guard and permission | Tested | `test/route-security.e2e-spec.ts` |
| IDOR on trips, places, receipts, ratings | Tested | onboarding, trips, ride-extras e2e |
| Duplicate acceptance (20 concurrent) | Tested | `test/trips.e2e-spec.ts` |
| Fare tampering (signed quotes, client prices refused) | Tested | `test/pricing.e2e-spec.ts` |
| Subscription bypass | Tested | `test/subscriptions.e2e-spec.ts`, `test/trips.e2e-spec.ts` |
| Fake payment confirmation | Tested | `test/ride-extras.e2e-spec.ts` |
| GPS: jump, accuracy, future, mock location | Tested (server); driver app sends the mock flag — compiled in CI only | `test/trips.e2e-spec.ts`, driver `test/app_test.dart` |
| Upload type sniffing, size, private keys, audited download | Tested | `test/onboarding.e2e-spec.ts` |
| Rate limiting, production cannot disable | Tested | `test/ops.e2e-spec.ts`, config tests |
| Client IP behind proxies (rate limits not shared, not forgeable) | Tested | `test/proxy.e2e-spec.ts`; set `TRUST_PROXY_HOPS=2` behind Cloudflare + Render |
| Account deletion, retention purge | Tested | `test/account.e2e-spec.ts` |
| Secrets not in repo | CI (gitleaks) | `ci.yml` security job |
| Dependency vulnerabilities | CI (`pnpm audit --prod --audit-level high`), Dependabot | `ci.yml` |
| Admin CSP and headers | Implemented; checked by hand in the browser | `apps/admin/next.config.ts` |
| Website headers | Implemented for Cloudflare Pages; not yet deployed | `apps/web/public/_headers` |
| Mobile: tokens in Keystore/Keychain, no backup of app data | Implemented, compiled in CI, not tested on a device (OA-21) | `token_store.dart`, Android `data_extraction_rules.xml` |
| Mobile release obfuscation | Not done — release configuration T-046 | — |
| Encrypted backups, restore drill | Not done — needs hosting (OA-12/13) | DATABASE_DESIGN |
| Monitoring and alerts | Not done — needs hosting | §8 |
| Certificate pinning | Deliberately not done before the pilot (lock-out risk) | §7 |

Known residual risks: an access token stays valid for read-only requests up to 15 minutes after suspension or deletion (all changes re-check the account); the eBirr reference typed by a driver is not verified (OA-10); a modified driver app could hide the mock-location flag, so speed and accuracy checks remain the main GPS defence; rate limits are in memory and reset on restart (single instance, ADR-005).

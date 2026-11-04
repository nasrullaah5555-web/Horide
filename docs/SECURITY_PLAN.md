# Horide — Security Plan

Baselines: OWASP ASVS (backend/web), OWASP MASVS (mobile), OWASP API Security Top 10.

## 1. Threats specific to Horide

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
| GPS spoofing / teleport | Reject points with impossible speed (> 150 km/h between points), poor accuracy (> 100 m), future timestamps; flag device mock-location (Android) | Unit |
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
- Data minimisation: no email for passengers; trip location history retention 180 days; account deletion endpoint.
- Driver identity documents treated as highly sensitive.

## 7. Mobile (MASVS)

Tokens in flutter_secure_storage; no secrets in the app bundle (only public API base URL and Maps SDK key restricted by package/bundle ID); release builds obfuscated; certificate pinning considered after pilot (risk of lock-out on cert change); no sensitive data in logs.

## 8. Monitoring

Structured JSON logs (no OTP codes, tokens or document URLs), error tracking, alerts on: OTP volume spikes, 5xx rate, failed admin logins, refresh-token reuse events.

## 9. Verification status

Nothing in this plan is verified yet. Each control moves to "Tested" only with a passing test recorded in TEST_REPORT.md.

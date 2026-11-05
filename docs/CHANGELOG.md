# Changelog

## Unreleased

### Added
- Planning documents: requirements, architecture, database design, security plan, ADRs, roadmap, task and owner action registers.
- Monorepo foundation: pnpm workspace, folder structure, editor and formatting config, environment templates.
- Local database setup (Docker and non-Docker).
- Backend foundation: NestJS API with validated configuration, health check, security headers, error format and log redaction.
- Database migration 0001: users, profiles, OTP challenges, sessions, admins, roles, append-only audit log.
- CI: lint, typecheck, tests against PostGIS, build, secret scanning, dependency audit. Dependabot.

- Migrations 0002–0004: vehicles, documents, zones, locations, versioned fares, trips, offers, payments, subscriptions, ratings, complaints, emergencies, notifications, admin sessions.
- Development seed (approximate Jijiga zone, illustrative fares).
- Phone OTP login with rotating sessions; admin login with password + TOTP, role-based permissions, CSRF protection, audit log; `admin:create` CLI.
- Passenger profile and saved places; driver onboarding with private document uploads; admin verification, suspension and audited document access.
- Fare engine (integer santim), service zones, signed quotes, versioned admin pricing.
- Driver subscriptions: plans, payment recording, early renewal, eligibility rules.
- Core ride flow: driver availability and GPS ingestion with plausibility checks, trip booking from signed quotes, wave-based matching, single-winner acceptance, trip lifecycle with event history, payment record on completion.
- Destination change with server re-pricing and passenger approval; live updates over Socket.IO; ride payment records with confirmation, disputes and finance resolution; ratings, complaints and emergency alerts with admin handling.
- In-app notifications with push adapter, device registration and admin broadcasts; admin dashboard counts, daily reports, live driver map, passenger and trip management.
- Admin dashboard (apps/admin) covering every staff workflow, with menus and actions limited to each person's roles; dev demo data script and screenshot check.
- Mobile apps (Flutter, Android + iOS from one codebase), compiled and tested in CI only, not yet run on a device:
  - Shared `horide_core` package: API client with single-flight token refresh, secure token storage, models matching the backend, design system, offline banner, emergency sheet.
  - Passenger app: phone login, map-pin pickup, destination picker, server prices for car and Bajaj, cash/eBirr, booking, live trip with driver details and plate, stale-location warning, destination change with price approval, cancel, emergency, payment confirmation or dispute, driver rating, history, receipts, complaints, profile.
  - Driver app: phone login, onboarding (name, vehicle, document photos, review status), subscription status, online/offline through the server, battery-aware location reporting with offline buffering, ride offers with countdown, trip steps, navigation via the phone's maps app, payment recording, passenger rating, earnings summary.
- CI: Flutter format/analyze/test for all three packages, automatic `dart format` commits, unsigned Android build on every mobile change, iOS build on demand.
- Account deletion from both apps and the API; hourly purge of old trip GPS history, OTP challenges and ended sessions (migration 0006).
- Public website (`apps/web`, static): home, how it works, drive with Horide, safety, privacy policy (draft), terms (draft), contact, account deletion instructions.

### Security
- Per-user/IP rate limits with stricter limits on OTP, quotes, bookings, location, uploads and admin login; production refuses to disable them.
- Automated route audit fails the build if any endpoint lacks its login guard or permission.
- Forced `multer` ≥ 2.5.0 to fix a denial-of-service advisory in a transitive dependency.

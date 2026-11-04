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

### Security
- Forced `multer` ≥ 2.5.0 to fix a denial-of-service advisory in a transitive dependency.

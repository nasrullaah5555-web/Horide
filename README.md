# Musride

Ride-hailing platform for Jijiga, Ethiopia. Cars and Bajaj. Drivers pay a monthly subscription; passengers pay drivers directly in cash or eBirr.

> Status: early development. Nothing here is deployed or production-ready. See `docs/TASK_REGISTER.md` for exact progress.

## What's in this repository

| Folder                 | What it is                                          | Technology                               |
| ---------------------- | --------------------------------------------------- | ---------------------------------------- |
| `apps/backend`         | The API: all business rules, fares, matching, trips | NestJS, TypeScript, PostgreSQL + PostGIS |
| `apps/admin`           | Admin dashboard for staff                           | Next.js, Tailwind                        |
| `apps/website`         | Public website and legal pages                      | Next.js                                  |
| `mobile/passenger`     | Passenger app (Android + iOS)                       | Flutter                                  |
| `mobile/driver`        | Driver app (Android + iOS)                          | Flutter                                  |
| `packages/musride_core` | Shared Dart code for both apps                      | Dart                                     |
| `infra`                | Local database setup, deployment config             | Docker, scripts                          |
| `docs`                 | Plans, decisions, registers, test reports           | Markdown                                 |

Start with `docs/PROJECT_MASTER_PLAN.md`.

## Requirements for local development

- Node.js 22 LTS and pnpm (`corepack enable`)
- PostgreSQL 16 with PostGIS (or Docker, see `infra/`)
- Flutter stable (mobile apps only)

## Quick start (backend, once implemented)

```bash
pnpm install
cp apps/backend/.env.example apps/backend/.env
pnpm --filter @musride/backend migrate
pnpm --filter @musride/backend dev
```

## Rules

- Never commit `.env` files, keys or credentials.
- Commit messages follow Conventional Commits: `feat(trips): atomic acceptance`, `fix(auth): ...`, `docs: ...`, `test: ...`, `chore: ...`.
- `main` must always pass CI. Work on `feat/<task-id>-short-name` branches when working with others.

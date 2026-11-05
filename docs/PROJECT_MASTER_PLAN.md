# Horide — Project Master Plan

## Goal
A working, tested ride-hailing platform for a closed pilot in Jijiga: passenger app, driver app, admin dashboard, public website, one backend.

## Documents
| Document | Purpose |
|---|---|
| PRODUCT_REQUIREMENTS.md | What to build, testable rules |
| SYSTEM_ARCHITECTURE.md | How the parts fit |
| DATABASE_DESIGN.md | Tables, constraints, backups |
| SECURITY_PLAN.md | Threats and controls |
| ARCHITECTURE_DECISIONS.md | Decisions and changes from the master prompt |
| DEVELOPMENT_ROADMAP.md | Phases and estimates |
| TASK_REGISTER.md | Every task and status |
| COMPLETED_TASKS.md | Evidence for finished tasks |
| BLOCKED_TASKS.md | Tasks waiting on something |
| OWNER_ACTION_REGISTER.md | What only the owner can do |
| TEST_REPORT.md | Real test results only |
| DEPLOYMENT_GUIDE.md | How to deploy, back up, restore, release the apps |
| DESIGN_SYSTEM.md | The single source of colours, sizes and components, and how it is enforced |
| PILOT_RUNBOOK.md | Go/no-go, daily operations, incidents, breaches, support |
| CHANGELOG.md | Version history |

## Changes from the master prompt (all documented as ADRs)
1. Redis deferred until scale requires it (ADR-005).
2. Supabase used only as database/storage, not for auth (ADR-003, ADR-004).
3. Passenger web booking deferred; website is informational + legal (ADR-009).
4. Navigation handed to the phone's maps app (ADR-013).

## Top risks
| Risk | Impact | Mitigation |
|---|---|---|
| Drivers won't pay a subscription | Business fails | OA-17: validate before heavy spending |
| Unclear licensing | Launch blocked | OA-06 early |
| Map/search quality in Jijiga | Wrong pickups, wrong fares | OA-09 field test; manual pin always available |
| SMS delivery unreliable | Users can't log in | Provider adapter; test with real Ethio Telecom and Safaricom numbers |
| Mobile code not compiled in workspace | Build errors surface late | Done: CI compiles, analyses, tests and builds Android and iOS on every change; device testing still needed (OA-21) |
| Owner can't maintain code | Long-term fragility | Plain-language summaries per task; owner reviews each phase |

## Status definitions
Implemented → Tested → Deployment-ready → Deployed → Externally verified. Nothing is reported at a higher status than evidence supports.

## Where things stand (2026-11-05)

| Part | Status |
|---|---|
| Backend API | Tested (271 automated tests); production adapters implemented but not verified against real services |
| Staff console | Tested in a browser against the real API on development data |
| Website | Built and checked; legal pages are drafts |
| Passenger and driver apps | Compiled, analysed and unit-tested in CI; Android and iOS builds succeed; not yet run on a phone |
| Deployment | Configured and documented; restore drill passed locally; nothing deployed |
| Pilot | Runbook written; waiting on owner actions |

Everything that remains before a pilot is an owner action (OWNER_ACTION_REGISTER) or depends on one.

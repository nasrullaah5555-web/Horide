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
| DEPLOYMENT_GUIDE.md | How to deploy |
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
| Mobile code not compiled in workspace | Build errors surface late | CI on GitHub as soon as OA-01 is done |
| Owner can't maintain code | Long-term fragility | Plain-language summaries per task; owner reviews each phase |

## Status definitions
Implemented → Tested → Deployment-ready → Deployed → Externally verified. Nothing is reported at a higher status than evidence supports.

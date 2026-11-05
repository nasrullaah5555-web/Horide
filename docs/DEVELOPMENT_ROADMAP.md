# Musride — Development Roadmap

Estimates are rough. They assume Claude builds code in sessions and the owner reviews, builds the mobile apps and completes owner actions. They are not promises; the biggest risk to the timeline is owner actions and field testing, not coding.

| Phase | Tasks | Code effort (sessions) | Calendar, realistic | Exit criteria |
|---|---|---|---|---|
| 0 Foundation | T-001–T-004 | 1–2 | Week 1 | Repo on GitHub, CI green |
| 1 Backend foundation | T-005–T-009 | 2–3 | Weeks 1–2 | All migrations pass constraint tests |
| 2 Authentication | T-010–T-013 | 2–3 | Weeks 2–3 | Auth security tests pass |
| 3 Domain backend | T-014–T-031 | 8–12 | Weeks 3–8 | Full ride flow passes API end-to-end tests |
| 4 Admin dashboard | T-032–T-036 | 4–6 | Weeks 7–10 | All admin flows against real API |
| 5 Mobile apps | T-037–T-041 | 8–12 | Weeks 8–16 | Builds in CI; owner runs on Android phone |
| 6 Website | T-042 | 1 | Week 12 | Legal pages live |
| 7 Hardening & release | T-043–T-047 | 3–5 | Weeks 14–20 | Security tests pass, staging deployed |
| Pilot in Jijiga | owner-led | — | Month 5–7 | Small closed pilot: 10–30 drivers |

**Critical path outside code:** OA-06 (legal), OA-08 (SMS), OA-09 (maps), OA-17 (drivers). Start these now; each can take weeks.

**Progress (2026-11-05):** phases 0–7 are complete in code (see TASK_REGISTER for each task's exact status). Remaining work is owner actions, device testing (OA-21), real-service checks, deployment and the pilot.

**Honest caveat:** Mobile apps (Phase 5) carry the most risk because they cannot be compiled in Claude's workspace. Expect several rounds of fixing build errors reported from CI or the owner's laptop.

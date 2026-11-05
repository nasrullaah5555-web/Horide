# Blocked Tasks

Status BLOCKED – OWNER ACTION REQUIRED. The code for each is written; only the owner's account, decision or device is missing.

| Task | Blocked by | What is blocked | What already exists |
|---|---|---|---|
| T-010 (live SMS) | OA-08 | Sending real sign-in codes | AfroMessage adapter (unverified, ADR-017) |
| T-018 (live routing) | OA-09 | Real road distances in prices | Google Routes and OSRM adapters (unverified) |
| Destination search by name | OA-09 (choice of a places/geocoding service that knows Jijiga landmarks) | Typing a place name to find it | Map pin picking, landmark text, saved places |
| T-029 (live push) | OA-11 | Phone notifications | FCM adapter on the server (unverified); apps still need Firebase config files to register for push |
| T-016 (document storage) | OA-12 | Private bucket in production | S3 adapter tested on an emulator |
| T-037–T-041 (device testing) | OA-21 | Using the apps on a real phone | Apps compile and build for Android and iOS in CI |
| T-045 (live deployment) | OA-07, OA-12, OA-13, OA-14 | Staging and production | `render.yaml`, DEPLOYMENT_GUIDE, backup/restore scripts |
| T-046 (store release) | OA-04, OA-05, OA-23 | Signed builds, store listings | Signing config, release CI job, icons |
| T-042 (legal text final) | OA-07, OA-22 | Final privacy policy, terms, contact details | Draft pages marked as drafts |
| Pilot | All of the above + OA-15, OA-16, OA-17, OA-19 | Real passengers | PILOT_RUNBOOK go/no-go list |

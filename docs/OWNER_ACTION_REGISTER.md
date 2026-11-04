# Owner Action Register

Actions only the owner can perform. Status: OPEN until the owner confirms or the integration is verified. Send **LET US DO MY JOB** to get the full step-by-step checklist.

| ID | Priority | Action | Service | Why | Blocks | Can continue without it | Status |
|---|---|---|---|---|---|---|---|
| OA-01 | P0 | Create a GitHub repository and give its `owner/name` | GitHub | Central source of truth; CI; mobile builds in CI | Pushing code, CI runs (T-004), Flutter compile check | Yes — work continues in the local repo | DONE 2026-11-04 (`nasrullaah5555-web/Horide`) |
| OA-02 | P1 | Install Git, VS Code, Flutter, Android Studio + SDK on laptop | Your laptop | The cloud workspace cannot download Flutter (ADR-014) | Running the mobile apps | Yes — code is written; CI can compile | OPEN |
| OA-03 | P1 | Provide an Android phone for USB testing | Device | GPS, background location, push behaviour need real hardware | Mobile acceptance | Yes | OPEN |
| OA-04 | P3 | Mac access + Apple Developer Program (yearly fee) | Apple | iOS build and signing require macOS/Xcode | iOS builds, App Store | Yes — Android first | OPEN |
| OA-05 | P2 | Google Play Console account (one-time fee) | Google | Android release | T-046 | Yes | OPEN |
| OA-06 | P0 (business) | Business registration and transport permission check with Somali Regional State transport authorities and Jijiga city administration | Government | No dedicated national ride-hailing regulator; rules are spread across institutions | Launch | Yes — development | OPEN |
| OA-07 | P1 | Data protection: register with the Ethiopian Communications Authority as data controller; decide lawful basis for hosting outside Ethiopia | ECA, legal advice | Proclamation No. 1321/2024 | Production launch, hosting choice | Yes | OPEN |
| OA-08 | P1 | SMS provider account (e.g. AfroMessage), sender name approval, API key | SMS provider | Real OTP delivery | Real login | Yes — console provider in dev | OPEN |
| OA-09 | P1 | Routing/maps decision: Google Cloud billing account and API keys, or field-check OpenStreetMap coverage of Jijiga roads | Google / OSM | Road-distance fares (FR-02) | Real quotes | Yes — dev estimate flagged | OPEN |
| OA-10 | P2 | Contact eBirr operator about merchant/commercial API | eBirr | BR-06 | Automated eBirr | Yes — manual reference recording | OPEN |
| OA-11 | P2 | Firebase project; download Android/iOS config files | Firebase | Push notifications | T-029 live test | Yes — WebSocket + in-app | OPEN |
| OA-12 | P2 | Supabase project (paid, Frankfurt), staging + production | Supabase | Managed Postgres + private storage | Deployment | Yes — local Postgres | OPEN |
| OA-13 | P2 | Render account, paid instance for API | Render | Always-on WebSockets | Deployment | Yes | OPEN |
| OA-14 | P2 | Buy domain, add to Cloudflare | Registrar, Cloudflare | HTTPS endpoints, store listings | Deployment | Yes — local URLs | OPEN |
| OA-15 | P1 | Decide prices: base, per-km, minimum fare, rounding, waiting, cancellation fee, subscription price | Business | Illustrative numbers are not market prices | Launch pricing | Yes — dev seed values | OPEN |
| OA-16 | P1 | Confirm insurance and permit requirements for drivers and Bajaj | Insurers, authorities | Document list in onboarding | Final onboarding rules | Yes — configurable document types | OPEN |
| OA-17 | P0 (business) | Recruit pilot drivers and test subscription willingness to pay | Field | The business fails without paying drivers regardless of software | Pilot | Yes | OPEN |

Notes:
- "WeBirr" (a separate Ethiopian bill-payment gateway) is not eBirr. Do not confuse them during OA-10.
- No credentials should ever be pasted into chat; they go into the hosting provider's secret settings.

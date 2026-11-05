# Musride — Product Requirements

Source of truth: the MUSRIDE MASTER DEVELOPMENT PROMPT. This document restates it as testable requirements. Any change from the master prompt is recorded in `ARCHITECTURE_DECISIONS.md`.

## 1. Product summary

Musride is a ride-hailing platform for **Jijiga, Ethiopia** only, at launch. Two vehicle categories: **Car** and **Bajaj**. English only for v1.

Revenue comes from **monthly driver subscriptions**. Passengers pay the driver directly in **cash or eBirr**. Musride never holds ride money.

## 2. Users and roles

| Role | Description |
|---|---|
| Passenger | Requests and pays for rides. |
| Driver | Owns a vehicle, subscribes monthly, accepts rides. |
| Support admin | Handles complaints, views trips, contacts users. No finance, no pricing, no admin management. |
| Verification admin | Reviews driver documents and vehicles. |
| Finance admin | Records subscription payments, manages plans, resolves payment disputes. |
| Operations admin | Pricing, service zones, driver suspension. |
| Super admin | Admin accounts and roles. Every action audited. |

An admin may hold several roles. No role grants another role's permissions implicitly.

## 3. Business rules (non-negotiable)

- BR-01 Musride does not collect, hold or settle passenger ride payments. No passenger wallet.
- BR-02 The app records the payment method (cash / eBirr) and confirmations from driver and passenger.
- BR-03 Driver subscriptions are recorded separately from ride payments.
- BR-04 A driver without an ACTIVE subscription, or who is suspended or not approved, receives **no new offers**.
- BR-05 Subscription expiry or suspension **never interrupts a trip already in progress** or already accepted.
- BR-06 No automated eBirr integration until a commercial agreement exists (owner action OA-10). Until then eBirr is "record a transaction reference".
- BR-07 No fare negotiation. Fares are computed only by the backend.

## 4. Fare rules

- FR-01 `fare = base_fare + route_km × per_km`, per vehicle category.
- FR-02 Route distance is **road distance from a routing provider**. Straight-line distance is allowed only in development and is refused at production startup.
- FR-03 Minimum fare per category: `fare = max(fare, minimum_fare)`.
- FR-04 Rounding: round **up** to a configurable unit (default 5 ETB). Stored in santim (integer, 1 ETB = 100 santim). No floating-point money.
- FR-05 Every fare is linked to the immutable `fare_version` used to compute it.
- FR-06 The passenger sees a quote before booking. A quote expires (default 5 minutes) and is signed by the server; the client cannot alter it.
- FR-07 The fare is locked when a driver accepts.
- FR-08 Destination change during a trip → new quote → passenger must approve → only then does the locked fare change. Rejected change keeps the original destination and fare.
- FR-09 Waiting charge and cancellation fee: supported in the data model, **values set by owner before launch** (OA-15). Default 0 until decided.
- FR-10 Illustrative prices (Car 40 + 15/km, Bajaj 20 + 8/km) are development seed data only.

## 5. Passenger application

Phone registration and OTP; logout; profile; GPS pickup and manual pickup pin; destination search and map selection; Car/Bajaj choice; fare quote; ride request; driver name, photo, rating, vehicle, plate; live driver location with staleness indicator; arrival notification; trip status; cash/eBirr selection; payment confirmation and dispute; trip history and receipts; driver rating; complaints; emergency button.

Acceptance highlights:
- Pickup outside the service zone is rejected with a clear message.
- Driver location older than 30 s is shown as "last seen N s ago", never as live.
- If the app is killed during a trip, reopening restores the active trip.

## 6. Driver application

Phone OTP; profile; uploads (national ID, driving licence, vehicle registration, permits, insurance where required); approval status; vehicle category and details; subscription status and expiry; online/offline; incoming offers with countdown; accept/reject; navigation to pickup (hand-off to an external maps app); arrived, start, complete; record payment received (method + eBirr reference); trip history; earnings summary (sum of recorded fares — informational, not settlement); ratings; complaints.

Acceptance highlights:
- Going online is refused if not approved, suspended or subscription inactive, with the reason shown.
- Only one driver can accept a trip; the loser sees "taken by another driver".

## 7. Admin dashboard

Statistics (computed from real records only); live driver map; passenger/driver management; document verification; vehicle approval; trips by status; fare management with versioning; subscription plans, subscriptions and subscription payment records; payment disputes; complaints; suspension/reinstatement; notifications; reports; admin accounts; roles; audit log viewer.

Acceptance highlights:
- Admin login requires password + TOTP.
- Every state-changing admin action writes an audit log row in the same transaction.
- Support admin calling a finance endpoint receives 403.

## 8. Website (added by the autonomous directive)

- Public site: home, how it works, become a driver, safety, **privacy policy**, **terms**, contact. Privacy policy and terms are needed for Google Play and App Store listings.
- Passenger web booking: **deferred to post-pilot** (ADR-009).
- Driver website: informational only; drivers use the app.

## 9. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NF-01 | Quote API p95 latency (excluding routing provider) | < 300 ms |
| NF-02 | Offer delivery to driver after request | < 3 s on a working connection |
| NF-03 | Driver location update interval | 4–5 s on trip, 10–15 s online idle, none offline |
| NF-04 | Mobile app release size | Target < 30 MB APK per ABI |
| NF-05 | Data use per hour online (driver) | Target < 5 MB |
| NF-06 | Availability for pilot | 99% monthly |
| NF-07 | Network loss | App shows offline banner, retries with backoff, resynchronises trip state on reconnect |
| NF-08 | Security | See SECURITY_PLAN.md |
| NF-09 | Privacy | Compliance with Ethiopia Personal Data Protection Proclamation No. 1321/2024 (OA-07) |

## 10. Out of scope for v1

In-app payments and wallets; nationwide rollout; languages other than English (Somali and Amharic are strong v2 candidates); scheduled rides; shared rides; promotions; passenger web booking.

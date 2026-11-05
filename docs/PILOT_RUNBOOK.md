# Pilot Runbook — Jijiga

How to run the first Musride pilot day to day, and what to do when something goes wrong. Written before the pilot; update it with what actually happens.

## 1. Go / no-go before the first real passenger

Every line must be "yes". Each links to where it is checked.

| # | Check | Where |
|---|---|---|
| 1 | Business registration and transport/platform permission confirmed in writing | OA-01/OA-02/OA-03 |
| 2 | Data protection registration done; hosting decision recorded | OA-07 |
| 3 | Prices decided and entered in the console (base, per km, minimum, cancellation) | OA-15, console → Prices and zones |
| 4 | Driver document list and insurance rules confirmed; `REQUIRED_DRIVER_DOCUMENTS` matches | OA-16 |
| 5 | Emergency numbers confirmed working in Jijiga | OA-19 |
| 6 | Production deployed; checks in DEPLOYMENT_GUIDE §5 all pass | OA-12/13/14 |
| 7 | Restore drill done on production backups within the last month | DEPLOYMENT_GUIDE §6 |
| 8 | SMS, routing, storage and push each checked against the real service | OA-08/09/11/12 |
| 9 | Both apps tested on real phones: a full ride, payment confirmation, emergency button, account deletion | OA-21 |
| 10 | Privacy policy and terms reviewed by a lawyer; "Draft" notice removed | OA-07 |
| 11 | Support phone staffed during pilot hours; number on the website and in store listings | OA-22 |
| 12 | At least 2 staff accounts with authenticator apps; one is `super`, others have only the roles they need | Console → Staff accounts |

## 2. Pilot shape (suggested)

- Weeks 1–2: closed pilot. 10–20 drivers recruited in person, 50–100 invited passengers (staff, friends, partner businesses). Daytime hours only.
- Weeks 3–6: open to the public in the service zone, hours extended as drivers allow.
- One person on support for every operating hour.

Measure weekly (console → Overview, which includes a 14-day trip report): trips requested, accepted, completed, expired (no driver), cancelled; average time to acceptance; payment disputes; complaints; active drivers; drivers renewing their subscription. Expired requests show where drivers are missing; renewals show whether the business model works (OA-17).

## 3. Daily operations

Morning:
1. `https://api.<domain>/health` is OK.
2. Console → Overview: drivers online, open emergencies (should be none), open disputes.
3. Console → Drivers: documents waiting for review (target: reviewed within 24 h).
4. Console → Subscriptions, filter "expiring": call those drivers.

During the day:
- Emergencies appear at the top of the console. Call the person back immediately. Musride staff are not an emergency service: if there is danger, they must call 991/907 and you call them too.
- Complaints: reply within 24 h. Safety complaints the same day.

Evening:
- Note anything unusual in a shared log (date, what happened, what was done).

## 4. Incident response

Severity:
- **S1** — people can't book or drivers can't receive rides; or any safety incident; or a suspected data breach.
- **S2** — part of the service broken (e.g. SMS codes slow, map not loading) with a workaround.
- **S3** — cosmetic or single-user problem.

For S1:
1. One person leads. Write the start time.
2. Check `/health`, Render's service page (deploys, logs), Supabase status, Cloudflare status.
3. If the last deploy caused it: redeploy the previous version in Render (DEPLOYMENT_GUIDE §7).
4. If SMS is down: drivers and passengers already signed in keep working (sessions last 30 days); new sign-ins fail until it is back. Tell users through the console's Announcements once fixed.
5. If routing is down: new quotes fail with "Prices are unavailable right now" — the app never guesses a price. Trips already booked continue.
6. Write down what happened, the times, and what will prevent it next time.

## 5. Data breach procedure (Proclamation No. 1321/2024)

A breach is any loss of control over personal data: a leaked database copy, a staff account used by someone else, documents exposed, a lost unlocked laptop with exports.

1. **Contain** (minutes): revoke the exposed credential (Supabase keys, staff account — console → Staff accounts → disable; rotate secrets as in DEPLOYMENT_GUIDE §8).
2. **Record**: what data, whose, how many people, when it started, when it was found. The audit log (console → Audit log) shows staff actions, including every document opening.
3. **Notify the authority within 72 hours** of becoming aware, as the proclamation requires (the owner confirms the exact authority and form during OA-07).
4. **Tell affected people** without undue delay when the breach is likely to harm them, in plain words: what happened, what it means for them, what Musride is doing, what they can do.
5. **Review** within a week: cause, fix, and what changes in this runbook.

## 6. Support process

- Channels: support phone and in-app "Report a problem" (goes to console → Complaints).
- Identify callers by the phone number on their account; never ask for a sign-in code. Musride staff never need it, and anyone asking for one is attempting account takeover — say so to the caller.
- Payment disputes: console → Ride payments. Talk to both sides; the record shows what each confirmed and the eBirr reference typed by the driver (not verified with eBirr until OA-10).
- Account deletion requests by phone: only from the account's own phone number, after a call-back to that number. Deletion itself is done by the person in the app; if they can't, record the request and escalate to the owner.
- Driver suspension: only with a written reason (the console requires one); trips already under way are never interrupted.

## 7. Known limits during the pilot

- One API instance: a restart drops live connections for a few seconds; the apps reconnect and reload the trip.
- Rate limits are per instance and reset on restart.
- The eBirr reference is not verified with eBirr (OA-10).
- iOS keeps location only while the app is open (drivers should use Android for the pilot, or keep the app open).
- History screens show the most recent page only.

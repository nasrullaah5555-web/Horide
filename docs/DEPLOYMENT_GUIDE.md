# Deployment Guide

Status: **not deployed.** Everything below is prepared and checked locally where possible; nothing has run on real hosting yet. Steps marked **(owner)** need the owner's accounts (OWNER_ACTION_REGISTER).

## 1. Shape

| Part | Where | Why |
|---|---|---|
| API (`apps/backend`) | Render web service, Frankfurt, always-on paid instance | Live trips need a server that never sleeps |
| Staff console (`apps/admin`) | Render web service | Needs the Next.js server for the `/admin/*` forwarding (ADR-016) |
| Website (`apps/web`) | Cloudflare Pages (static files) | No server needed; security headers in `apps/web/public/_headers` |
| Database | Supabase PostgreSQL (with PostGIS), Frankfurt | Managed backups, PostGIS available |
| Driver documents | Supabase Storage, **private** bucket, S3 protocol | Never public; the API reads with its own keys |
| DNS, TLS, protection | Cloudflare | `api.`, `admin.`, root domain |
| Mobile apps | Google Play, App Store | T-046 |

Separate **staging** and **production** for both Render and Supabase. Staging gets test SMS credit and test data only.

`render.yaml` in the repository describes both Render services. Secrets are marked `sync: false`, so Render asks for them and they never enter Git.

## 2. Before the first deployment (owner)

1. OA-07: data protection registration and the decision on hosting outside Ethiopia.
2. OA-12: Supabase project (staging and production). Enable PostGIS (Database → Extensions: `postgis`, `pgcrypto`, `citext`, `btree_gist`). Create a private storage bucket `driver-documents` and S3 access keys (Storage → Settings → S3 access).
3. OA-13: Render account with a payment method.
4. OA-14: domain on Cloudflare.
5. OA-08 / OA-09 / OA-11: AfroMessage token, Google Routes API key (restricted to the Routes API), Firebase service-account key file.
6. Generate secrets on your own computer, one per value, and keep them only in Render:
   ```bash
   openssl rand -base64 48   # JWT_ACCESS_SECRET, OTP_PEPPER, QUOTE_SIGNING_SECRET (three separate runs)
   openssl rand -base64 32   # ADMIN_TOTP_ENCRYPTION_KEY
   base64 -w0 firebase-key.json   # FCM_SERVICE_ACCOUNT_BASE64 (macOS: base64 -i firebase-key.json)
   ```
7. Backup key pair (keep the private key OFFLINE, e.g. on a USB stick in a safe, plus a printed copy):
   ```bash
   age-keygen -o musride-backup.key   # prints the public key "age1..." — that goes into the backup job
   ```

## 3. Deploying

1. In Render: New → Blueprint → choose the GitHub repository. Render reads `render.yaml` and asks for every secret. Enter:
   - `DATABASE_URL`: Supabase connection string (the **session pooler** or direct connection, with `sslmode=require`).
   - `CORS_ORIGINS`: `https://admin.<domain>,https://<domain>`.
   - `S3_ENDPOINT`: `https://<project>.supabase.co/storage/v1/s3`, `S3_REGION`: the project's region, `S3_BUCKET`: `driver-documents`.
   - `MUSRIDE_API_URL` (console): `https://api.<domain>`. It is read when the console is **built**, so redeploy the console if it changes.
2. Deploys are manual (`autoDeploy: false`). Deploy only a commit whose CI is green.
3. Each API deploy first runs `node apps/backend/dist/database/migrate-cli.js latest`. If a migration fails, the deploy stops and the old version keeps running.
4. The API refuses to start if anything is missing or unsafe (development adapters, placeholder or repeated secrets, non-SSL database, non-https origins). Read the deploy log: it lists every problem.
5. Create the first staff account from the Render shell of `musride-api`:
   ```bash
   node apps/backend/dist/modules/admin-auth/create-admin-cli.js --email you@<domain> --name "Your Name" --roles super
   ```
   It prints, once, a temporary password and an authenticator link with its manual key. Add the key to an authenticator app, sign in at `https://admin.<domain>`, and change the password under Account. Clear the shell output afterwards.
6. Website: Cloudflare Pages → connect the repository → build command `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @musride/web build`, output directory `apps/web/out`.

## 4. Cloudflare

- DNS: `api` → the Render API service, `admin` → the Render console service (CNAME, proxied), root → Cloudflare Pages.
- SSL/TLS mode **Full (strict)**. Always Use HTTPS on. HSTS on after the first successful week.
- Keep `TRUST_PROXY_HOPS=2` on the API while Cloudflare proxies it (Cloudflare + Render). If Cloudflare proxying is turned off, set it to 1. Wrong values either share one IP across users (rate-limit lock-outs) or let clients fake their IP (`test/proxy.e2e-spec.ts`).
- Do not cache `api.` or `admin.` (Cache Rules → bypass). WebSockets on.

## 5. Checks after each deployment

1. `https://api.<domain>/health` → `{"status":"ok","database":"up"}`.
2. Staff console sign-in works; Overview loads.
3. On a test phone with the staging app: request a code (SMS arrives), get a quote for a known Jijiga trip and compare the distance with a map, book with a test driver, complete, confirm payment.
4. Upload a test document in the driver app, open it from the console, and confirm the bucket refuses an anonymous request for it.
5. Record the result in TEST_REPORT.md.

## 6. Backups and restore

- Supabase daily backups (paid plan) are the first line.
- Plus an independent weekly encrypted copy, kept outside Supabase:
  ```bash
  DATABASE_URL=<production URL> AGE_RECIPIENT=age1... infra/backup/backup.sh ./backups
  ```
  The file is encrypted to the backup public key; the server never holds the private key.
- **Restore drill** (before the pilot, then monthly), into an empty database:
  ```bash
  # once, as a superuser on the empty target database:
  CREATE EXTENSION postgis; CREATE EXTENSION pgcrypto; CREATE EXTENSION citext; CREATE EXTENSION btree_gist;
  TARGET_DATABASE_URL=<empty database> AGE_IDENTITY=musride-backup.key infra/backup/restore.sh musride-<date>.dump.age
  ```
  Compare the printed row counts with production, run the migration command against it (must say "up to date"), and record the time taken in TEST_REPORT.md. Targets: RPO 24 h, RTO 4 h.
- Driver document files are in Supabase Storage, not in the database backup. Enable bucket versioning or a periodic copy if the plan allows (owner decision).

## 7. Rolling back

- Code: in Render, redeploy the previous successful deploy.
- Database: migrations are never rolled back in production (the migration tool refuses). A bad migration is fixed with a new migration, or by restoring a backup into a new database and switching `DATABASE_URL`.

## 8. Secrets rotation

- `JWT_ACCESS_SECRET`: rotating signs everyone out of their current 15-minute access token only; refresh tokens keep working.
- `OTP_PEPPER`: pending codes stop working (they expire in 5 minutes anyway).
- `QUOTE_SIGNING_SECRET`: open quotes (5 minutes) stop working.
- `ADMIN_TOTP_ENCRYPTION_KEY`: **do not rotate** without re-enrolling every staff authenticator.
- Provider keys (SMS, routing, storage, Firebase): create the new key, update Render, redeploy, then revoke the old key.

## 9. Local equivalents (verified in development)

| Step | Local check | Result |
|---|---|---|
| Build | `pnpm --filter @musride/backend build`, `pnpm --filter @musride/admin build`, `pnpm --filter @musride/web build` | Pass (CI) |
| Migrations | `migrate-cli.js latest` on an existing database | "up to date" |
| Backup + restore | `infra/backup/backup.sh` → `restore.sh` into an empty database | Row counts match; restored database migrates as "up to date" (TEST_REPORT) |
| Production config refusal | `src/config/env.spec.ts` | Pass |

## 10. Mobile releases (T-046)

App IDs (permanent once published; OA-23 asks the owner to confirm them before the first upload):

| App | Android `applicationId` | iOS bundle ID | Name on the phone |
|---|---|---|---|
| Passenger | `et.musride.passenger` | `et.musride.passenger` | Musride |
| Driver | `et.musride.driver` | `et.musride.driver` | Musride Driver |

Every release build must be given the API address; a release build without an `https://` address shows an error screen instead of running:
```bash
--dart-define=MUSRIDE_API_URL=https://api.<domain>
```

### Android (owner: OA-05)

1. Create the upload key once, on your own computer, and back it up in two safe places. Losing it means asking Google to reset it; leaking it lets someone else publish "updates".
   ```bash
   keytool -genkeypair -v -keystore musride-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
   ```
2. Either build on your computer with `mobile/<app>/android/key.properties` (git-ignored):
   ```properties
   storeFile=/full/path/to/musride-upload.jks
   storePassword=...
   keyAlias=upload
   keyPassword=...
   ```
   ```bash
   cd mobile/passenger
   flutter build appbundle --release --obfuscate --split-debug-info=build/symbols --dart-define=MUSRIDE_API_URL=https://api.<domain>
   ```
3. Or let CI build it: in GitHub → Settings → Secrets and variables → Actions, add secrets `MUSRIDE_KEYSTORE_BASE64` (`base64 -w0 musride-upload.jks`), `MUSRIDE_KEYSTORE_PASSWORD`, `MUSRIDE_KEY_ALIAS`, `MUSRIDE_KEY_PASSWORD`, and the variable `MUSRIDE_API_URL`. The "Mobile build" run then offers the signed `.aab` and the symbol files as downloads for 14 days.
4. In Play Console: enable Play App Signing, upload the `.aab` to Internal testing first, add the privacy policy URL (`https://<domain>/privacy/`) and the account deletion URL (`https://<domain>/delete-account/`), and complete the Data safety form from the privacy policy.
5. Keep `build/symbols` for each release: it turns obfuscated crash reports back into readable ones.

### iOS (owner: OA-04)

Needs a Mac with Xcode and an Apple Developer account. CI proves the iOS app compiles (unsigned); signing and upload happen on the Mac:
```bash
cd mobile/passenger
flutter build ipa --release --obfuscate --split-debug-info=build/symbols --dart-define=MUSRIDE_API_URL=https://api.<domain>
```
Then upload with Xcode's Organizer or Transporter to TestFlight. Set the team and the bundle IDs above in Xcode (Runner → Signing & Capabilities) the first time.

## 11. Free private test deployment (staging)

For trying the whole system on the internet before paying for anything: Supabase free + Render free, using `render.staging.yaml`. **Not for real users.** In staging (`NODE_ENV=staging`) the API keeps production's safety rules (verified SSL to the database, random secrets, https-only browser origins, rate limits, secure cookies), but allows the development adapters:

- sign-in codes are written to the API's log instead of being sent by SMS;
- distances are straight-line estimates (marked "estimate" in the app);
- uploaded documents are stored on the server's temporary disk and lost on restart;
- free servers sleep after 15 minutes without visitors; the next request takes about a minute.

Cost: free. Supabase pauses a free project after a week without use (resume it in the dashboard).

### Steps

1. **Supabase**: create a project (region Frankfurt). Choose a database password of letters and digits only (other characters must be URL-encoded in the connection string). Then:
   - Database → Extensions: turn on `postgis` (the others are created by the migrations).
   - Connect → copy the **Session pooler** connection string (it works over IPv4, which Render needs). Put your password in it.
   - Project Settings → Database → SSL configuration → **Download certificate**.
2. **Render**: New → Blueprint → choose the repository → set the Blueprint file path to `render.staging.yaml`. Render generates the four secrets itself and asks for:
   - `DATABASE_URL`: the Session pooler string.
   - `DATABASE_CA_CERT`: open the downloaded certificate in a text editor and paste all of it (including the BEGIN and END lines). If the field won't take several lines, paste the output of `base64 -w0 prod-ca-2021.crt` instead (macOS: `base64 -i prod-ca-2021.crt`).
   - `STAGING_BOOTSTRAP_ADMIN_EMAIL`: your email.
   - `CORS_ORIGINS` and `MUSRIDE_API_URL`: leave a placeholder (`https://example.org`) for now.
3. When the three services exist, note their addresses (`https://musride-staging-api-xxxx.onrender.com` and so on). Set:
   - API → Environment → `CORS_ORIGINS` = `https://<console address>,https://<website address>`.
   - Console → Environment → `MUSRIDE_API_URL` = `https://<api address>`, then **Manual Deploy → Clear build cache & deploy** (the address is read when the console is built).
4. Check `https://<api address>/health` shows `{"status":"ok","database":"up"}`.
5. API → Logs: find the block "STAGING: first staff account created". It shows the email, a temporary password and an authenticator key, **once**. Add the key to an authenticator app, sign in to the console, and change the password under Account.
   Forgot the staging staff password: API → Environment → add `STAGING_ADMIN_PASSWORD_RESET` with any new word (6+ characters) → Save (the API restarts) → Logs: find "STAGING: staff password reset" for a new temporary password, shown once. The authenticator stays the same. Sign in, change the password under Account, then delete the setting. A word works only once; to reset again, use a different word. Production refuses this setting.
6. Open the website address and click through every page.

The API refuses to start with a clear list in its log if anything is missing or wrong. The certificate check is real: without the right certificate, or with the wrong host, the database connection is refused (tested locally, TEST_REPORT).

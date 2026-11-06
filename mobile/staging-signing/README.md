# Staging test signing key

`staging-test.keystore` signs the **staging test builds only** (app IDs `et.musride.passenger.staging`
and `et.musride.driver.staging`, named "Musride (test)" and "Musride Driver (test)"), built by the
"Mobile staging apps" workflow and published under GitHub Releases.

Why it is in the repository: Android only installs an update over an app signed with the same
key. Before this, every CI build made a new random debug key, so testers had to uninstall the
old test app first. A GitHub secret would be tidier, but this development environment can't write
Actions secrets; this key protects nothing of value.

What it is not: it is **not** the Google Play upload key (OWNER_ACTION_REGISTER OA-05), which never
enters Git. It can't publish or update the real apps (`et.musride.passenger`, `et.musride.driver`),
which have different app IDs and are signed by the owner's key. Passwords are Android's standard
debug ones (`android` / alias `androiddebugkey`).

To move it to a secret later: store the file base64-encoded as `MUSRIDE_STAGING_KEYSTORE_BASE64`,
decode it in the workflow, and delete it from here.

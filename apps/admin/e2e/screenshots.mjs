/**
 * DEV ONLY: signs in to a locally running dashboard with the demo staff account created by
 * `pnpm --filter @horide/backend demo`, opens every screen and saves screenshots.
 *   node e2e/screenshots.mjs <output-dir> [path ...]
 * Fails if any screen shows an error message or a browser console error.
 */
import { createHmac } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.ADMIN_URL ?? 'http://127.0.0.1:3001';
const out = process.argv[2] ?? 'screenshots';
const only = process.argv.slice(3);
const creds = JSON.parse(
  readFileSync(new URL('../../backend/.demo-admin.json', import.meta.url), 'utf8'),
);

function totp(secret) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const o = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

const SCREENS = [
  '/',
  'DRIVER',
  'TRIP',
  '/map',
  '/emergencies',
  '/trips',
  '/drivers',
  '/passengers',
  '/complaints',
  '/payments',
  '/subscriptions',
  '/pricing',
  '/notifications',
  '/admins',
  '/audit',
  '/account',
];

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const problems = [];
for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on(
    'console',
    (m) =>
      m.type() === 'error' &&
      !m.text().startsWith('Failed to load resource') &&
      problems.push(`${viewport.name} console: ${m.text()}`),
  );
  page.on(
    'response',
    (r) =>
      r.status() >= 400 &&
      problems.push(`${viewport.name} HTTP ${r.status()} ${new URL(r.url()).pathname}`),
  );
  await page.goto(`${BASE}/login`);
  if (viewport.name === 'desktop')
    await page.screenshot({ path: join(out, 'desktop-login.png'), fullPage: true });
  await page.getByLabel('Email').fill(creds.email);
  await page.getByLabel('Password').fill(creds.password);
  // Each authenticator code works once (replay protection), so start every sign-in on a fresh 30 s step.
  await new Promise((r) => setTimeout(r, 30500 - (Date.now() % 30000)));
  await page.getByLabel('Authenticator code').fill(totp(creds.totpSecret));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 15000 });
  const list = only.length
    ? only
    : viewport.name === 'mobile'
      ? ['/', '/trips', '/drivers']
      : SCREENS;
  for (let path of list) {
    if (path === 'DRIVER' || path === 'TRIP') {
      const listPath = path === 'DRIVER' ? '/drivers?approval=pending' : '/trips?status=completed';
      await page.goto(`${BASE}${listPath}`);
      const link = page
        .locator(`main a[href^="/${path === 'DRIVER' ? 'drivers' : 'trips'}/"]`)
        .first();
      await link.waitFor({ timeout: 15000 });
      path = (await link.getAttribute('href')) ?? '/';
    }
    await page.goto(`${BASE}${path}`);
    // Live screens poll the API, so the network never goes idle; wait for the page heading instead.
    await page.locator('main h1').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    // Next.js's route announcer also uses role=alert; only real messages have text.
    const alert = (await page.locator('main [role=alert]').allTextContents()).filter((t) =>
      t.trim(),
    );
    if (alert.length) problems.push(`${viewport.name} ${path}: ${alert.join(' | ')}`);
    const name = `${viewport.name}-${path === '/' ? 'overview' : path.slice(1).split('/').slice(0, 1).join('-') + (path.split('/').length > 2 ? '-detail' : '')}.png`;
    await page.screenshot({ path: join(out, name), fullPage: true });
  }
  await page.close();
}
await browser.close();
if (problems.length) {
  console.log('PROBLEMS:\n' + problems.join('\n'));
  process.exitCode = 1;
} else console.log('All screens rendered without errors.');

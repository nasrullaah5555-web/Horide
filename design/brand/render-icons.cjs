// Renders the app launcher icons from the Route M logo (design/tokens.json geometry and colours).
//   node design/brand/render-icons.cjs      (needs Playwright's Chromium)
// Passenger: navy background, white M. Driver: green background, navy M (brand sheet).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const sizeOf = (file) => {
  const b = fs.readFileSync(file);
  return b.readUInt32BE(16); // PNG width (icons are square)
};
const root = path.join(__dirname, '..', '..');
const t = JSON.parse(fs.readFileSync(path.join(root, 'design/tokens.json'), 'utf8'));
const c = t.color;
const L = t.logo;
const variants = {
  passenger: { bg: c.navy, m: c.white, ring: c.sign, hole: c.navy, dot: c.white },
  driver: { bg: c.sign, m: c.navy, ring: c.white, hole: c.sign, dot: c.navy },
};
const svg = (
  v,
  px,
) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${px}" height="${px}">
  <rect width="100" height="100" fill="${v.bg}"/>
  <g transform="translate(19 17) scale(0.62)">
    <path d="${L.path}" fill="none" stroke="${v.m}" stroke-width="${L.stroke}" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${L.ringX}" cy="${L.ringY}" r="${L.ringR}" fill="${v.ring}"/>
    <circle cx="${L.ringX}" cy="${L.ringY}" r="${L.holeR}" fill="${v.hole}"/>
    <circle cx="${L.dotX}" cy="${L.dotY}" r="${L.dotR}" fill="${v.dot}"/>
  </g></svg>`;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [app, v] of Object.entries(variants)) {
    const base = path.join(root, 'mobile', app);
    const files = [
      ...fs
        .readdirSync(path.join(base, 'android/app/src/main/res'))
        .filter((d) => d.startsWith('mipmap-'))
        .map((d) => path.join(base, 'android/app/src/main/res', d, 'ic_launcher.png')),
      ...fs
        .readdirSync(path.join(base, 'ios/Runner/Assets.xcassets/AppIcon.appiconset'))
        .filter((f) => f.endsWith('.png'))
        .map((f) => path.join(base, 'ios/Runner/Assets.xcassets/AppIcon.appiconset', f)),
    ].filter((f) => fs.existsSync(f));
    for (const f of files) {
      const px = sizeOf(f);
      await page.setViewportSize({ width: px, height: px });
      await page.setContent(`<body style="margin:0">${svg(v, px)}</body>`);
      await page.screenshot({ path: f, omitBackground: false });
    }
    fs.writeFileSync(path.join(__dirname, `icon-${app}.svg`), svg(v, 1024));
    console.log(`${app}: ${files.length} icons`);
  }
  await browser.close();
})();

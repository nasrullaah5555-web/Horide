#!/usr/bin/env node
// Generates the design constants for every part of Musride from design/tokens.json.
//   node scripts/gen-tokens.mjs          write the files
//   node scripts/gen-tokens.mjs --check  fail if any generated file is out of date (CI)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const t = JSON.parse(readFileSync(join(root, 'design/tokens.json'), 'utf8'));
const header = (c) =>
  `${c} GENERATED from design/tokens.json by scripts/gen-tokens.mjs. Do not edit by hand.\n`;
const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const hex = (v) => v.replace('#', '');
// "#RRGGBB" → 0xFFRRGGBB; "#AARRGGBB" → 0xAARRGGBB
const dartColor = (v) =>
  (hex(v).length === 6 ? `0xFF${hex(v)}` : `0x${hex(v)}`).toUpperCase().replace('0X', '0x');
// "#AARRGGBB" → CSS "#RRGGBBAA"
const cssColor = (v) =>
  (hex(v).length === 8 ? `#${hex(v).slice(2)}${hex(v).slice(0, 2)}` : v).toLowerCase();
const num = (n) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

const dartGroup = (name, doc, entries, fmt) =>
  `/// ${doc}\nabstract final class ${name} {\n${Object.entries(entries)
    .map(([k, v]) => `  static const ${k} = ${fmt(v)};`)
    .join('\n')}\n}\n`;

const weight = (w) => `FontWeight.w${w}`;
const dart = [
  header('//'),
  "import 'package:flutter/painting.dart';\n",
  dartGroup(
    'MusrideColors',
    'Every colour used anywhere in the apps.',
    t.color,
    (v) => `Color(${dartColor(v)})`,
  ),
  dartGroup(
    'MusrideSpace',
    'Spacing scale (logical pixels). Paddings and gaps use only these.',
    t.space,
    num,
  ),
  dartGroup('MusrideRadius', 'Corner radii.', t.radius, num),
  dartGroup('MusrideFontSize', 'Type scale.', t.fontSize, num),
  dartGroup('MusrideFontWeight', 'Font weights.', t.fontWeight, weight),
  dartGroup('MusrideLineHeight', 'Line heights (multiples of the font size).', t.lineHeight, num),
  dartGroup('MusrideLetterSpacing', 'Letter spacing.', t.letterSpacing, num),
  dartGroup('MusrideSize', 'Fixed sizes: touch targets, icons, map markers.', t.size, num),
  dartGroup('MusrideStroke', 'Line and border widths.', t.stroke, num),
  `/// The bundled typeface (packages/musride_core/assets/fonts).\nconst musrideFontFamily = 'packages/musride_core/${t.font.family}';\n`,
  `/// The wordmark typeface, used only for the Musride name in the logo.\nconst musrideBrandFontFamily = 'packages/musride_core/${t.font.brand}';\n`,
  `/// Route M logo geometry in a 100 x 100 box (see design/brand/).\nabstract final class MusrideLogoShape {\n${Object.entries(
    t.logo,
  )
    .filter(([k]) => !k.startsWith('$') && k !== 'path')
    .map(([k, v]) => `  static const ${k} = ${num(v)};`)
    .join('\n')}\n  static const path = '${t.logo.path}';\n}\n`,
].join('\n');

const css = [
  header('/*').replace('\n', ' */\n'),
  '@theme {',
  `  --font-sans: '${t.font.family}', ui-sans-serif, system-ui, sans-serif;`,
  `  --font-brand: '${t.font.brand}', ui-sans-serif, system-ui, sans-serif;`,
  `  --tracking-wordmark: ${t.letterSpacing.wordmarkEm}em;`,
  ...Object.entries(t.color).map(([k, v]) => `  --color-${kebab(k)}: ${cssColor(v)};`),
  ...Object.entries(t.radius).map(([k, v]) => `  --radius-${kebab(k)}: ${v}px;`),
  ...Object.entries(t.fontSize).map(([k, v]) => `  --text-${kebab(k)}: ${v / 16}rem;`),
  ...Object.entries(t.lineHeight).map(([k, v]) => `  --leading-${kebab(k)}: ${v};`),
  `  --shadow-sign: 0 0 0 ${t.stroke.hairline}px ${cssColor(t.color.shadow)};`,
  '}',
  ':root {',
  ...Object.entries(t.space).map(([k, v]) => `  --space-${kebab(k)}: ${v}px;`),
  ...Object.entries(t.size).map(([k, v]) => `  --size-${kebab(k)}: ${v}px;`),
  ...Object.entries(t.stroke).map(([k, v]) => `  --stroke-${kebab(k)}: ${v}px;`),
  '}',
  '',
].join('\n');

const ts = [
  header('//'),
  '/** For code that needs colours as values (e.g. map markers drawn by Leaflet). CSS uses tokens.css. */',
  `export const colors = ${JSON.stringify(Object.fromEntries(Object.entries(t.color).map(([k, v]) => [k, cssColor(v)])), null, 2)} as const;`,
  '',
].join('\n');

const L = t.logo;
const logoTsx = [
  header('//'),
  '/** The Musride logo: Route M symbol (pickup ring to drop-off dot) and the wordmark. */',
  'export function MusrideLogo({',
  '  onDark = false,',
  '  wordmark = true,',
  "  className = '',",
  '}: {',
  '  onDark?: boolean;',
  '  wordmark?: boolean;',
  '  className?: string;',
  '}) {',
  "  const ink = onDark ? 'var(--color-white)' : 'var(--color-navy)';",
  "  const hole = onDark ? 'var(--color-navy)' : 'var(--color-white)';",
  '  return (',
  '    <span className={`inline-flex items-center gap-[0.35em] ${className}`}>',
  '      <svg viewBox="0 0 100 100" className="h-[1.6em] w-[1.6em] shrink-0" role="img" aria-label="Musride">',
  `        <path d="${L.path}" fill="none" stroke={ink} strokeWidth="${L.stroke}" strokeLinecap="round" strokeLinejoin="round" />`,
  `        <circle cx="${L.ringX}" cy="${L.ringY}" r="${L.ringR}" fill="var(--color-sign)" />`,
  `        <circle cx="${L.ringX}" cy="${L.ringY}" r="${L.holeR}" fill={hole} />`,
  `        <circle cx="${L.dotX}" cy="${L.dotY}" r="${L.dotR}" fill={ink} />`,
  '      </svg>',
  '      {wordmark && (',
  '        <span aria-hidden style={{ fontFamily: "var(--font-brand)", fontWeight: 700, letterSpacing: "var(--tracking-wordmark)", color: ink }}>',
  '          MUSRIDE',
  '        </span>',
  '      )}',
  '    </span>',
  '  );',
  '}',
  '',
].join('\n');

const iconSvg = (bg, m, ring, holeC, dot) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="${bg}"/><g transform="translate(19 17) scale(0.62)"><path d="${L.path}" fill="none" stroke="${m}" stroke-width="${L.stroke}" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${L.ringX}" cy="${L.ringY}" r="${L.ringR}" fill="${ring}"/><circle cx="${L.ringX}" cy="${L.ringY}" r="${L.holeR}" fill="${holeC}"/><circle cx="${L.dotX}" cy="${L.dotY}" r="${L.dotR}" fill="${dot}"/></g></svg>\n`;
const favicon = iconSvg(
  cssColor(t.color.navy),
  '#ffffff',
  cssColor(t.color.sign),
  cssColor(t.color.navy),
  '#ffffff',
);

const outputs = {
  'apps/admin/src/lib/logo.g.tsx': logoTsx,
  'apps/web/src/lib/logo.g.tsx': logoTsx,
  'apps/admin/src/app/icon.svg': favicon,
  'apps/web/src/app/icon.svg': favicon,
  'packages/musride_core/lib/src/design/tokens.g.dart': dart,
  'packages/design-tokens/tokens.css': css,
  'apps/admin/src/lib/tokens.g.ts': ts,
};

const check = process.argv.includes('--check');
let stale = 0;
for (const [path, content] of Object.entries(outputs)) {
  const full = join(root, path);
  const current = existsSync(full) ? readFileSync(full, 'utf8') : null;
  if (current === content) continue;
  if (check) {
    console.error(`Out of date: ${path}. Run: node scripts/gen-tokens.mjs`);
    stale++;
  } else {
    writeFileSync(full, content);
    console.log(`wrote ${path}`);
  }
}
if (stale) process.exit(1);

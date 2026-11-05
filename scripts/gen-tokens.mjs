#!/usr/bin/env node
// Generates the design constants for every part of Horide from design/tokens.json.
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
    'HorideColors',
    'Every colour used anywhere in the apps.',
    t.color,
    (v) => `Color(${dartColor(v)})`,
  ),
  dartGroup(
    'HorideSpace',
    'Spacing scale (logical pixels). Paddings and gaps use only these.',
    t.space,
    num,
  ),
  dartGroup('HorideRadius', 'Corner radii.', t.radius, num),
  dartGroup('HorideFontSize', 'Type scale.', t.fontSize, num),
  dartGroup('HorideFontWeight', 'Font weights.', t.fontWeight, weight),
  dartGroup('HorideLineHeight', 'Line heights (multiples of the font size).', t.lineHeight, num),
  dartGroup('HorideLetterSpacing', 'Letter spacing.', t.letterSpacing, num),
  dartGroup('HorideSize', 'Fixed sizes: touch targets, icons, map markers.', t.size, num),
  dartGroup('HorideStroke', 'Line and border widths.', t.stroke, num),
  `/// The bundled typeface (packages/horide_core/assets/fonts).\nconst horideFontFamily = 'packages/horide_core/${t.font.family}';\n`,
].join('\n');

const css = [
  header('/*').replace('\n', ' */\n'),
  '@theme {',
  `  --font-sans: '${t.font.family}', ui-sans-serif, system-ui, sans-serif;`,
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

const outputs = {
  'packages/horide_core/lib/src/design/tokens.g.dart': dart,
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

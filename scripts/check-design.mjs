#!/usr/bin/env node
// Keeps the look of Horide constant: every colour, size, corner, font and button must come from
// design/tokens.json (through the generated files and the shared components). Fails CI when a
// screen hardcodes one instead.   node scripts/check-design.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where design values may be defined (the token source and its consumers that build themes). */
const ALLOWED = [
  'packages/horide_core/lib/src/design/',
  'packages/horide_core/lib/src/theme.dart',
  'packages/design-tokens/',
  'apps/admin/src/lib/tokens.g.ts',
];

const dartRules = [
  [/\bColor\(0x|Color\.fromARGB|\bColors\.\w/, 'raw colour: use HorideColors.* or the theme'],
  [/fontSize:\s*\d/, 'raw font size: use HorideFontSize.* or a textTheme style'],
  [/FontWeight\.w\d/, 'raw font weight: use HorideFontWeight.*'],
  [/circular\(\s*\d/, 'raw corner radius: use HorideRadius.*'],
  [
    /EdgeInsets\.\w+\([^)]*(?<![\w.])[1-9]\d*(\.\d+)?\b/,
    'raw padding: use HorideSpace.* or HorideInsets.*',
  ],
  [
    /\b(width|height|size|iconSize|radius|blurRadius|spreadRadius|strokeWidth|elevation):\s*[1-9]/,
    'raw size: use HorideSize.* / HorideSpace.* / HorideStroke.*',
  ],
  [/\bstyleFrom\(/, 'custom button style: use HorideButton'],
  [
    /\b(FilledButton|OutlinedButton|TextButton|ElevatedButton)(\.icon)?\(/,
    'raw Material button: use HorideButton',
  ],
];

const webRules = [
  [
    /\btext-(xs|sm|base|lg|xl|[2-9]xl)\b/,
    'Tailwind font size: use the token sizes (text-caption, text-small, text-body, text-title…)',
  ],
  [
    /\brounded-(md|lg|xl|2xl|3xl)\b/,
    'Tailwind corner: use rounded-sm, rounded-control, rounded-card, rounded-sign, rounded-panel or rounded-pill',
  ],
  [
    /\b(bg|text|border|ring|from|to|fill|stroke|outline|divide|accent)-(slate|gray|zinc|neutral|stone|red|orange|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/,
    'Tailwind palette colour: use a Horide colour token',
  ],
  [
    /^\s*[\w-]+:[^;]*\b\d+(\.\d+)?(px|rem|em)\b/,
    'raw CSS length: use var(--space-*), var(--text-*), var(--radius-*) or var(--stroke-*)',
  ],
  [
    /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])/,
    'raw colour: use a token class (bg-navy, text-sign…) or colors from lib/tokens.g.ts',
  ],
  [/\brgba?\(/, 'raw colour: use a token'],
  [
    /\b(text|bg|border|ring|outline|accent|fill|stroke|shadow|rounded|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y|leading|tracking|font)-\[/,
    'one-off Tailwind value: add it to design/tokens.json or use the scale',
  ],
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', 'out', 'build', '.dart_tool', 'android', 'ios'].includes(name))
      continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const targets = [
  ['packages/horide_core/lib', /\.dart$/, dartRules],
  ['mobile/passenger/lib', /\.dart$/, dartRules],
  ['mobile/driver/lib', /\.dart$/, dartRules],
  ['apps/admin/src', /\.(tsx?|css)$/, webRules],
  ['apps/web/src', /\.(tsx?|css)$/, webRules],
];

let problems = 0;
for (const [dir, ext, rules] of targets) {
  for (const file of walk(join(root, dir))) {
    const rel = relative(root, file);
    if (!ext.test(file) || ALLOWED.some((a) => rel.startsWith(a))) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments
        for (const [re, why] of rules) {
          if (re.test(line)) {
            console.log(`${rel}:${i + 1}: ${why}\n    ${line.trim()}`);
            problems++;
          }
        }
      });
  }
}
if (problems) {
  console.log(`\n${problems} hardcoded design value(s). See docs/DESIGN_SYSTEM.md.`);
  process.exit(1);
}
console.log('Design check passed: every screen uses the shared tokens and components.');

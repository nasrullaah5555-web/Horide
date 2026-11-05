# Musride Design System

**Rule: every colour, size, spacing, corner, font size, line width and button style in Musride comes from one file, `design/tokens.json`.** The passenger app, driver app, staff console and website all read from it, so they look the same and can't drift apart. CI fails if any screen hardcodes a value (`scripts/check-design.mjs`).

## How it fits together

```
design/tokens.json                      ← the only place values are defined
        │  node scripts/gen-tokens.mjs  (pnpm tokens)
        ├── packages/musride_core/lib/src/design/tokens.g.dart   → both Flutter apps
        ├── packages/design-tokens/tokens.css                   → staff console + website (Tailwind)
        └── apps/admin/src/lib/tokens.g.ts                      → map markers in the console
```

Generated files say "Do not edit by hand". CI runs `gen-tokens.mjs --check` and fails if they are out of date.

## Changing the look

1. Edit `design/tokens.json` (e.g. change `color.sign` or `radius.control`).
2. Run `pnpm tokens`.
3. Commit all changed files. Every app, the console and the website change together.

To add something new (a colour, a size), add it to `tokens.json` first, then use the generated name. Never write the value directly in a screen.

## Tokens

| Group | Flutter | Web (Tailwind / CSS) | Values |
|---|---|---|---|
| Colours | `MusrideColors.navy` | `bg-navy`, `text-sign`, `var(--color-navy)` | navy #14283E, sign green #19A974, ground #F3F5F7, white, line, muted, amber (attention), signal red (danger), stale grey, night colours (dark theme) |
| Spacing | `MusrideSpace.md` | `var(--space-md)`; Tailwind spacing scale | xxs 2, xs 4, sm 8, md 12, lg 16, xl 24, xxl 32, xxxl 48 |
| Corners | `MusrideRadius.control` | `rounded-control` | sm 4, control 10 (buttons, inputs), card 12, sign 14, panel 18, pill |
| Font sizes | `MusrideFontSize.body` | `text-body` | caption 12, small 13, body 15, bodyLarge 16, button 17, reading 17, title 18, titleLarge 20, headline 24, display 28, code 30, hero 44 |
| Weights | `MusrideFontWeight.bold` | `font-bold` | 400, 600, 700, 800 |
| Sizes | `MusrideSize.touchTarget` | `var(--size-touch-target)` | touch target 56, icons 18/24/30, avatar 52, map pin 26, marker 30 |
| Lines | `MusrideStroke.control` | `var(--stroke-control)` | hairline 1, control 1.5, focus 2, selected 2.5, sign border 3, marker 4 |

Typeface: **Overpass** (bundled, open licence), derived from road-sign lettering.

## Shared components

Screens are built from these; they never style their own.

**Apps** (`packages/musride_core/lib/src/design/`):

| Component | Use |
|---|---|
| `MusrideButton(kind: …)` | Every button. Kinds: `primary` (navy), `go` (green: book, accept, go online, confirm), `secondary` (outlined), `danger` (red outline: cancel), `emergency` (red filled: emergency calls only), `quiet` and `quietDanger` (text links). Same height (56), corners and type everywhere. |
| `SignPanel` | The one most important status on a screen (green, navy or red road sign). |
| `MusrideBottomPanel` | The white panel at the bottom of every map screen. |
| `MusrideRoundButton` | Round buttons floating on a map (menu, my location, call). |
| `OptionTile` | Selectable choices (car / Bajaj price). |
| `MusrideNotice` | Amber "needs attention" box. |
| `StatusText`, `HintText` | Green/amber status line; small muted text. |
| `InfoRow`, `PlateBadge`, `InitialAvatar`, `StarRating`, `PanelSpinner`, `Gap` | Receipts, plates, avatars, ratings, spinner on a sign, spacing. |
| `MapPin`, `PositionDot`, `pinMarker`, `CentrePin`, `PlacePicker` | Every map marker and the place picker. Stale positions are hollow grey. |

**Web** (`packages/design-tokens/components.css`): `.sign`, `.sign-navy`, `.sign-alert` (the same road-sign panel as the apps), focus ring, page colours. The console's `components/ui.tsx` (buttons, badges, page headers) uses only token classes.

## What the check rejects

`node scripts/check-design.mjs` (also `pnpm design:check`) fails on:

- **Apps:** `Color(0x…)`, `Colors.*`, numeric `fontSize`, `FontWeight.w…`, numeric radii, paddings, widths/heights/icon sizes/elevations, `styleFrom(`, and raw `FilledButton`/`OutlinedButton`/`TextButton`.
- **Web:** hex or `rgb()` colours, one-off Tailwind values (`text-[15px]`, `bg-[#…]`), Tailwind's default font sizes (`text-sm`, `text-xl`…), default corners (`rounded-md`…), default palette colours (`bg-gray-100`…), and raw `px`/`rem` lengths in CSS.

Only the token files, the theme builder (`theme.dart`) and the shared components may contain raw values.

## Light and dark

Both themes are built from tokens in `theme.dart`. The apps follow the phone's setting. The website and console are light only.

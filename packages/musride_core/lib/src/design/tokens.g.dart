// GENERATED from design/tokens.json by scripts/gen-tokens.mjs. Do not edit by hand.

import 'package:flutter/painting.dart';

/// Every colour used anywhere in the apps.
abstract final class MusrideColors {
  static const navy = Color(0xFF14283E);
  static const navySoft = Color(0xFF23405F);
  static const sign = Color(0xFF19A974);
  static const signDeep = Color(0xFF12805A);
  static const signSoft = Color(0xFFE3F5EE);
  static const ground = Color(0xFFF3F5F7);
  static const white = Color(0xFFFFFFFF);
  static const line = Color(0xFFDDE3EA);
  static const muted = Color(0xFF5B6B7D);
  static const stale = Color(0xFF8A97A6);
  static const info = Color(0xFFE8EEF5);
  static const amber = Color(0xFFB7791F);
  static const amberSoft = Color(0xFFFBF1E1);
  static const signal = Color(0xFFC0392B);
  static const signalSoft = Color(0xFFFBE9E7);
  static const night = Color(0xFF0E1C2C);
  static const nightSurface = Color(0xFF172A40);
  static const nightLine = Color(0xFF2A4260);
  static const nightMuted = Color(0xFFA9B6C4);
  static const shadow = Color(0x4014283E);
  static const scrim = Color(0x8014283E);
  static const rowHover = Color(0xFFF8FAFB);
}

/// Spacing scale (logical pixels). Paddings and gaps use only these.
abstract final class MusrideSpace {
  static const xxs = 2.0;
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  static const xxl = 32.0;
  static const xxxl = 48.0;
}

/// Corner radii.
abstract final class MusrideRadius {
  static const sm = 4.0;
  static const control = 10.0;
  static const card = 12.0;
  static const sign = 14.0;
  static const panel = 18.0;
  static const pill = 999.0;
}

/// Type scale.
abstract final class MusrideFontSize {
  static const caption = 12.0;
  static const small = 13.0;
  static const body = 15.0;
  static const bodyLarge = 16.0;
  static const button = 17.0;
  static const title = 18.0;
  static const titleLarge = 20.0;
  static const headline = 24.0;
  static const display = 28.0;
  static const hero = 44.0;
  static const code = 30.0;
  static const reading = 17.0;
}

/// Font weights.
abstract final class MusrideFontWeight {
  static const regular = FontWeight.w400;
  static const medium = FontWeight.w600;
  static const bold = FontWeight.w700;
  static const heavy = FontWeight.w800;
}

/// Line heights (multiples of the font size).
abstract final class MusrideLineHeight {
  static const tight = 1.1;
  static const body = 1.45;
}

/// Letter spacing.
abstract final class MusrideLetterSpacing {
  static const tight = -0.3;
  static const plate = 1.5;
  static const phone = 1.0;
  static const code = 12.0;
}

/// Fixed sizes: touch targets, icons, map markers.
abstract final class MusrideSize {
  static const touchTarget = 56.0;
  static const iconSmall = 18.0;
  static const icon = 24.0;
  static const iconLarge = 30.0;
  static const avatar = 52.0;
  static const pin = 26.0;
  static const pinStem = 14.0;
  static const marker = 30.0;
  static const spinner = 24.0;
  static const star = 38.0;
}

/// Line and border widths.
abstract final class MusrideStroke {
  static const hairline = 1.0;
  static const control = 1.5;
  static const focus = 2.0;
  static const selected = 2.5;
  static const signBorder = 3.0;
  static const marker = 4.0;
}

/// The bundled typeface (packages/musride_core/assets/fonts).
const musrideFontFamily = 'packages/musride_core/Overpass';

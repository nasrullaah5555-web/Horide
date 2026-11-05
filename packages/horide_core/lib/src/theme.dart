import 'package:flutter/material.dart';

/// Horide brand colours. Sign green is the brand green and the colour of road signs;
/// amber and signal red are reserved for "needs attention" and "danger".
class HorideColors {
  const HorideColors._();

  static const navy = Color(0xFF14283E);
  static const navySoft = Color(0xFF23405F);
  static const sign = Color(0xFF19A974);
  static const signDeep = Color(0xFF12805A);
  static const ground = Color(0xFFF3F5F7);
  static const white = Color(0xFFFFFFFF);
  static const line = Color(0xFFDDE3EA);
  static const muted = Color(0xFF5B6B7D);
  static const amber = Color(0xFFB7791F);
  static const signal = Color(0xFFC0392B);

  /// Dark theme surfaces.
  static const night = Color(0xFF0E1C2C);
  static const nightSurface = Color(0xFF172A40);
  static const nightLine = Color(0xFF2A4260);
}

/// The font is bundled inside this package, so apps refer to it with the package prefix.
const _font = 'packages/horide_core/Overpass';

/// Minimum touch target for the main actions. Larger than Material's 48 dp because the apps
/// are often used one-handed, in a moving vehicle, or by drivers glancing at a phone mount.
const double kLargeTouchTarget = 56;

class HorideTheme {
  const HorideTheme._();

  static ThemeData light() => _build(
    brightness: Brightness.light,
    background: HorideColors.ground,
    surface: HorideColors.white,
    onSurface: HorideColors.navy,
    muted: HorideColors.muted,
    line: HorideColors.line,
    primary: HorideColors.navy,
    onPrimary: HorideColors.white,
  );

  static ThemeData dark() => _build(
    brightness: Brightness.dark,
    background: HorideColors.night,
    surface: HorideColors.nightSurface,
    onSurface: HorideColors.white,
    muted: const Color(0xFFA9B6C4),
    line: HorideColors.nightLine,
    primary: HorideColors.sign,
    onPrimary: HorideColors.white,
  );

  static ThemeData _build({
    required Brightness brightness,
    required Color background,
    required Color surface,
    required Color onSurface,
    required Color muted,
    required Color line,
    required Color primary,
    required Color onPrimary,
  }) {
    final scheme = ColorScheme(
      brightness: brightness,
      primary: primary,
      onPrimary: onPrimary,
      secondary: HorideColors.sign,
      onSecondary: HorideColors.white,
      error: HorideColors.signal,
      onError: HorideColors.white,
      surface: surface,
      onSurface: onSurface,
      outline: line,
      onSurfaceVariant: muted,
    );
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: background,
      fontFamily: _font,
    );
    final text = base.textTheme.apply(
      fontFamily: _font,
      bodyColor: onSurface,
      displayColor: onSurface,
    );
    return base.copyWith(
      textTheme: text.copyWith(
        headlineMedium: text.headlineMedium?.copyWith(
          fontWeight: FontWeight.w800,
          letterSpacing: -0.3,
        ),
        titleLarge: text.titleLarge?.copyWith(fontWeight: FontWeight.w700),
        titleMedium: text.titleMedium?.copyWith(fontWeight: FontWeight.w700),
        bodyLarge: text.bodyLarge?.copyWith(fontSize: 16, height: 1.45),
        bodyMedium: text.bodyMedium?.copyWith(fontSize: 15, height: 1.45),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: background,
        foregroundColor: onSurface,
        elevation: 0,
        scrolledUnderElevation: 0,
        titleTextStyle: TextStyle(
          fontFamily: _font,
          fontSize: 20,
          fontWeight: FontWeight.w800,
          color: onSurface,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(kLargeTouchTarget),
          backgroundColor: primary,
          foregroundColor: onPrimary,
          textStyle: const TextStyle(fontFamily: _font, fontSize: 17, fontWeight: FontWeight.w700),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(kLargeTouchTarget),
          foregroundColor: onSurface,
          side: BorderSide(color: line, width: 1.5),
          textStyle: const TextStyle(fontFamily: _font, fontSize: 17, fontWeight: FontWeight.w700),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: line),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: HorideColors.sign, width: 2),
        ),
      ),
      cardTheme: CardThemeData(
        color: surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: line),
        ),
      ),
      dividerTheme: DividerThemeData(color: line, thickness: 1, space: 1),
      snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    );
  }
}

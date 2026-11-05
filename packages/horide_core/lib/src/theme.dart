import 'package:flutter/material.dart';

import 'design/tokens.g.dart';

/// Builds Material themes ONLY from design/tokens.json (via tokens.g.dart): no raw values here.
const _font = horideFontFamily;

/// Minimum touch target for the main actions. Larger than Material's 48 dp because the apps
/// are often used one-handed, in a moving vehicle, or by drivers glancing at a phone mount.
const double kLargeTouchTarget = HorideSize.touchTarget;

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
    muted: HorideColors.nightMuted,
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
          fontWeight: HorideFontWeight.heavy,
          letterSpacing: HorideLetterSpacing.tight,
        ),
        titleLarge: text.titleLarge?.copyWith(
          fontSize: HorideFontSize.titleLarge,
          fontWeight: HorideFontWeight.bold,
        ),
        titleMedium: text.titleMedium?.copyWith(
          fontSize: HorideFontSize.title,
          fontWeight: HorideFontWeight.bold,
        ),
        headlineSmall: text.headlineSmall?.copyWith(
          fontSize: HorideFontSize.headline,
          fontWeight: HorideFontWeight.heavy,
        ),
        labelSmall: text.labelSmall?.copyWith(fontSize: HorideFontSize.caption),
        bodySmall: text.bodySmall?.copyWith(fontSize: HorideFontSize.small, color: muted),
        bodyLarge: text.bodyLarge?.copyWith(fontSize: HorideFontSize.bodyLarge, height: HorideLineHeight.body),
        bodyMedium: text.bodyMedium?.copyWith(fontSize: HorideFontSize.body, height: HorideLineHeight.body),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: background,
        foregroundColor: onSurface,
        elevation: 0,
        scrolledUnderElevation: 0,
        titleTextStyle: TextStyle(
          fontFamily: _font,
          fontSize: HorideFontSize.titleLarge,
          fontWeight: HorideFontWeight.heavy,
          color: onSurface,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(kLargeTouchTarget),
          backgroundColor: primary,
          foregroundColor: onPrimary,
          textStyle: const TextStyle(
            fontFamily: _font,
            fontSize: HorideFontSize.button,
            fontWeight: HorideFontWeight.bold,
          ),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(HorideRadius.control)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(kLargeTouchTarget),
          foregroundColor: onSurface,
          side: BorderSide(color: line, width: HorideStroke.control),
          textStyle: const TextStyle(
            fontFamily: _font,
            fontSize: HorideFontSize.button,
            fontWeight: HorideFontWeight.bold,
          ),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(HorideRadius.control)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface,
        contentPadding: const EdgeInsets.all(HorideSpace.lg),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(HorideRadius.control),
          borderSide: BorderSide(color: line),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(HorideRadius.control),
          borderSide: BorderSide(color: line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(HorideRadius.control),
          borderSide: const BorderSide(color: HorideColors.sign, width: HorideStroke.focus),
        ),
      ),
      cardTheme: CardThemeData(
        color: surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(HorideRadius.card),
          side: BorderSide(color: line),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: line,
        thickness: HorideStroke.hairline,
        space: HorideStroke.hairline,
      ),
      snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    );
  }
}

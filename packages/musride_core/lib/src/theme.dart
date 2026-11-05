import 'package:flutter/material.dart';

import 'design/tokens.g.dart';

/// Builds Material themes ONLY from design/tokens.json (via tokens.g.dart): no raw values here.
const _font = musrideFontFamily;

/// Minimum touch target for the main actions. Larger than Material's 48 dp because the apps
/// are often used one-handed, in a moving vehicle, or by drivers glancing at a phone mount.
const double kLargeTouchTarget = MusrideSize.touchTarget;

class MusrideTheme {
  const MusrideTheme._();

  static ThemeData light() => _build(
    brightness: Brightness.light,
    background: MusrideColors.ground,
    surface: MusrideColors.white,
    onSurface: MusrideColors.navy,
    muted: MusrideColors.muted,
    line: MusrideColors.line,
    primary: MusrideColors.navy,
    onPrimary: MusrideColors.white,
  );

  static ThemeData dark() => _build(
    brightness: Brightness.dark,
    background: MusrideColors.night,
    surface: MusrideColors.nightSurface,
    onSurface: MusrideColors.white,
    muted: MusrideColors.nightMuted,
    line: MusrideColors.nightLine,
    primary: MusrideColors.sign,
    onPrimary: MusrideColors.white,
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
      secondary: MusrideColors.sign,
      onSecondary: MusrideColors.white,
      error: MusrideColors.signal,
      onError: MusrideColors.white,
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
          fontWeight: MusrideFontWeight.heavy,
          letterSpacing: MusrideLetterSpacing.tight,
        ),
        titleLarge: text.titleLarge?.copyWith(
          fontSize: MusrideFontSize.titleLarge,
          fontWeight: MusrideFontWeight.bold,
        ),
        titleMedium: text.titleMedium?.copyWith(
          fontSize: MusrideFontSize.title,
          fontWeight: MusrideFontWeight.bold,
        ),
        headlineSmall: text.headlineSmall?.copyWith(
          fontSize: MusrideFontSize.headline,
          fontWeight: MusrideFontWeight.heavy,
        ),
        labelSmall: text.labelSmall?.copyWith(fontSize: MusrideFontSize.caption),
        bodySmall: text.bodySmall?.copyWith(fontSize: MusrideFontSize.small, color: muted),
        bodyLarge: text.bodyLarge?.copyWith(
          fontSize: MusrideFontSize.bodyLarge,
          height: MusrideLineHeight.body,
        ),
        bodyMedium: text.bodyMedium?.copyWith(
          fontSize: MusrideFontSize.body,
          height: MusrideLineHeight.body,
        ),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: background,
        foregroundColor: onSurface,
        elevation: 0,
        scrolledUnderElevation: 0,
        titleTextStyle: TextStyle(
          fontFamily: _font,
          fontSize: MusrideFontSize.titleLarge,
          fontWeight: MusrideFontWeight.heavy,
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
            fontSize: MusrideFontSize.button,
            fontWeight: MusrideFontWeight.bold,
          ),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(MusrideRadius.control)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(kLargeTouchTarget),
          foregroundColor: onSurface,
          side: BorderSide(color: line, width: MusrideStroke.control),
          textStyle: const TextStyle(
            fontFamily: _font,
            fontSize: MusrideFontSize.button,
            fontWeight: MusrideFontWeight.bold,
          ),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(MusrideRadius.control)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface,
        contentPadding: const EdgeInsets.all(MusrideSpace.lg),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(MusrideRadius.control),
          borderSide: BorderSide(color: line),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(MusrideRadius.control),
          borderSide: BorderSide(color: line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(MusrideRadius.control),
          borderSide: const BorderSide(color: MusrideColors.sign, width: MusrideStroke.focus),
        ),
      ),
      cardTheme: CardThemeData(
        color: surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(MusrideRadius.card),
          side: BorderSide(color: line),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: line,
        thickness: MusrideStroke.hairline,
        space: MusrideStroke.hairline,
      ),
      snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    );
  }
}

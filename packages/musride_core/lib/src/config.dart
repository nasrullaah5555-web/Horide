import 'package:flutter/foundation.dart';

/// Build-time configuration. Nothing secret lives in the app: only the public API address.
///
/// Set it when building, for example:
///   flutter run --dart-define=MUSRIDE_API_URL=https://api.example.com
class MusrideConfig {
  const MusrideConfig._();

  /// Default points at the development API on the host machine as seen from the Android emulator.
  static const String apiUrl = String.fromEnvironment(
    'MUSRIDE_API_URL',
    defaultValue: 'http://10.0.2.2:3000',
  );

  /// Why this build must not run, or null. A release build must talk to the real API over
  /// HTTPS: the development default would silently send people's data nowhere useful (or over
  /// plain HTTP). Checked at startup by both apps.
  static String? get releaseProblem => checkApiUrl(apiUrl, release: kReleaseMode);

  @visibleForTesting
  static String? checkApiUrl(String url, {required bool release}) {
    if (!release) return null;
    final uri = Uri.tryParse(url);
    if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) {
      return 'This build has no valid server address. Build it with '
          '--dart-define=MUSRIDE_API_URL=https://api.<your-domain>';
    }
    return null;
  }

  /// Test builds only (the staging workflow sets it): also accept Kenyan numbers written with +254.
  /// The server must have KENYA_TEST_MODE on as well; release builds for the stores never set this.
  static const bool allowKenyanPhones = bool.fromEnvironment('MUSRIDE_ALLOW_KENYAN_PHONES');

  /// What to tell someone whose number was refused.
  static String get phoneHint =>
      allowKenyanPhones
          ? 'Enter an Ethiopian number (0911 234 567) or a Kenyan one starting +254.'
          : 'Enter an Ethiopian mobile number, for example 0911 234 567.';

  /// Jijiga city centre, used to centre maps before the phone has a GPS fix.
  static const double jijigaLat = 9.3505;
  static const double jijigaLng = 42.7979;
}

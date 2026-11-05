/// Build-time configuration. Nothing secret lives in the app: only the public API address.
///
/// Set it when building, for example:
///   flutter run --dart-define=HORIDE_API_URL=https://api.example.com
class HorideConfig {
  const HorideConfig._();

  /// Default points at the development API on the host machine as seen from the Android emulator.
  static const String apiUrl = String.fromEnvironment(
    'HORIDE_API_URL',
    defaultValue: 'http://10.0.2.2:3000',
  );

  /// Jijiga city centre, used to centre maps before the phone has a GPS fix.
  static const double jijigaLat = 9.3505;
  static const double jijigaLng = 42.7979;
}

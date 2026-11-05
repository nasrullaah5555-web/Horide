/// The API sends all money as whole santim in a string (1 ETB = 100 santim), so no
/// floating-point arithmetic is ever done on fares in the apps.
String formatEtb(String? santim) {
  if (santim == null || santim.isEmpty) return '—';
  final value = BigInt.tryParse(santim);
  if (value == null) return '—';
  final negative = value.isNegative;
  final abs = value.abs();
  final whole = (abs ~/ BigInt.from(100)).toString();
  final cents = (abs % BigInt.from(100)).toString().padLeft(2, '0');
  final grouped = whole.replaceAllMapped(
    RegExp(r'\B(?=(\d{3})+(?!\d))'),
    (_) => ',',
  );
  return '${negative ? '-' : ''}$grouped.$cents ETB';
}

/// Short form for buttons and cards: "115 ETB" when there are no cents.
String formatEtbShort(String? santim) {
  final full = formatEtb(santim);
  return full.replaceFirst('.00 ETB', ' ETB');
}

/// Distance in metres → "4.9 km".
String formatKm(int metres) => '${(metres / 1000).toStringAsFixed(1)} km';

/// Duration in seconds → "12 min".
String formatMinutes(int seconds) {
  final minutes = (seconds / 60).ceil();
  return minutes < 1 ? '1 min' : '$minutes min';
}

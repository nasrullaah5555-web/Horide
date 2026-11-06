/// Ethiopian mobile numbers: Ethio Telecom (09…) and Safaricom Ethiopia (07…).
/// Same rules as the backend (`apps/backend/src/modules/auth/phone.ts`), so the app can give
/// instant feedback; the server still validates.
String? normalizeEthiopianMobile(String input) {
  if (input.length > 25) return null;
  final digits = input.replaceAll(RegExp(r'[\s()-]'), '');
  String national;
  if (RegExp(r'^\+251\d{9}$').hasMatch(digits)) {
    national = digits.substring(4);
  } else if (RegExp(r'^251\d{9}$').hasMatch(digits)) {
    national = digits.substring(3);
  } else if (RegExp(r'^0\d{9}$').hasMatch(digits)) {
    national = digits.substring(1);
  } else if (RegExp(r'^\d{9}$').hasMatch(digits)) {
    national = digits;
  } else {
    return null;
  }
  return RegExp(r'^[79]\d{8}$').hasMatch(national) ? '+251$national' : null;
}

/// Kenyan mobile numbers (07… and 01…), for test builds only. The country code is required:
/// "0712 345 678" is also a valid Safaricom Ethiopia number, so without +254 it is Ethiopian.
/// Same rules as the backend.
String? normalizeKenyanMobile(String input) {
  if (input.length > 25) return null;
  final digits = input.replaceAll(RegExp(r'[\s()-]'), '');
  final m = RegExp(r'^\+?254([17]\d{8})$').firstMatch(digits);
  return m == null ? null : '+254${m.group(1)}';
}

/// Ethiopian always; Kenyan too when [allowKenya] (test builds, see MusrideConfig).
String? normalizeMobile(String input, {required bool allowKenya}) =>
    normalizeEthiopianMobile(input) ?? (allowKenya ? normalizeKenyanMobile(input) : null);

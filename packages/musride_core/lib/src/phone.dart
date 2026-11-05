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

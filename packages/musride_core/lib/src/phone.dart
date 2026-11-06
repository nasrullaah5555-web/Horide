import 'market.dart';

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

/// Kenyan mobile numbers (07… and 01…): 0712345678, 712345678, 254712345678, +254712345678.
/// Same rules as the backend.
String? normalizeKenyanMobile(String input) {
  if (input.length > 25) return null;
  final digits = input.replaceAll(RegExp(r'[\s()-]'), '');
  String national;
  if (RegExp(r'^\+254\d{9}$').hasMatch(digits)) {
    national = digits.substring(4);
  } else if (RegExp(r'^254\d{9}$').hasMatch(digits)) {
    national = digits.substring(3);
  } else if (RegExp(r'^0\d{9}$').hasMatch(digits)) {
    national = digits.substring(1);
  } else if (RegExp(r'^\d{9}$').hasMatch(digits)) {
    national = digits;
  } else {
    return null;
  }
  return RegExp(r'^[17]\d{8}$').hasMatch(national) ? '+254$national' : null;
}

/// A mobile number for the market [marketCode] ('ET' or 'KE'). Local numbers are read as local
/// (07… exists in both countries); the other country's numbers need their country code.
/// Same rules as the backend (apps/backend/src/modules/auth/phone.ts).
String? normalizeMobile(String input, {String? marketCode}) {
  final market = marketCode ?? Market.current.code;
  final digits = input.replaceAll(RegExp(r'[\s()-]'), '');
  if (market == 'KE') {
    return normalizeKenyanMobile(input) ??
        (RegExp(r'^\+?251').hasMatch(digits) ? normalizeEthiopianMobile(input) : null);
  }
  return normalizeEthiopianMobile(input) ??
      (RegExp(r'^\+?254').hasMatch(digits) ? normalizeKenyanMobile(input) : null);
}

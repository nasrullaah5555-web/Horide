import 'market.dart';

/// Public emergency numbers shown by the emergency button: the market's (Market.current),
/// the same list the server sends after an alert. Ethiopia's local confirmation: OA-19.
class EmergencyNumber {
  const EmergencyNumber(this.service, this.number);
  final String service;
  final String number;
}

List<EmergencyNumber> get emergencyNumbers => [
  for (final e in Market.current.emergency) EmergencyNumber(e.label, e.number),
];

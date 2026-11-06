import 'api/api_client.dart';
import 'models/models.dart';

/// The city this Musride server serves: currency, payment methods, emergency numbers, phone
/// format and where maps start (server: GET /market, ADR-025).
///
/// [Market.current] starts as the market the app was built for (--dart-define=MUSRIDE_MARKET=KE
/// for the Nairobi test builds) and is confirmed from the server at startup, so prices are never
/// shown in the wrong currency even before the first network answer.
class Market {
  const Market({
    required this.code,
    required this.city,
    required this.currency,
    required this.paymentMethods,
    required this.emergency,
    required this.centre,
    required this.phoneExample,
  });

  factory Market.fromJson(Map<String, dynamic> j) {
    final c = j['centre'] as Map<String, dynamic>;
    return Market(
      code: j['code'] as String,
      city: j['city'] as String,
      currency: j['currency'] as String,
      paymentMethods: [
        for (final m in j['paymentMethods'] as List<dynamic>)
          if (PaymentMethod.values.any((v) => v.name == m))
            PaymentMethod.values.byName(m as String),
      ],
      emergency: [
        for (final e in j['emergency'] as List<dynamic>)
          (label: (e as Map<String, dynamic>)['label'] as String, number: e['number'] as String),
      ],
      centre: LatLngPoint((c['lat'] as num).toDouble(), (c['lng'] as num).toDouble()),
      phoneExample: j['phoneExample'] as String,
    );
  }

  final String code;
  final String city;
  final String currency;
  final List<PaymentMethod> paymentMethods;
  final List<({String label, String number})> emergency;
  final LatLngPoint centre;
  final String phoneExample;

  static const jijiga = Market(
    code: 'ET',
    city: 'Jijiga',
    currency: 'ETB',
    paymentMethods: [PaymentMethod.cash, PaymentMethod.ebirr],
    emergency: [
      (label: 'Police', number: '991'),
      (label: 'Ambulance', number: '907'),
      (label: 'Fire', number: '939'),
      (label: 'Traffic police', number: '945'),
    ],
    centre: LatLngPoint(9.3505, 42.7979),
    phoneExample: '0911 234 567',
  );

  static const nairobi = Market(
    code: 'KE',
    city: 'Nairobi',
    currency: 'KES',
    paymentMethods: [PaymentMethod.cash, PaymentMethod.mpesa],
    emergency: [
      (label: 'Police and emergency', number: '999'),
      (label: 'Emergency', number: '112'),
    ],
    centre: LatLngPoint(-1.2864, 36.8172),
    phoneExample: '0712 345 678',
  );

  static const _built = String.fromEnvironment('MUSRIDE_MARKET', defaultValue: 'ET');

  /// The market in use right now (see the class comment).
  static Market current = _built == 'KE' ? nairobi : jijiga;

  /// Asks the server which market it serves; keeps the built-in one if the server can't be
  /// reached (the next start tries again).
  static Future<void> load(ApiClient api) async {
    try {
      current = Market.fromJson(await api.get('/market'));
    } on Object {
      // Offline at startup: the built-in market is the best guess.
    }
  }
}

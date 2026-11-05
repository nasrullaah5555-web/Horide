import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:horide_core/horide_core.dart';
import 'package:horide_driver/app.dart';
import 'package:horide_driver/core/driver_api.dart';
import 'package:horide_driver/core/location_reporter.dart';
import 'package:horide_driver/core/providers.dart';
import 'package:horide_driver/features/history/history_screen.dart';
import 'package:geolocator/geolocator.dart';

void main() {
  testWidgets('a driver who is not signed in sees the phone-number screen', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [tokenStoreProvider.overrideWithValue(MemoryTokenStore())],
        child: const HorideApp(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Your phone number'), findsOneWidget);
    expect(find.text('Horide Driver'), findsOneWidget);
    expect(find.byType(TextField), findsOneWidget);
  });

  test('earnings add up completed fares in santim without rounding errors', () {
    final trips = [
      const DriverTripSummary({'id': 'a', 'status': 'completed', 'final_fare': '8050', 'requested_at': '2026-11-05T05:00:00Z'}),
      const DriverTripSummary({'id': 'b', 'status': 'completed', 'final_fare': '4025', 'requested_at': '2026-11-05T06:00:00Z'}),
    ];
    expect(HistoryScreen.sumFares(trips), BigInt.from(12075));
    expect(formatEtb(HistoryScreen.sumFares(trips).toString()), contains('120.75'));
  });

  test('location points carry GPS time in UTC and plausible fields only', () {
    final p = Position(
      latitude: 9.35,
      longitude: 42.8,
      timestamp: DateTime.utc(2026, 11, 5, 6),
      accuracy: 12,
      altitude: 0,
      altitudeAccuracy: 0,
      heading: -1, // unknown heading is not sent
      headingAccuracy: 0,
      speed: 10,
      speedAccuracy: 0,
    );
    final json = LocationReporter.toPoint(p);
    expect(json['recordedAt'], '2026-11-05T06:00:00.000Z');
    expect(json.containsKey('heading'), isFalse);
    expect(json['speedKmh'], closeTo(36, 0.001));
  });
}

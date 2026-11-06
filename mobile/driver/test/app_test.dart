import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musride_core/musride_core.dart';
import 'package:musride_driver/app.dart';
import 'package:musride_driver/core/driver_api.dart';
import 'package:musride_driver/core/location_reporter.dart';
import 'package:musride_driver/core/providers.dart';
import 'package:musride_driver/features/history/history_screen.dart';
import 'package:geolocator/geolocator.dart';

void main() {
  testWidgets('a driver who is not signed in sees the phone-number screen', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [tokenStoreProvider.overrideWithValue(MemoryTokenStore())],
        child: const MusrideApp(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Your phone number'), findsOneWidget);
    expect(find.byType(MusrideLogo), findsOneWidget);
    expect(find.text('Driver app · Drive in Jijiga'), findsOneWidget);
    expect(find.byType(TextField), findsOneWidget);
  });

  test('earnings add up completed fares in santim without rounding errors', () {
    final trips = [
      const DriverTripSummary({
        'id': 'a',
        'status': 'completed',
        'final_fare': '8050',
        'requested_at': '2026-11-05T05:00:00Z',
      }),
      const DriverTripSummary({
        'id': 'b',
        'status': 'completed',
        'final_fare': '4025',
        'requested_at': '2026-11-05T06:00:00Z',
      }),
    ];
    expect(HistoryScreen.sumFares(trips), BigInt.from(12075));
  });

  test("today's earnings count only completed trips since midnight", () {
    DriverTripSummary trip(String id, String status, String at, String? fare) =>
        DriverTripSummary({'id': id, 'status': status, 'final_fare': fare, 'requested_at': at});
    final now = DateTime(2026, 11, 6, 18);
    final today = todaysEarnings([
      trip('a', 'completed', DateTime(2026, 11, 6, 9).toUtc().toIso8601String(), '45000'),
      trip('b', 'completed', DateTime(2026, 11, 6, 17).toUtc().toIso8601String(), '17500'),
      trip('c', 'cancelled', DateTime(2026, 11, 6, 12).toUtc().toIso8601String(), null),
      trip('d', 'completed', DateTime(2026, 11, 5, 23).toUtc().toIso8601String(), '9900'),
    ], now: now);
    expect(today.trips, 2);
    expect(today.santim, BigInt.from(62500));
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
    expect(json.containsKey('mocked'), isFalse);
  });

  test('a position from a mock-location app is labelled so the server can refuse it', () {
    final p = Position(
      latitude: 9.35,
      longitude: 42.8,
      timestamp: DateTime.utc(2026, 11, 5, 6),
      accuracy: 5,
      altitude: 0,
      altitudeAccuracy: 0,
      heading: 0,
      headingAccuracy: 0,
      speed: 0,
      speedAccuracy: 0,
      isMocked: true,
    );
    expect(LocationReporter.toPoint(p)['mocked'], isTrue);
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musride_core/musride_core.dart';

import 'models_test.dart' show passengerTripJson;

void main() {
  test('the passenger trip view carries the ride PIN, and live location updates keep it', () {
    final trip = Trip.fromJson({...passengerTripJson, 'startPin': '0427'});
    expect(trip.startPin, '0427');
    final moved = trip.withDriverLocation(
      DriverLocation(point: const LatLngPoint(9.35, 42.8), ageSeconds: 0),
    );
    expect(moved.startPin, '0427');
    expect(moved.driverLocation?.isLive, isTrue);
  });

  test('a trip without a PIN (driver view, or after the start) has none', () {
    expect(Trip.fromJson(passengerTripJson).startPin, isNull);
  });

  testWidgets('the PIN card shows the digits, keeping a leading zero', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: RidePinCard(pin: '0427'))));
    expect(find.text('0427'), findsOneWidget);
    expect(find.text('Ride PIN'), findsOneWidget);
  });
}

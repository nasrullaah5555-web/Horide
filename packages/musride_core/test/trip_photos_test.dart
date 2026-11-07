import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musride_core/musride_core.dart';

/// The smallest valid PNG (1×1 pixel).
final _png = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
);

Widget _host(Widget child) => MaterialApp(home: Scaffold(body: Center(child: child)));

void main() {
  test('reads both photos, and treats missing or broken ones as none', () {
    final b64 = base64Encode(_png);
    final both = TripPhotos.fromJson({
      'driver': {'mime': 'image/jpeg', 'data': b64},
      'vehicle': {'mime': 'image/jpeg', 'data': b64},
    });
    expect(both.driver, _png);
    expect(both.vehicle, _png);

    final none = TripPhotos.fromJson({'driver': null, 'vehicle': null});
    expect(none.driver, isNull);
    expect(none.vehicle, isNull);

    final broken = TripPhotos.fromJson({
      'driver': {'mime': 'image/jpeg', 'data': '%%% not base64 %%%'},
    });
    expect(broken.driver, isNull);
  });

  testWidgets('without a photo the driver shows as their initial', (tester) async {
    await tester.pumpWidget(_host(const DriverPhoto(name: 'abdi Salad')));
    expect(find.text('A'), findsOneWidget);
    expect(find.byType(Image), findsNothing);
  });

  testWidgets('with a photo the driver shows the photo, not the initial', (tester) async {
    await tester.pumpWidget(_host(DriverPhoto(name: 'Abdi', photo: Uint8List.fromList(_png))));
    expect(find.byType(Image), findsOneWidget);
    expect(find.text('A'), findsNothing);
  });

  testWidgets('without a car photo the vehicle type is drawn instead', (tester) async {
    await tester.pumpWidget(_host(const VehiclePhoto(category: VehicleCategory.bajaj)));
    expect(find.byIcon(Icons.electric_rickshaw), findsOneWidget);
    await tester.pumpWidget(_host(const VehiclePhoto(category: VehicleCategory.car)));
    expect(find.byIcon(Icons.directions_car), findsOneWidget);
  });
}

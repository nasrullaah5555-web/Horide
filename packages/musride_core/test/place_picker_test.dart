import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:musride_core/musride_core.dart';

/// The place picker is search first: a result is the answer, with no map pin to move
/// (the owner's phone video of 2026-11-06 showed moving the pin was the hard part).
void main() {
  PlacesApi api() => PlacesApi(
    ApiClient(
      baseUrl: 'https://api.test',
      tokens: MemoryTokenStore(const Tokens(accessToken: 'a', refreshToken: 'r')),
      httpClient: MockClient((req) async {
        final body = switch (req.url.path) {
          '/places/search' => {
            'places': [
              {
                'id': 'pt:-1.296700,36.890800',
                'name': 'Donholm',
                'detail': 'Nairobi',
                'point': {'lat': -1.2967, 'lng': 36.8908},
              },
            ],
          },
          _ => {'name': null},
        };
        return http.Response(jsonEncode(body), 200, headers: {'content-type': 'application/json'});
      }),
    ),
  );

  /// Shows a button that opens the picker; the returned function gives what the picker returned.
  Future<Place? Function()> openPicker(WidgetTester tester, {bool pickup = false}) async {
    Place? result;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder:
              (context) => Scaffold(
                body: TextButton(
                  onPressed: () async {
                    result = await PlacePicker.open(
                      context,
                      title: pickup ? 'Pickup' : 'Where to?',
                      confirmLabel: 'Set',
                      places: api(),
                      offerCurrentLocation: pickup,
                    );
                  },
                  child: const Text('open'),
                ),
              ),
        ),
      ),
    );
    return () => result;
  }

  testWidgets('tapping a search result returns that place at once', (tester) async {
    final result = await openPicker(tester);
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    // Search first: no map until the person asks for it.
    expect(find.text('Choose on the map'), findsOneWidget);
    expect(find.text('Use my current location'), findsNothing);

    await tester.enterText(find.byType(TextField), 'Donholm');
    await tester.pump(const Duration(milliseconds: 500)); // the pause before searching
    await tester.pumpAndSettle();
    await tester.tap(find.text('Donholm').last);
    await tester.pumpAndSettle();

    final place = result();
    expect(place, isNotNull);
    expect(place!.point.lat, -1.2967);
    expect(place.point.lng, 36.8908);
    expect(place.text, 'Donholm');
  });

  testWidgets('the pickup picker offers the current location first', (tester) async {
    await openPicker(tester, pickup: true);
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('Use my current location'), findsOneWidget);
  });
}

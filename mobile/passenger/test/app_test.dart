import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:horide_core/horide_core.dart';
import 'package:horide_passenger/app.dart';
import 'package:horide_passenger/core/providers.dart';

void main() {
  testWidgets('someone not signed in is sent to the phone-number screen', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [tokenStoreProvider.overrideWithValue(MemoryTokenStore())],
        child: const HorideApp(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Your phone number'), findsOneWidget);
    expect(find.text('Send code'), findsOneWidget);
  });

  testWidgets('an invalid phone number is refused on the phone before any request', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [tokenStoreProvider.overrideWithValue(MemoryTokenStore())],
        child: const HorideApp(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '12345');
    await tester.tap(find.text('Send code'));
    await tester.pump();
    expect(find.textContaining('Enter an Ethiopian mobile number'), findsOneWidget);
  });
}

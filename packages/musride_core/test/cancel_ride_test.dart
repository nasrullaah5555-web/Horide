import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musride_core/musride_core.dart';

/// Opens the sheet from a button and records what it returned.
Future<List<CancelChoice?>> _open(WidgetTester tester) async {
  final results = <CancelChoice?>[];
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Builder(
          builder:
              (context) => TextButton(
                onPressed:
                    () async => results.add(
                      await showCancelRideSheet(context, reasons: passengerCancelReasons),
                    ),
                child: const Text('open'),
              ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return results;
}

void main() {
  testWidgets('a reason is optional: cancelling with none chosen sends no reason', (tester) async {
    final results = await _open(tester);
    expect(find.text('Why are you cancelling? (optional)'), findsOneWidget);
    await tester.ensureVisible(find.text('Cancel ride'));
    await tester.tap(find.text('Cancel ride'));
    await tester.pumpAndSettle();
    expect(results.single, isNotNull);
    expect(results.single!.reason, isNull);
  });

  testWidgets('a picked reason is sent as its words', (tester) async {
    final results = await _open(tester);
    await tester.ensureVisible(find.text('I changed my plans'));
    await tester.tap(find.text('I changed my plans'));
    await tester.pump();
    await tester.ensureVisible(find.text('Cancel ride'));
    await tester.tap(find.text('Cancel ride'));
    await tester.pumpAndSettle();
    expect(results.single!.reason, 'I changed my plans');
  });

  testWidgets('"Something else" sends what they wrote', (tester) async {
    final results = await _open(tester);
    await tester.ensureVisible(find.text(otherCancelReason));
    await tester.tap(find.text(otherCancelReason));
    await tester.pump();
    await tester.enterText(find.byType(TextField), '  Road is closed  ');
    await tester.ensureVisible(find.text('Cancel ride'));
    await tester.tap(find.text('Cancel ride'));
    await tester.pumpAndSettle();
    expect(results.single!.reason, 'Road is closed');
  });

  testWidgets('"Keep ride" cancels nothing', (tester) async {
    final results = await _open(tester);
    await tester.ensureVisible(find.text('Keep ride'));
    await tester.tap(find.text('Keep ride'));
    await tester.pumpAndSettle();
    expect(results.single, isNull);
  });
}

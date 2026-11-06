import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musride_core/musride_core.dart';

Widget _phone(Widget child) => MaterialApp(
  home: MediaQuery(
    data: const MediaQueryData(size: Size(360, 780)),
    child: Scaffold(body: Padding(padding: const EdgeInsets.all(16), child: child)),
  ),
);

void main() {
  // Regression: on a real phone the driver's "not approved" notice showed one letter per line,
  // because a full-width button beside the text left the text almost no width.
  testWidgets('a notice with a button keeps its text readable', (tester) async {
    const message = 'Musride has not approved your documents yet.';
    for (final compact in [true, false]) {
      await tester.pumpWidget(
        _phone(
          MusrideNotice(
            text: message,
            action: MusrideButton(
              kind: MusrideButtonKind.quiet,
              compact: compact,
              label: 'Open',
              onPressed: () {},
            ),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
      final textBox = tester.getSize(find.text(message));
      expect(textBox.width, greaterThan(200), reason: 'compact: $compact');
      expect(find.text('Open'), findsOneWidget);
    }
  });

  testWidgets('a dismissable notice shows the close button beside the text', (tester) async {
    var closed = false;
    await tester.pumpWidget(_phone(MusrideNotice(text: 'Offline', onClose: () => closed = true)));
    await tester.tap(find.byTooltip('Dismiss'));
    expect(closed, isTrue);
  });
}

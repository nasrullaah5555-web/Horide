import 'package:flutter_test/flutter_test.dart';

import 'package:horide_passenger/app.dart';

void main() {
  testWidgets('app starts', (tester) async {
    await tester.pumpWidget(const HorideApp());
    expect(find.byType(HorideApp), findsOneWidget);
  });
}

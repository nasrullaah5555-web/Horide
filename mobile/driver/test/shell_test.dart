import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:musride_driver/features/shell/driver_shell.dart';

GoRoute _page(String path, String text) =>
    GoRoute(path: path, builder: (_, __) => Scaffold(body: Text(text)));

void main() {
  testWidgets('the bottom bar has Drive, Trips, Inbox and Account, with the unread count', (
    tester,
  ) async {
    final router = GoRouter(
      routes: [
        StatefulShellRoute.indexedStack(
          builder: (_, __, shell) => DriverShell(shell: shell),
          branches: [
            StatefulShellBranch(routes: [_page('/', 'drive page')]),
            StatefulShellBranch(routes: [_page('/history', 'trips page')]),
            StatefulShellBranch(routes: [_page('/notifications', 'inbox page')]),
            StatefulShellBranch(routes: [_page('/account', 'account page')]),
          ],
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [unreadProvider.overrideWith((_) async => 2)],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    for (final label in ['Drive', 'Trips', 'Inbox', 'Account']) {
      expect(find.text(label), findsOneWidget);
    }
    expect(find.text('2'), findsOneWidget);
    expect(find.text('drive page'), findsOneWidget);

    await tester.tap(find.text('Account'));
    await tester.pumpAndSettle();
    expect(find.text('account page'), findsOneWidget);
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:musride_core/musride_core.dart';

import '../../core/providers.dart';

/// Unread messages for the Inbox tab. Refreshed when the driver switches tabs.
final unreadProvider = FutureProvider.autoDispose<int>((ref) async {
  try {
    return (await fetchInbox(ref.watch(apiClientProvider))).unread;
  } on ApiException {
    return 0; // Offline: no badge rather than an error.
  }
});

/// The driver app's main frame: Drive, Trips, Inbox and Account, always one tap away.
/// Each tab keeps its own state (the map stays where it was when you come back).
class DriverShell extends ConsumerWidget {
  const DriverShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unread = ref.watch(unreadProvider).valueOrNull ?? 0;
    return Scaffold(
      body: shell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
        onDestinationSelected: (i) {
          ref.invalidate(unreadProvider);
          // Tapping the current tab again goes back to its first screen.
          shell.goBranch(i, initialLocation: i == shell.currentIndex);
        },
        destinations: [
          const NavigationDestination(
            icon: Icon(Icons.directions_car_outlined),
            selectedIcon: Icon(Icons.directions_car),
            label: 'Drive',
          ),
          const NavigationDestination(
            icon: Icon(Icons.receipt_long_outlined),
            selectedIcon: Icon(Icons.receipt_long),
            label: 'Trips',
          ),
          NavigationDestination(
            icon: Badge(
              isLabelVisible: unread > 0,
              label: Text('$unread'),
              backgroundColor: MusrideColors.signal,
              child: const Icon(Icons.notifications_outlined),
            ),
            selectedIcon: const Icon(Icons.notifications),
            label: 'Inbox',
            tooltip: unread > 0 ? 'Inbox, $unread unread' : 'Inbox',
          ),
          const NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'Account',
          ),
        ],
      ),
    );
  }
}

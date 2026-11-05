import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:horide_core/horide_core.dart';

import '../../core/passenger_api.dart';

final historyProvider = FutureProvider.autoDispose<List<TripSummary>>(
  (ref) => ref.watch(passengerApiProvider).history(),
);

/// Past trips, newest first. Tap a completed trip for its receipt.
class HistoryScreen extends ConsumerWidget {
  const HistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final trips = ref.watch(historyProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Your trips')),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(historyProvider.future),
        child: trips.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error:
              (e, _) => ListView(
                children: [
                  const SizedBox(height: 120),
                  Center(child: Text(e is ApiException ? e.message : 'Could not load your trips.')),
                  Center(
                    child: TextButton(
                      onPressed: () => ref.invalidate(historyProvider),
                      child: const Text('Try again'),
                    ),
                  ),
                ],
              ),
          data:
              (list) =>
                  list.isEmpty
                      ? ListView(
                        children: const [
                          SizedBox(height: 120),
                          Center(child: Text('No trips yet.')),
                        ],
                      )
                      : ListView.separated(
                        itemCount: list.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (_, i) {
                          final t = list[i];
                          final done = t.status == TripStatus.completed;
                          return ListTile(
                            minVerticalPadding: 12,
                            title: Text(t.destinationText ?? 'Trip to a point on the map'),
                            subtitle: Text('${_date(t.requestedAt)}  •  ${_statusText(t.status)}'),
                            trailing: Text(
                              formatEtbShort(t.fare),
                              style: const TextStyle(fontWeight: FontWeight.w800),
                            ),
                            onTap: done ? () => context.push('/history/${t.id}') : null,
                          );
                        },
                      ),
        ),
      ),
    );
  }

  static String _date(DateTime d) {
    final l = d.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${l.year}-${two(l.month)}-${two(l.day)} ${two(l.hour)}:${two(l.minute)}';
  }

  static String _statusText(TripStatus s) => switch (s) {
    TripStatus.completed => 'Completed',
    TripStatus.cancelled => 'Cancelled',
    TripStatus.expired => 'No driver found',
    _ => 'In progress',
  };
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:horide_core/horide_core.dart';

import '../../core/driver_api.dart';

final driverHistoryProvider = FutureProvider.autoDispose<List<DriverTripSummary>>(
  (ref) => ref.watch(driverApiProvider).history(),
);

/// Trip records and an earnings summary. Earnings are the fares of completed trips, which
/// passengers paid to the driver directly; Horide takes no commission (BR-01).
class HistoryScreen extends ConsumerWidget {
  const HistoryScreen({super.key});

  static BigInt sumFares(Iterable<DriverTripSummary> trips) =>
      trips.fold(BigInt.zero, (sum, t) => sum + BigInt.parse(t.finalFare ?? '0'));

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final trips = ref.watch(driverHistoryProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Trips and earnings')),
      body: trips.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error:
            (e, _) =>
                Center(child: Text(e is ApiException ? e.message : 'Could not load your trips.')),
        data: (list) {
          final now = DateTime.now();
          final today = DateTime(now.year, now.month, now.day);
          final weekStart = today.subtract(Duration(days: today.weekday - 1));
          final done = list.where((t) => t.status == TripStatus.completed).toList();
          final todays = done.where((t) => t.requestedAt.toLocal().isAfter(today));
          final weeks = done.where((t) => t.requestedAt.toLocal().isAfter(weekStart));
          return RefreshIndicator(
            onRefresh: () => ref.refresh(driverHistoryProvider.future),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Row(
                  children: [
                    Expanded(
                      child: _Total(label: 'Today', santim: sumFares(todays), trips: todays.length),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _Total(
                        label: 'This week',
                        santim: sumFares(weeks),
                        trips: weeks.length,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  'Based on your last ${list.length} trips. Fares are paid to you directly.',
                  style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
                ),
                const SizedBox(height: 12),
                if (list.isEmpty)
                  const Center(
                    child: Padding(padding: EdgeInsets.all(32), child: Text('No trips yet.')),
                  ),
                for (final t in list)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(t.destinationText ?? 'Trip to a point on the map'),
                    subtitle: Text(
                      '${t.requestedAt.toLocal().toString().substring(0, 16)}  •  '
                      '${switch (t.status) {
                        TripStatus.completed => 'Completed',
                        TripStatus.cancelled => 'Cancelled',
                        TripStatus.expired => 'Expired',
                        _ => 'In progress',
                      }}',
                    ),
                    trailing: Text(
                      formatEtbShort(t.fare),
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Total extends StatelessWidget {
  const _Total({required this.label, required this.santim, required this.trips});
  final String label;
  final BigInt santim;
  final int trips;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label),
          Text(formatEtbShort(santim.toString()), style: Theme.of(context).textTheme.headlineSmall),
          Text('$trips trip${trips == 1 ? '' : 's'}'),
        ],
      ),
    ),
  );
}

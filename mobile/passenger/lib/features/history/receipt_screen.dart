import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:musride_core/musride_core.dart';

import '../../core/passenger_api.dart';

final receiptProvider = FutureProvider.autoDispose.family<Receipt, String>(
  (ref, id) => ref.watch(passengerApiProvider).receipt(id),
);

class ReceiptScreen extends ConsumerWidget {
  const ReceiptScreen({super.key, required this.tripId});
  final String tripId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final receipt = ref.watch(receiptProvider(tripId));
    return Scaffold(
      appBar: AppBar(title: const Text('Receipt')),
      body: receipt.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error:
            (e, _) =>
                Center(child: Text(e is ApiException ? e.message : 'Could not load the receipt.')),
        data:
            (r) => ListView(
              padding: const EdgeInsets.all(MusrideSpace.lg),
              children: [
                SignPanel(title: formatEtb(r.finalFare), subtitle: 'Paid by ${_method(r.method)}'),
                const Gap(MusrideSpace.lg),
                InfoRow('From', r.pickupText ?? 'Point on the map'),
                InfoRow('To', r.destinationText ?? 'Point on the map'),
                InfoRow('Distance', formatKm(r.distanceMetres)),
                if (r.completedAt != null)
                  InfoRow('Finished', r.completedAt!.toLocal().toString().substring(0, 16)),
                if (r.driverName != null) InfoRow('Driver', r.driverName!),
                if (r.plate != null) InfoRow('Plate', r.plate!),
                InfoRow('Payment', r.paymentStatus.replaceAll('_', ' ')),
                if (r.ebirrReference != null) InfoRow('eBirr reference', r.ebirrReference!),
                const Gap(MusrideSpace.md),
                Text(
                  r.note,
                  style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
                ),
                const Gap(MusrideSpace.xl),
                MusrideButton(
                  kind: MusrideButtonKind.secondary,
                  label: 'Report a problem with this trip',
                  onPressed: () => context.push('/complaint?tripId=$tripId'),
                ),
              ],
            ),
      ),
    );
  }

  static String _method(String m) => m == 'ebirr' ? 'eBirr' : 'cash';
}

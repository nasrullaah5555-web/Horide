import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:horide_core/horide_core.dart';

import '../../core/passenger_api.dart';
import '../../core/ui.dart';
import 'trip_controller.dart';

/// After arrival: pay the driver directly, confirm (or report a problem), rate the driver.
class TripFinishedScreen extends ConsumerStatefulWidget {
  const TripFinishedScreen({super.key, required this.trip});
  final Trip trip;

  @override
  ConsumerState<TripFinishedScreen> createState() => _TripFinishedScreenState();
}

class _TripFinishedScreenState extends ConsumerState<TripFinishedScreen> {
  Receipt? _receipt;
  int _stars = 0;
  final _comment = TextEditingController();
  bool _rated = false;
  bool _confirmed = false; // the receipt status stays 'pending' until the driver also records
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _loadReceipt();
  }

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _loadReceipt() async {
    try {
      final r = await ref.read(passengerApiProvider).receipt(widget.trip.id);
      if (mounted) setState(() => _receipt = r);
    } catch (_) {
      // The payment section shows a retry; the trip fare is already known from the trip.
    }
  }

  Future<void> _do(Future<void> Function(PassengerApi api) action) async {
    setState(() => _busy = true);
    try {
      await action(ref.read(passengerApiProvider));
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _dispute() async {
    final note = TextEditingController();
    final text = await showDialog<String>(
      context: context,
      builder:
          (d) => AlertDialog(
            title: const Text('Report a payment problem'),
            content: TextField(
              controller: note,
              maxLength: 500,
              maxLines: 4,
              minLines: 2,
              decoration: const InputDecoration(
                hintText: 'What went wrong? (at least 5 characters)',
              ),
            ),
            actions: [
              HorideButton(kind: HorideButtonKind.quiet, label: 'Back', onPressed: () => Navigator.pop(d)),
              HorideButton(label: 'Send', onPressed: () => Navigator.pop(d, note.text.trim())),
            ],
          ),
    );
    note.dispose();
    if (text == null || text.length < 5) return;
    await _do((api) async {
      final r = await api.disputePayment(widget.trip.id, text);
      if (mounted) setState(() => _receipt = r);
    });
  }

  void _close() {
    ref.read(activeTripProvider.notifier).clear();
    context.go('/');
  }

  @override
  Widget build(BuildContext context) {
    final trip = widget.trip;
    final theme = Theme.of(context);
    final receipt = _receipt;
    final status = receipt?.paymentStatus;
    final passengerAnswered =
        _confirmed || status == 'confirmed' || status == 'disputed' || status == 'resolved';

    return Scaffold(
      appBar: AppBar(title: const Text('Trip finished'), automaticallyImplyLeading: false),
      body: ListView(
        padding: const EdgeInsets.all(HorideSpace.lg),
        children: [
          SignPanel(
            title: formatEtb(trip.fare),
            subtitle: 'Pay your driver by ${paymentLabel(trip.paymentMethod)}',
          ),
          const Gap(HorideSpace.sm),
          Text(
            'Horide does not take ride payments. Pay the driver directly, then confirm here.',
            style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
          ),
          const Gap(HorideSpace.lg),
          Text('Payment', style: theme.textTheme.titleMedium),
          const Gap(HorideSpace.sm),
          if (receipt == null)
            HorideButton(kind: HorideButtonKind.secondary, label: 'Load payment details', onPressed: _loadReceipt)
          else ...[
            InfoRow(
              'Status',
              _confirmed && status == 'pending'
                  ? 'You confirmed. Waiting for the driver to record it.'
                  : _statusText(receipt.paymentStatus),
            ),
            if (receipt.ebirrReference != null) InfoRow('eBirr reference', receipt.ebirrReference!),
            const Gap(HorideSpace.sm),
            if (!passengerAnswered) ...[
              HorideButton(label: 'I have paid the driver', onPressed: _busy
                        ? null
                        : () => _do((api) async {
                          final r = await api.confirmPayment(trip.id);
                          if (mounted) {
                            setState(() {
                              _receipt = r;
                              _confirmed = true;
                            });
                          }
                        })),
              const Gap(HorideSpace.sm),
            ],
            if (status != 'disputed' && status != 'resolved')
              HorideButton(kind: HorideButtonKind.secondary, label: 'Report a payment problem', onPressed: _busy ? null : _dispute),
          ],
          const Gap(HorideSpace.xl),
          Text('Rate your driver', style: theme.textTheme.titleMedium),
          if (_rated)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: HorideSpace.md),
              child: Text('Thank you for rating your driver.'),
            )
          else ...[
            StarRating(value: _stars, onChanged: (i) => setState(() => _stars = i)),
            TextField(
              controller: _comment,
              maxLength: 500,
              decoration: const InputDecoration(hintText: 'Comment (optional)'),
            ),
            FilledButton.tonal(
              onPressed:
                  _busy || _stars == 0
                      ? null
                      : () => _do((api) async {
                        await api.rate(trip.id, _stars, _comment.text.trim());
                        if (mounted) setState(() => _rated = true);
                      }),
              child: const Text('Send rating'),
            ),
          ],
          const Gap(HorideSpace.xl),
          HorideButton(label: 'Done', onPressed: _close),
        ],
      ),
    );
  }

  static String _statusText(String s) => switch (s) {
    'pending' => 'Not confirmed yet',
    'driver_recorded' => 'Driver says payment received. Please confirm.',
    'confirmed' => 'Confirmed',
    'disputed' => 'Problem reported. Horide staff will contact you.',
    'resolved' => 'Resolved by Horide staff',
    _ => s,
  };
}

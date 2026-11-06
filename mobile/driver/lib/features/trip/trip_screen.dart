import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:musride_core/musride_core.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/driver_api.dart';
import '../../core/ui.dart';
import '../home/driver_controller.dart';

/// The driver's trip, one clear next step at a time:
/// accepted → on the way → arrived → started → completed → record the payment.
class TripScreen extends ConsumerStatefulWidget {
  const TripScreen({super.key});

  @override
  ConsumerState<TripScreen> createState() => _TripScreenState();
}

class _TripScreenState extends ConsumerState<TripScreen> {
  bool _busy = false;

  Future<void> _step(Trip trip, String step) async {
    setState(() => _busy = true);
    try {
      final t = await ref.read(driverApiProvider).step(trip.id, step);
      ref.read(driverControllerProvider.notifier).showTrip(t);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancel(Trip trip) async {
    final reason = TextEditingController();
    final text = await showDialog<String>(
      context: context,
      builder:
          (d) => AlertDialog(
            title: const Text('Cancel this trip?'),
            content: TextField(
              controller: reason,
              maxLength: 300,
              decoration: const InputDecoration(
                hintText: 'Reason (for example: passenger not found)',
              ),
            ),
            actions: [
              MusrideButton(
                compact: true,
                kind: MusrideButtonKind.quiet,
                label: 'Keep trip',
                onPressed: () => Navigator.pop(d),
              ),
              MusrideButton(
                compact: true,
                label: 'Cancel trip',
                onPressed: () => Navigator.pop(d, reason.text.trim()),
              ),
            ],
          ),
    );
    reason.dispose();
    if (text == null) return;
    setState(() => _busy = true);
    try {
      final t = await ref
          .read(driverApiProvider)
          .cancel(trip.id, text.isEmpty ? 'Cancelled by driver' : text);
      ref.read(driverControllerProvider.notifier).showTrip(t);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Opens the phone's maps app with directions (no maps SDK or key needed in Musride).
  Future<void> _navigate(LatLngPoint to) async {
    final google = Uri.parse(
      'https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}&travelmode=driving',
    );
    final geo = Uri.parse('geo:${to.lat},${to.lng}?q=${to.lat},${to.lng}');
    if (!await launchUrl(google, mode: LaunchMode.externalApplication)) {
      await launchUrl(geo, mode: LaunchMode.externalApplication);
    }
  }

  void _emergency(Trip trip) {
    showEmergencySheet(
      context,
      alertMusride: () async {
        final p = await currentPosition();
        await ref
            .read(driverApiProvider)
            .emergency(tripId: trip.id, position: p == null ? null : toPoint(p));
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final trip = ref.watch(driverControllerProvider.select((s) => s.trip));
    if (trip == null) {
      return Scaffold(
        body: Center(child: MusrideButton(label: 'Back', onPressed: () => context.go('/'))),
      );
    }
    if (trip.status == TripStatus.completed) return PaymentScreen(trip: trip);

    final toPickup = trip.status == TripStatus.accepted || trip.status == TripStatus.driverArriving;
    final target = toPickup || trip.status == TripStatus.arrived ? trip.pickup : trip.destination;
    final passenger = trip.passenger;

    final (title, subtitle) = switch (trip.status) {
      TripStatus.accepted => ('Go to pickup', trip.pickup.text ?? 'Point on the map'),
      TripStatus.driverArriving => ('Driving to pickup', trip.pickup.text ?? 'Point on the map'),
      TripStatus.arrived => ('Waiting for passenger', 'Start the trip when they are in'),
      TripStatus.inProgress => (
        'Drive to destination',
        trip.destination.text ?? 'Point on the map',
      ),
      TripStatus.cancelled => (
        'Trip cancelled',
        trip.cancelledBy == 'driver' ? 'You cancelled.' : 'The passenger cancelled.',
      ),
      TripStatus.expired => ('Trip expired', null),
      _ => ('Trip', null),
    };

    return Scaffold(
      body: Stack(
        children: [
          FlutterMap(
            options: MapOptions(initialCenter: toLatLng(target.point), initialZoom: 15),
            children: [
              ...baseMapLayers(),
              MarkerLayer(
                markers: [
                  pinMarker(trip.pickup.point, MusrideColors.sign, 'Pickup'),
                  pinMarker(trip.destination.point, MusrideColors.navy, 'Destination'),
                ],
              ),
              mapAttribution(),
            ],
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(MusrideSpace.md),
              child: Align(
                alignment: Alignment.topRight,
                child: MusrideButton(
                  kind: MusrideButtonKind.emergency,
                  icon: Icons.sos,
                  label: 'Emergency',
                  onPressed: () => _emergency(trip),
                ),
              ),
            ),
          ),
          Align(
            alignment: Alignment.bottomCenter,
            child: MusrideBottomPanel(
              children: [
                SignPanel(
                  title: title,
                  subtitle: subtitle,
                  tone: trip.status.isFinal ? SignTone.alert : SignTone.go,
                ),
                const Gap(MusrideSpace.md),
                if (passenger != null)
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          passenger.name ?? 'Passenger',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                      ),
                      if (passenger.phone != null && !trip.status.isFinal)
                        IconButton.filledTonal(
                          tooltip: 'Call passenger',
                          onPressed: () => launchUrl(Uri(scheme: 'tel', path: passenger.phone)),
                          icon: const Icon(Icons.call),
                        ),
                    ],
                  ),
                InfoRow(
                  'Fare',
                  '${formatEtb(trip.fare)}  (${paymentLabel(trip.paymentMethod)}, paid to you)',
                  bold: true,
                ),
                const Gap(MusrideSpace.sm),
                if (trip.status.isFinal)
                  MusrideButton(
                    label: 'Back to home',
                    onPressed: () {
                      ref.read(driverControllerProvider.notifier).closeTrip();
                      context.go('/');
                    },
                  )
                else ...[
                  if (trip.status != TripStatus.arrived)
                    MusrideButton(
                      kind: MusrideButtonKind.secondary,
                      icon: Icons.navigation,
                      label: toPickup ? 'Navigate to pickup' : 'Navigate to destination',
                      onPressed: () => _navigate(target.point),
                    ),
                  const Gap(MusrideSpace.sm),
                  MusrideButton(
                    label: switch (trip.status) {
                      TripStatus.accepted => 'I am on the way',
                      TripStatus.driverArriving => 'I have arrived',
                      TripStatus.arrived => 'Start trip',
                      _ => 'Complete trip',
                    },
                    onPressed:
                        _busy
                            ? null
                            : () => _step(trip, switch (trip.status) {
                              TripStatus.accepted => 'arriving',
                              TripStatus.driverArriving => 'arrived',
                              TripStatus.arrived => 'start',
                              _ => 'complete',
                            }),
                  ),
                  if (trip.status != TripStatus.inProgress)
                    MusrideButton(
                      kind: MusrideButtonKind.quietDanger,
                      label: 'Cancel trip',
                      onPressed: _busy ? null : () => _cancel(trip),
                    ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// After completion: the passenger pays the driver directly; the driver records how.
class PaymentScreen extends ConsumerStatefulWidget {
  const PaymentScreen({super.key, required this.trip, this.fromHistory = false});
  final bool fromHistory;
  final Trip trip;

  @override
  ConsumerState<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends ConsumerState<PaymentScreen> {
  late PaymentMethod _method = widget.trip.paymentMethod;
  final _reference = TextEditingController();
  Map<String, dynamic>? _receipt;
  int _stars = 0;
  bool _rated = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    // Already recorded (e.g. opened again from history)? Then show the record, not the form.
    ref.read(driverApiProvider).receipt(widget.trip.id).then((r) {
      const recordedStates = {'driver_recorded', 'confirmed', 'resolved'};
      if (mounted && recordedStates.contains(r['payment_status'])) setState(() => _receipt = r);
    }, onError: (Object _) {});
  }

  @override
  void dispose() {
    _reference.dispose();
    super.dispose();
  }

  Future<void> _do(Future<void> Function(DriverApi api) action) async {
    setState(() => _busy = true);
    try {
      await action(ref.read(driverApiProvider));
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final trip = widget.trip;
    final recorded = _receipt != null;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Trip completed'),
        automaticallyImplyLeading: widget.fromHistory,
      ),
      body: ListView(
        padding: const EdgeInsets.all(MusrideSpace.lg),
        children: [
          SignPanel(title: formatEtb(trip.fare), subtitle: 'Collect from the passenger'),
          const Gap(MusrideSpace.lg),
          if (recorded)
            InfoRow(
              'Payment',
              'Recorded (${(_receipt!['payment_status'] as String).replaceAll('_', ' ')})',
            )
          else ...[
            Text('How did the passenger pay?', style: Theme.of(context).textTheme.titleMedium),
            const Gap(MusrideSpace.sm),
            SegmentedButton<PaymentMethod>(
              segments: const [
                ButtonSegment(value: PaymentMethod.cash, label: Text('Cash')),
                ButtonSegment(value: PaymentMethod.ebirr, label: Text('eBirr')),
              ],
              selected: {_method},
              onSelectionChanged: (s) => setState(() => _method = s.first),
            ),
            if (_method == PaymentMethod.ebirr)
              TextField(
                controller: _reference,
                maxLength: 40,
                decoration: const InputDecoration(labelText: 'eBirr transaction reference'),
              ),
            const Gap(MusrideSpace.sm),
            MusrideButton(
              label: 'I received the payment',
              onPressed:
                  _busy
                      ? null
                      : () => _do((api) async {
                        final r = await api.recordPayment(
                          trip.id,
                          method: _method,
                          ebirrReference:
                              _method == PaymentMethod.ebirr ? _reference.text.trim() : null,
                        );
                        if (mounted) setState(() => _receipt = r);
                      }),
            ),
            const Gap(MusrideSpace.sm),
            Text(
              'Only record a payment you actually received. Musride compares your record with the '
              'passenger\'s confirmation; differences go to Musride staff.',
              style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
          ],
          const Gap(MusrideSpace.xl),
          Text('Rate the passenger', style: Theme.of(context).textTheme.titleMedium),
          if (_rated)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: MusrideSpace.md),
              child: Text('Thank you.'),
            )
          else
            StarRating(
              value: _stars,
              onChanged:
                  _busy
                      ? null
                      : (i) {
                        setState(() => _stars = i);
                        _do((api) async {
                          await api.ratePassenger(trip.id, i);
                          if (mounted) setState(() => _rated = true);
                        });
                      },
            ),
          const Gap(MusrideSpace.xl),
          MusrideButton(
            label: recorded ? 'Done' : 'Close',
            onPressed: () {
              if (widget.fromHistory) {
                context.pop();
                return;
              }
              ref.read(driverControllerProvider.notifier).closeTrip();
              context.go('/');
            },
          ),
        ],
      ),
    );
  }
}

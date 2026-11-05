import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:horide_core/horide_core.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/driver_api.dart';
import '../../core/map.dart';
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
      builder: (d) => AlertDialog(
        title: const Text('Cancel this trip?'),
        content: TextField(
          controller: reason,
          maxLength: 300,
          decoration: const InputDecoration(hintText: 'Reason (for example: passenger not found)'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: const Text('Keep trip')),
          FilledButton(
            onPressed: () => Navigator.pop(d, reason.text.trim()),
            child: const Text('Cancel trip'),
          ),
        ],
      ),
    );
    reason.dispose();
    if (text == null) return;
    setState(() => _busy = true);
    try {
      final t = await ref.read(driverApiProvider).cancel(trip.id, text.isEmpty ? 'Cancelled by driver' : text);
      ref.read(driverControllerProvider.notifier).showTrip(t);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Opens the phone's maps app with directions (no maps SDK or key needed in Horide).
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
      alertHoride: () async {
        final p = await currentPosition();
        await ref.read(driverApiProvider).emergency(tripId: trip.id, position: p == null ? null : toPoint(p));
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final trip = ref.watch(driverControllerProvider.select((s) => s.trip));
    if (trip == null) {
      return Scaffold(
        body: Center(
          child: FilledButton(onPressed: () => context.go('/'), child: const Text('Back')),
        ),
      );
    }
    if (trip.status == TripStatus.completed) return _PaymentScreen(trip: trip);

    final toPickup = trip.status == TripStatus.accepted || trip.status == TripStatus.driverArriving;
    final target = toPickup || trip.status == TripStatus.arrived ? trip.pickup : trip.destination;
    final passenger = trip.passenger;

    final (title, subtitle) = switch (trip.status) {
      TripStatus.accepted => ('Go to pickup', trip.pickup.text ?? 'Point on the map'),
      TripStatus.driverArriving => ('Driving to pickup', trip.pickup.text ?? 'Point on the map'),
      TripStatus.arrived => ('Waiting for passenger', 'Start the trip when they are in'),
      TripStatus.inProgress => ('Drive to destination', trip.destination.text ?? 'Point on the map'),
      TripStatus.cancelled => ('Trip cancelled', trip.cancelledBy == 'driver' ? 'You cancelled.' : 'The passenger cancelled.'),
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
                  Marker(
                    point: toLatLng(trip.pickup.point),
                    width: 30,
                    height: 44,
                    alignment: Alignment.topCenter,
                    child: const MapPin(colour: HorideColors.sign, label: 'Pickup'),
                  ),
                  Marker(
                    point: toLatLng(trip.destination.point),
                    width: 30,
                    height: 44,
                    alignment: Alignment.topCenter,
                    child: const MapPin(colour: HorideColors.navy, label: 'Destination'),
                  ),
                ],
              ),
              mapAttribution(),
            ],
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Align(
                alignment: Alignment.topRight,
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: HorideColors.signal,
                    minimumSize: const Size(0, kLargeTouchTarget),
                  ),
                  onPressed: () => _emergency(trip),
                  icon: const Icon(Icons.sos),
                  label: const Text('Emergency'),
                ),
              ),
            ),
          ),
          Align(
            alignment: Alignment.bottomCenter,
            child: Material(
              color: Theme.of(context).colorScheme.surface,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
              elevation: 8,
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      SignPanel(
                        title: title,
                        subtitle: subtitle,
                        tone: trip.status.isFinal ? SignTone.alert : SignTone.go,
                      ),
                      const SizedBox(height: 10),
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
                      const SizedBox(height: 8),
                      if (trip.status.isFinal)
                        FilledButton(
                          onPressed: () {
                            ref.read(driverControllerProvider.notifier).closeTrip();
                            context.go('/');
                          },
                          child: const Text('Back to home'),
                        )
                      else ...[
                        if (trip.status != TripStatus.arrived)
                          OutlinedButton.icon(
                            onPressed: () => _navigate(target.point),
                            icon: const Icon(Icons.navigation),
                            label: Text(toPickup ? 'Navigate to pickup' : 'Navigate to destination'),
                          ),
                        const SizedBox(height: 8),
                        FilledButton(
                          onPressed: _busy
                              ? null
                              : () => _step(trip, switch (trip.status) {
                                    TripStatus.accepted => 'arriving',
                                    TripStatus.driverArriving => 'arrived',
                                    TripStatus.arrived => 'start',
                                    _ => 'complete',
                                  }),
                          child: Text(switch (trip.status) {
                            TripStatus.accepted => 'I am on the way',
                            TripStatus.driverArriving => 'I have arrived',
                            TripStatus.arrived => 'Start trip',
                            _ => 'Complete trip',
                          }),
                        ),
                        if (trip.status != TripStatus.inProgress)
                          TextButton(
                            style: TextButton.styleFrom(foregroundColor: HorideColors.signal),
                            onPressed: _busy ? null : () => _cancel(trip),
                            child: const Text('Cancel trip'),
                          ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// After completion: the passenger pays the driver directly; the driver records how.
class _PaymentScreen extends ConsumerStatefulWidget {
  const _PaymentScreen({required this.trip});
  final Trip trip;

  @override
  ConsumerState<_PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends ConsumerState<_PaymentScreen> {
  late PaymentMethod _method = widget.trip.paymentMethod;
  final _reference = TextEditingController();
  Map<String, dynamic>? _receipt;
  int _stars = 0;
  bool _rated = false;
  bool _busy = false;

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
      appBar: AppBar(title: const Text('Trip completed'), automaticallyImplyLeading: false),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          SignPanel(title: formatEtb(trip.fare), subtitle: 'Collect from the passenger'),
          const SizedBox(height: 16),
          if (recorded)
            InfoRow('Payment', 'Recorded (${(_receipt!['payment_status'] as String).replaceAll('_', ' ')})')
          else ...[
            Text('How did the passenger pay?', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
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
            const SizedBox(height: 8),
            FilledButton(
              onPressed: _busy
                  ? null
                  : () => _do((api) async {
                        final r = await api.recordPayment(
                          trip.id,
                          method: _method,
                          ebirrReference: _method == PaymentMethod.ebirr ? _reference.text.trim() : null,
                        );
                        if (mounted) setState(() => _receipt = r);
                      }),
              child: const Text('I received the payment'),
            ),
            const SizedBox(height: 6),
            Text(
              'Only record a payment you actually received. Horide compares your record with the '
              'passenger\'s confirmation; differences go to Horide staff.',
              style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
          ],
          const SizedBox(height: 24),
          Text('Rate the passenger', style: Theme.of(context).textTheme.titleMedium),
          if (_rated)
            const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Text('Thank you.'))
          else
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var i = 1; i <= 5; i++)
                  IconButton(
                    tooltip: '$i star${i == 1 ? '' : 's'}',
                    iconSize: 38,
                    onPressed: _busy
                        ? null
                        : () {
                            setState(() => _stars = i);
                            _do((api) async {
                              await api.ratePassenger(trip.id, i);
                              if (mounted) setState(() => _rated = true);
                            });
                          },
                    icon: Icon(i <= _stars ? Icons.star : Icons.star_border, color: HorideColors.amber),
                  ),
              ],
            ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: () {
              ref.read(driverControllerProvider.notifier).closeTrip();
              context.go('/');
            },
            child: Text(recorded ? 'Done' : 'Close'),
          ),
        ],
      ),
    );
  }
}

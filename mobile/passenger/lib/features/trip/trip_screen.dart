import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:horide_core/horide_core.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/map.dart';
import '../../core/passenger_api.dart';
import '../../core/ui.dart';
import 'trip_controller.dart';
import 'trip_finished.dart';

/// The open trip, from searching to finished. Every status shown here comes from the server.
class TripScreen extends ConsumerStatefulWidget {
  const TripScreen({super.key});

  @override
  ConsumerState<TripScreen> createState() => _TripScreenState();
}

class _TripScreenState extends ConsumerState<TripScreen> {
  final _map = MapController();
  Timer? _tick; // re-checks "live or stale" every few seconds even when no update arrives
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 5), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  Future<void> _run(Future<Trip> Function(PassengerApi api) action) async {
    setState(() => _busy = true);
    try {
      final trip = await action(ref.read(passengerApiProvider));
      ref.read(activeTripProvider.notifier).show(trip);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancel(Trip trip) async {
    final ok = await showDialog<bool>(
      context: context,
      builder:
          (d) => AlertDialog(
            title: const Text('Cancel this ride?'),
            content: Text(
              trip.status.hasDriver
                  ? 'Your driver is already on the way. A cancellation fee may apply.'
                  : 'We will stop looking for a driver.',
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Keep ride')),
              FilledButton(
                onPressed: () => Navigator.pop(d, true),
                child: const Text('Cancel ride'),
              ),
            ],
          ),
    );
    if (ok == true) await _run((api) => api.cancel(trip.id));
  }

  Future<void> _changeDestination(Trip trip) async {
    final place = await PlacePicker.open(
      context,
      title: 'New destination',
      confirmLabel: 'Get new price',
      start: toLatLng(trip.destination.point),
    );
    if (place == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final api = ref.read(passengerApiProvider);
      final p = await api.proposeDestination(trip.id, place.point, place.text);
      if (!mounted) return;
      final approve = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder:
            (d) => AlertDialog(
              title: const Text('New price'),
              content: Text(
                'The new route is ${formatKm(p.distanceMetres)}.\n\n'
                'Price now: ${formatEtb(p.currentFare)}\n'
                'New price: ${formatEtb(p.newFare)}\n\n'
                'Your driver continues to the old destination unless you approve.',
              ),
              actions: [
                TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Keep old')),
                FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Approve')),
              ],
            ),
      );
      final trip2 = await api.decideDestination(trip.id, p.changeId, approve: approve ?? false);
      ref.read(activeTripProvider.notifier).show(trip2);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _emergency(Trip? trip) {
    showEmergencySheet(
      context,
      alertHoride: () async {
        final p = await currentPosition();
        await ref
            .read(passengerApiProvider)
            .emergency(tripId: trip?.id, position: p == null ? null : toPoint(p));
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(activeTripProvider, (prev, next) {
      final before = prev?.valueOrNull?.status;
      final now = next.valueOrNull?.status;
      if (before != now && now == TripStatus.arrived) {
        HapticFeedback.heavyImpact();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Your driver has arrived at the pickup point.')),
        );
      }
      if (next.hasValue && next.value == null) context.go('/');
    });

    final async = ref.watch(activeTripProvider);
    final trip = async.valueOrNull;
    if (trip == null) {
      return Scaffold(
        body: Center(
          child:
              async.hasError
                  ? Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('Could not load your trip.'),
                      TextButton(
                        onPressed: () => ref.invalidate(activeTripProvider),
                        child: const Text('Try again'),
                      ),
                    ],
                  )
                  : const CircularProgressIndicator(),
        ),
      );
    }
    if (trip.status == TripStatus.completed) return TripFinishedScreen(trip: trip);

    final loc = trip.driverLocation;
    final live = loc?.isLive ?? false;
    return Scaffold(
      body: Stack(
        children: [
          FlutterMap(
            mapController: _map,
            options: MapOptions(
              initialCameraFit: CameraFit.coordinates(
                coordinates: [toLatLng(trip.pickup.point), toLatLng(trip.destination.point)],
                padding: const EdgeInsets.fromLTRB(60, 120, 60, 360),
              ),
            ),
            children: [
              ...baseMapLayers(),
              MarkerLayer(
                markers: [
                  _pin(trip.pickup.point, HorideColors.sign, 'Pickup'),
                  _pin(trip.destination.point, HorideColors.navy, 'Destination'),
                  if (loc != null)
                    Marker(
                      point: toLatLng(loc.point),
                      width: 44,
                      height: 44,
                      child: _DriverDot(live: live),
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
          Align(alignment: Alignment.bottomCenter, child: _panel(context, trip, loc, live)),
        ],
      ),
    );
  }

  Marker _pin(LatLngPoint p, Color colour, String label) => Marker(
    point: toLatLng(p),
    width: 30,
    height: 44,
    alignment: Alignment.topCenter,
    child: MapPin(colour: colour, label: label),
  );

  Widget _panel(BuildContext context, Trip trip, DriverLocation? loc, bool live) {
    final theme = Theme.of(context);
    final driver = trip.driver;
    final (title, subtitle, tone) = switch (trip.status) {
      TripStatus.requested || TripStatus.searching => (
        'Finding a driver',
        'Asking nearby ${vehicleLabel(trip.category).toLowerCase()} drivers',
        SignTone.calm,
      ),
      TripStatus.accepted ||
      TripStatus.driverArriving => ('Driver on the way', driver?.vehicle.plate, SignTone.go),
      TripStatus.arrived => ('Your driver is here', driver?.vehicle.plate, SignTone.go),
      TripStatus.inProgress => ('On your way', trip.destination.text, SignTone.go),
      TripStatus.cancelled => (
        'Ride cancelled',
        trip.cancelledBy == 'passenger' ? 'You cancelled this ride.' : 'This ride was cancelled.',
        SignTone.alert,
      ),
      TripStatus.expired => (
        'No driver found',
        'No driver accepted in time. Please try again.',
        SignTone.alert,
      ),
      TripStatus.completed => ('Arrived', null, SignTone.go),
    };

    return Material(
      color: theme.colorScheme.surface,
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
                tone: tone,
                trailing:
                    trip.status == TripStatus.searching || trip.status == TripStatus.requested
                        ? const SizedBox(
                          width: 26,
                          height: 26,
                          child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3),
                        )
                        : null,
              ),
              if (driver != null && trip.status.hasDriver) ...[
                const SizedBox(height: 12),
                _DriverCard(driver: driver),
                const SizedBox(height: 6),
                Text(
                  loc == null
                      ? 'Driver location not available yet.'
                      : live
                      ? 'Live location'
                      : 'Location not updated for ${_ago(loc.ageSeconds)}. The driver may have a weak connection.',
                  style: TextStyle(
                    color: live ? HorideColors.signDeep : HorideColors.amber,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
              const SizedBox(height: 10),
              InfoRow(
                trip.lockedFare != null ? 'Fixed price' : 'Price',
                '${formatEtb(trip.fare)}  (${paymentLabel(trip.paymentMethod)}, pay the driver)',
                bold: true,
              ),
              const SizedBox(height: 8),
              if (trip.status.isFinal)
                FilledButton(
                  onPressed: () {
                    ref.read(activeTripProvider.notifier).clear();
                    context.go('/');
                  },
                  child: const Text('Back to map'),
                )
              else
                Row(
                  children: [
                    if (trip.status.hasDriver)
                      Expanded(
                        child: OutlinedButton(
                          onPressed: _busy ? null : () => _changeDestination(trip),
                          child: const Text('Change destination'),
                        ),
                      ),
                    if (trip.status.hasDriver && trip.status != TripStatus.inProgress)
                      const SizedBox(width: 10),
                    if (trip.status != TripStatus.inProgress)
                      Expanded(
                        child: OutlinedButton(
                          style: OutlinedButton.styleFrom(foregroundColor: HorideColors.signal),
                          onPressed: _busy ? null : () => _cancel(trip),
                          child: const Text('Cancel ride'),
                        ),
                      ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }

  static String _ago(int seconds) =>
      seconds < 120 ? '$seconds seconds' : '${seconds ~/ 60} minutes';
}

class _DriverCard extends StatelessWidget {
  const _DriverCard({required this.driver});
  final TripDriver driver;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final phone = driver.phone;
    return Row(
      children: [
        CircleAvatar(
          radius: 26,
          backgroundColor: HorideColors.navy,
          child: Text(
            (driver.name?.isNotEmpty ?? false) ? driver.name![0].toUpperCase() : '?',
            style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(driver.name ?? 'Your driver', style: theme.textTheme.titleMedium),
              Text(
                '${driver.vehicle.description}  •  ${driver.ratingCount == 0 ? 'New driver' : '${driver.rating} ★ (${driver.ratingCount})'}',
                style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: 4),
              // The plate is the passenger's check that this is the right car.
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  border: Border.all(color: theme.colorScheme.onSurface, width: 2),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  driver.vehicle.plate,
                  style: const TextStyle(fontWeight: FontWeight.w800, letterSpacing: 1.5),
                ),
              ),
            ],
          ),
        ),
        if (phone != null)
          IconButton.filledTonal(
            tooltip: 'Call driver',
            constraints: const BoxConstraints(
              minWidth: kLargeTouchTarget,
              minHeight: kLargeTouchTarget,
            ),
            onPressed: () => launchUrl(Uri(scheme: 'tel', path: phone)),
            icon: const Icon(Icons.call),
          ),
      ],
    );
  }
}

/// The driver's position. Grey and hollow when stale, so an old position never looks live.
class _DriverDot extends StatelessWidget {
  const _DriverDot({required this.live});
  final bool live;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: live ? 'Driver, live position' : 'Driver, last known position',
      child: Center(
        child: Container(
          width: 30,
          height: 30,
          decoration: BoxDecoration(
            color: live ? HorideColors.navy : Colors.white,
            shape: BoxShape.circle,
            border: Border.all(color: live ? Colors.white : HorideColors.muted, width: 4),
            boxShadow: const [BoxShadow(color: Color(0x4014283E), blurRadius: 6)],
          ),
          child: Icon(
            Icons.directions_car,
            size: 14,
            color: live ? Colors.white : HorideColors.muted,
          ),
        ),
      ),
    );
  }
}

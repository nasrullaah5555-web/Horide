import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:horide_core/horide_core.dart';
import 'package:url_launcher/url_launcher.dart';

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
              HorideButton(
                kind: HorideButtonKind.quiet,
                label: 'Keep ride',
                onPressed: () => Navigator.pop(d, false),
              ),
              HorideButton(label: 'Cancel ride', onPressed: () => Navigator.pop(d, true)),
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
                HorideButton(
                  kind: HorideButtonKind.quiet,
                  label: 'Keep old',
                  onPressed: () => Navigator.pop(d, false),
                ),
                HorideButton(label: 'Approve', onPressed: () => Navigator.pop(d, true)),
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
                      HorideButton(
                        kind: HorideButtonKind.quiet,
                        label: 'Try again',
                        onPressed: () => ref.invalidate(activeTripProvider),
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
                padding: const EdgeInsets.fromLTRB(
                  HorideSpace.xxxl,
                  HorideSpace.xxxl,
                  HorideSpace.xxxl,
                  HorideSpace.xxxl,
                ),
              ),
            ),
            children: [
              ...baseMapLayers(),
              MarkerLayer(
                markers: [
                  pinMarker(trip.pickup.point, HorideColors.sign, 'Pickup'),
                  pinMarker(trip.destination.point, HorideColors.navy, 'Destination'),
                  if (loc != null)
                    Marker(
                      point: toLatLng(loc.point),
                      width: PositionDot.size,
                      height: PositionDot.size,
                      child: PositionDot(
                        live: live,
                        icon: Icons.directions_car,
                        label: live ? 'Driver, live position' : 'Driver, last known position',
                      ),
                    ),
                ],
              ),
              mapAttribution(),
            ],
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(HorideSpace.md),
              child: Align(
                alignment: Alignment.topRight,
                child: HorideButton(
                  kind: HorideButtonKind.emergency,
                  icon: Icons.sos,
                  label: 'Emergency',
                  onPressed: () => _emergency(trip),
                ),
              ),
            ),
          ),
          Align(alignment: Alignment.bottomCenter, child: _panel(context, trip, loc, live)),
        ],
      ),
    );
  }

  Widget _panel(BuildContext context, Trip trip, DriverLocation? loc, bool live) {
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

    return HorideBottomPanel(
      children: [
        SignPanel(
          title: title,
          subtitle: subtitle,
          tone: tone,
          trailing:
              trip.status == TripStatus.searching || trip.status == TripStatus.requested
                  ? const PanelSpinner()
                  : null,
        ),
        if (driver != null && trip.status.hasDriver) ...[
          const Gap(HorideSpace.md),
          _DriverCard(driver: driver),
          const Gap(HorideSpace.sm),
          StatusText(
            loc == null
                ? 'Driver location not available yet.'
                : live
                ? 'Live location'
                : 'Location not updated for ${_ago(loc.ageSeconds)}. The driver may have a weak connection.',
            ok: live,
          ),
        ],
        const Gap(HorideSpace.md),
        InfoRow(
          trip.lockedFare != null ? 'Fixed price' : 'Price',
          '${formatEtb(trip.fare)}  (${paymentLabel(trip.paymentMethod)}, pay the driver)',
          bold: true,
        ),
        const Gap(HorideSpace.sm),
        if (trip.status.isFinal)
          HorideButton(
            label: 'Back to map',
            onPressed: () {
              ref.read(activeTripProvider.notifier).clear();
              context.go('/');
            },
          )
        else
          Row(
            children: [
              if (trip.status.hasDriver)
                Expanded(
                  child: HorideButton(
                    kind: HorideButtonKind.secondary,
                    label: 'Change destination',
                    onPressed: _busy ? null : () => _changeDestination(trip),
                  ),
                ),
              if (trip.status.hasDriver && trip.status != TripStatus.inProgress)
                const Gap(HorideSpace.md),
              if (trip.status != TripStatus.inProgress)
                Expanded(
                  child: HorideButton(
                    kind: HorideButtonKind.danger,
                    label: 'Cancel ride',
                    onPressed: _busy ? null : () => _cancel(trip),
                  ),
                ),
            ],
          ),
      ],
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
        InitialAvatar(driver.name),
        const Gap(HorideSpace.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(driver.name ?? 'Your driver', style: theme.textTheme.titleMedium),
              Text(
                '${driver.vehicle.description}  •  ${driver.ratingCount == 0 ? 'New driver' : '${driver.rating} ★ (${driver.ratingCount})'}',
                style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
              ),
              const Gap(HorideSpace.xs),
              // The plate is the passenger's check that this is the right car.
              PlateBadge(driver.vehicle.plate),
            ],
          ),
        ),
        if (phone != null)
          HorideRoundButton(
            icon: Icons.call,
            label: 'Call driver',
            onPressed: () => launchUrl(Uri(scheme: 'tel', path: phone)),
          ),
      ],
    );
  }
}

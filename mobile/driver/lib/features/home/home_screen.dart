import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:musride_core/musride_core.dart';

import '../../core/driver_api.dart';
import 'driver_controller.dart';

final overviewProvider = FutureProvider.autoDispose<DriverOverview>(
  (ref) => ref.watch(driverApiProvider).overview(),
);

/// Driver home: status, the online switch, and incoming ride requests.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  final _map = MapController();
  bool _busy = false;

  bool _mapReady = false;

  /// Moves the map to the phone's position. Only once the map is on screen: moving it earlier
  /// does nothing, which left the map on Jijiga (seen on a phone in Nairobi, 2026-11-06).
  Future<void> _centreOnMe() async {
    if (!_mapReady) return;
    final last = ref.read(locationReporterProvider).last;
    final p =
        last != null
            ? toLatLng(LatLngPoint(last.latitude, last.longitude))
            : await currentPosition();
    if (p != null && mounted) {
      _map.move(p, 15);
    }
  }

  Future<void> _toggle(bool online) async {
    setState(() => _busy = true);
    final c = ref.read(driverControllerProvider.notifier);
    await (online ? c.goOnline() : c.goOffline());
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(driverControllerProvider, (prev, next) {
      final trip = next.trip;
      if (trip != null && prev?.trip?.id != trip.id) context.go('/trip');
      if (next.offers.length > (prev?.offers.length ?? 0)) HapticFeedback.heavyImpact();
    });
    final state = ref.watch(driverControllerProvider);
    final overview = ref.watch(overviewProvider);
    final eligibility = overview.valueOrNull?.eligibility;

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            MusrideLogo(
              size: MusrideSize.iconLarge,
              onDark: Theme.of(context).brightness == Brightness.dark,
            ),
            const Gap(MusrideSpace.sm),
            const HintText('Driver'),
          ],
        ),
      ),
      body: Stack(
        children: [
          FlutterMap(
            mapController: _map,
            options: MapOptions(
              initialCenter: marketCentre,
              initialZoom: 14,
              onMapReady: () {
                _mapReady = true;
                _centreOnMe();
              },
            ),
            children: [...baseMapLayers(), const CurrentLocationLayer(), mapAttribution()],
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(MusrideSpace.md),
              child: Align(
                alignment: Alignment.topRight,
                child: MusrideRoundButton(
                  icon: Icons.my_location,
                  label: 'Show my position',
                  onPressed: _centreOnMe,
                ),
              ),
            ),
          ),
          Align(
            alignment: Alignment.bottomCenter,
            child: MusrideBottomPanel(
              children: [
                if (state.offers.isEmpty) ...[const _TodayStrip(), const Gap(MusrideSpace.md)],
                if (state.offers.isNotEmpty)
                  _OfferCard(offer: state.offers.first)
                else
                  SignPanel(
                    title: state.online ? 'Online' : 'Offline',
                    subtitle:
                        state.online
                            ? 'Waiting for ride requests'
                            : 'Go online to receive ride requests',
                    tone: state.online ? SignTone.go : SignTone.calm,
                  ),
                if (state.message != null) ...[
                  const Gap(MusrideSpace.md),
                  MusrideNotice(
                    text: state.message!,
                    onClose: ref.read(driverControllerProvider.notifier).dismissMessage,
                  ),
                ],
                if (eligibility != null && !eligibility.eligible && !state.online) ...[
                  const Gap(MusrideSpace.md),
                  MusrideNotice(
                    text: eligibility.reasons.map((r) => Eligibility.reasonText[r] ?? r).join('\n'),
                    action: MusrideButton(
                      kind: MusrideButtonKind.quiet,
                      compact: true,
                      label: 'Open',
                      onPressed: () => context.push('/onboarding'),
                    ),
                  ),
                ],
                if (state.online) ...[
                  const Gap(MusrideSpace.sm),
                  ValueListenableBuilder<bool>(
                    valueListenable: ref.watch(locationReporterProvider).connected,
                    builder:
                        (_, ok, __) => StatusText(
                          ok
                              ? 'Location is being shared.'
                              : 'Location not reaching Musride. Check your signal.',
                          ok: ok,
                        ),
                  ),
                ],
                const Gap(MusrideSpace.md),
                if (state.offers.isEmpty)
                  MusrideButton(
                    kind: state.online ? MusrideButtonKind.primary : MusrideButtonKind.go,
                    label: _busy ? 'Please wait…' : (state.online ? 'Go offline' : 'Go online'),
                    onPressed: _busy ? null : () => _toggle(!state.online),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A ride request with a visible countdown. The server decides who gets the ride: if another
/// driver accepts first, accepting here shows a short message instead.
class _OfferCard extends ConsumerStatefulWidget {
  const _OfferCard({required this.offer});
  final RideOffer offer;

  @override
  ConsumerState<_OfferCard> createState() => _OfferCardState();
}

class _OfferCardState extends ConsumerState<_OfferCard> {
  Timer? _tick;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(milliseconds: 500), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final o = widget.offer;
    final left = o.expiresAt.difference(DateTime.now()).inSeconds.clamp(0, 999);
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SignPanel(
          title: formatEtb(o.fare),
          subtitle:
              '${vehicleLabel(o.category)}  •  ${paymentLabel(o.paymentMethod)}  •  ${formatKm(o.tripDistanceMetres)} trip',
          trailing: Text(
            '${left}s',
            style: const TextStyle(
              color: MusrideColors.white,
              fontSize: MusrideFontSize.headline,
              fontWeight: MusrideFontWeight.heavy,
            ),
          ),
        ),
        const Gap(MusrideSpace.md),
        Text(
          'Pickup ${formatKm(o.distanceToPickupMetres)} away',
          style: theme.textTheme.titleMedium,
        ),
        Text(o.pickupText ?? 'Point on the map'),
        const Gap(MusrideSpace.xs),
        Text('To: ${o.destinationText ?? 'Point on the map'}'),
        const Gap(MusrideSpace.md),
        Row(
          children: [
            Expanded(
              child: MusrideButton(
                kind: MusrideButtonKind.secondary,
                label: 'Decline',
                onPressed:
                    _busy ? null : () => ref.read(driverControllerProvider.notifier).reject(o),
              ),
            ),
            const Gap(MusrideSpace.md),
            Expanded(
              flex: 2,
              child: MusrideButton(
                kind: MusrideButtonKind.go,
                label: 'Accept',
                onPressed:
                    _busy || left == 0
                        ? null
                        : () async {
                          setState(() => _busy = true);
                          await ref.read(driverControllerProvider.notifier).accept(o);
                          if (mounted) setState(() => _busy = false);
                        },
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// The driver's own position from the reporter (no extra GPS requests).
class CurrentLocationLayer extends ConsumerWidget {
  const CurrentLocationLayer({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Rebuilt by the parent often enough; the reporter keeps the last fix.
    final last = ref.watch(locationReporterProvider).last;
    if (last == null) return const SizedBox.shrink();
    return MarkerLayer(
      markers: [
        Marker(
          point: toLatLng(LatLngPoint(last.latitude, last.longitude)),
          width: PositionDot.size,
          height: PositionDot.size,
          child: const PositionDot(live: true, label: 'You'),
        ),
      ],
    );
  }
}

/// Today's completed trips and fares at a glance; tap for the full list.
class _TodayStrip extends ConsumerWidget {
  const _TodayStrip();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final history = ref.watch(driverHistoryProvider).valueOrNull;
    final today = history == null ? null : todaysEarnings(history);
    final theme = Theme.of(context);
    return Semantics(
      button: true,
      label:
          today == null
              ? 'Today\'s earnings'
              : 'Today: ${today.trips} trips, ${formatEtb(today.santim.toString())}. Open trips.',
      excludeSemantics: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(MusrideRadius.control),
        onTap: () => context.go('/history'),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: MusrideSpace.xs),
          child: Row(
            children: [
              const Icon(Icons.payments_outlined, color: MusrideColors.sign),
              const Gap(MusrideSpace.sm),
              Text('Today', style: theme.textTheme.titleMedium),
              const Spacer(),
              Text(
                today == null
                    ? '…'
                    : '${today.trips} ${today.trips == 1 ? 'trip' : 'trips'}  ·  '
                        '${formatEtbShort(today.santim.toString())}',
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: MusrideFontWeight.heavy),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}

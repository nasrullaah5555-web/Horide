import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:horide_core/horide_core.dart';

import '../../core/driver_api.dart';
import '../../core/map.dart';
import '../../core/providers.dart';
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

  @override
  void initState() {
    super.initState();
    currentPosition().then((p) {
      if (p != null && mounted) _map.move(p, 15);
    });
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
        title: const Text('Horide Driver'),
        actions: [
          IconButton(
            tooltip: 'Your trips and earnings',
            onPressed: () => context.push('/history'),
            icon: const Icon(Icons.receipt_long),
          ),
          IconButton(
            tooltip: 'Account, vehicle and documents',
            onPressed: () => context.push('/onboarding'),
            icon: const Icon(Icons.badge_outlined),
          ),
        ],
      ),
      body: Stack(
        children: [
          FlutterMap(
            mapController: _map,
            options: const MapOptions(initialCenter: jijiga, initialZoom: 14),
            children: [...baseMapLayers(), const CurrentLocationLayer(), mapAttribution()],
          ),
          Align(
            alignment: Alignment.bottomCenter,
            child: HorideBottomPanel(
                    children: [
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
                        const Gap(HorideSpace.md),
                        HorideNotice(
                          text: state.message!,
                          onClose: ref.read(driverControllerProvider.notifier).dismissMessage,
                        ),
                      ],
                      if (eligibility != null && !eligibility.eligible && !state.online) ...[
                        const Gap(HorideSpace.md),
                        HorideNotice(
                          text: eligibility.reasons
                              .map((r) => Eligibility.reasonText[r] ?? r)
                              .join('\n'),
                          action: HorideButton(kind: HorideButtonKind.quiet, label: 'Open', onPressed: () => context.push('/onboarding')),
                        ),
                      ],
                      if (state.online) ...[
                        const Gap(HorideSpace.sm),
                        ValueListenableBuilder<bool>(
                          valueListenable: ref.watch(locationReporterProvider).connected,
                          builder:
                              (_, ok, __) => StatusText(
                                ok
                                    ? 'Location is being shared.'
                                    : 'Location not reaching Horide. Check your signal.',
                                ok: ok,
                              ),
                        ),
                      ],
                      const Gap(HorideSpace.md),
                      if (state.offers.isEmpty)
                        HorideButton(kind: state.online ? HorideButtonKind.primary : HorideButtonKind.go, label: _busy ? 'Please wait…' : (state.online ? 'Go offline' : 'Go online'), onPressed: _busy ? null : () => _toggle(!state.online)),
                      HorideButton(kind: HorideButtonKind.quiet, label: 'Sign out', onPressed: () => ref.read(sessionProvider.notifier).signOut()),
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
              color: HorideColors.white,
              fontSize: HorideFontSize.headline,
              fontWeight: HorideFontWeight.heavy,
            ),
          ),
        ),
        const Gap(HorideSpace.md),
        Text(
          'Pickup ${formatKm(o.distanceToPickupMetres)} away',
          style: theme.textTheme.titleMedium,
        ),
        Text(o.pickupText ?? 'Point on the map'),
        const Gap(HorideSpace.xs),
        Text('To: ${o.destinationText ?? 'Point on the map'}'),
        const Gap(HorideSpace.md),
        Row(
          children: [
            Expanded(
              child: HorideButton(kind: HorideButtonKind.secondary, label: 'Decline', onPressed: _busy ? null : () => ref.read(driverControllerProvider.notifier).reject(o)),
            ),
            const Gap(HorideSpace.md),
            Expanded(
              flex: 2,
              child: HorideButton(kind: HorideButtonKind.go, label: 'Accept', onPressed: _busy || left == 0
                        ? null
                        : () async {
                          setState(() => _busy = true);
                          await ref.read(driverControllerProvider.notifier).accept(o);
                          if (mounted) setState(() => _busy = false);
                        }),
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

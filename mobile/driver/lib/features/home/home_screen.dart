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
            children: [
              ...baseMapLayers(),
              const CurrentLocationLayer(),
              mapAttribution(),
            ],
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
                      if (state.offers.isNotEmpty)
                        _OfferCard(offer: state.offers.first)
                      else
                        SignPanel(
                          title: state.online ? 'Online' : 'Offline',
                          subtitle: state.online
                              ? 'Waiting for ride requests'
                              : 'Go online to receive ride requests',
                          tone: state.online ? SignTone.go : SignTone.calm,
                        ),
                      if (state.message != null) ...[
                        const SizedBox(height: 10),
                        _Notice(text: state.message!, onClose: ref.read(driverControllerProvider.notifier).dismissMessage),
                      ],
                      if (eligibility != null && !eligibility.eligible && !state.online) ...[
                        const SizedBox(height: 10),
                        _Notice(
                          text: eligibility.reasons
                              .map((r) => Eligibility.reasonText[r] ?? r)
                              .join('\n'),
                          action: TextButton(
                            onPressed: () => context.push('/onboarding'),
                            child: const Text('Open'),
                          ),
                        ),
                      ],
                      if (state.online) ...[
                        const SizedBox(height: 8),
                        ValueListenableBuilder<bool>(
                          valueListenable: ref.watch(locationReporterProvider).connected,
                          builder: (_, ok, __) => Text(
                            ok ? 'Location is being shared.' : 'Location not reaching Horide. Check your signal.',
                            style: TextStyle(
                              color: ok ? HorideColors.signDeep : HorideColors.amber,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                      const SizedBox(height: 12),
                      if (state.offers.isEmpty)
                        FilledButton(
                          style: FilledButton.styleFrom(
                            backgroundColor: state.online ? HorideColors.navy : HorideColors.sign,
                          ),
                          onPressed: _busy ? null : () => _toggle(!state.online),
                          child: Text(
                            _busy ? 'Please wait…' : (state.online ? 'Go offline' : 'Go online'),
                          ),
                        ),
                      TextButton(
                        onPressed: () => ref.read(sessionProvider.notifier).signOut(),
                        child: const Text('Sign out'),
                      ),
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
          subtitle: '${vehicleLabel(o.category)}  •  ${paymentLabel(o.paymentMethod)}  •  ${formatKm(o.tripDistanceMetres)} trip',
          trailing: Text(
            '${left}s',
            style: const TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800),
          ),
        ),
        const SizedBox(height: 10),
        Text('Pickup ${formatKm(o.distanceToPickupMetres)} away', style: theme.textTheme.titleMedium),
        Text(o.pickupText ?? 'Point on the map'),
        const SizedBox(height: 4),
        Text('To: ${o.destinationText ?? 'Point on the map'}'),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: _busy ? null : () => ref.read(driverControllerProvider.notifier).reject(o),
                child: const Text('Decline'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              flex: 2,
              child: FilledButton(
                onPressed: _busy || left == 0
                    ? null
                    : () async {
                        setState(() => _busy = true);
                        await ref.read(driverControllerProvider.notifier).accept(o);
                        if (mounted) setState(() => _busy = false);
                      },
                child: const Text('Accept'),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text, this.onClose, this.action});
  final String text;
  final VoidCallback? onClose;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
      decoration: BoxDecoration(
        color: HorideColors.amber.withValues(alpha: 0.12),
        border: Border.all(color: HorideColors.amber),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Expanded(child: Text(text)),
          if (action != null) action!,
          if (onClose != null)
            IconButton(tooltip: 'Dismiss', onPressed: onClose, icon: const Icon(Icons.close)),
        ],
      ),
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
          width: 26,
          height: 26,
          child: const DecoratedBox(
            decoration: BoxDecoration(
              color: HorideColors.navy,
              shape: BoxShape.circle,
              border: Border.fromBorderSide(BorderSide(color: Colors.white, width: 4)),
            ),
          ),
        ),
      ],
    );
  }
}

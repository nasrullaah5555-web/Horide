import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:musride_core/musride_core.dart';

import '../../core/passenger_api.dart';
import '../../core/providers.dart';

/// The passenger's current trip, kept up to date from three sources:
/// 1. live socket messages (fast, but can be lost on a weak connection),
/// 2. a full reload whenever the socket reconnects,
/// 3. a slow fallback reload every 15 seconds while a trip is open.
/// The server is always the source of truth; the app never decides a trip's status itself.
class ActiveTripController extends AsyncNotifier<Trip?> {
  Timer? _poll;

  @override
  Future<Trip?> build() async {
    final rt = ref.watch(realtimeProvider);
    final subs = <StreamSubscription<dynamic>>[
      rt.events.listen(_onEvent),
      rt.onReconnected.listen((_) => refresh()),
    ];
    ref.onDispose(() {
      for (final s in subs) {
        s.cancel();
      }
      _poll?.cancel();
    });
    unawaited(rt.connect());
    final trip = await ref.read(passengerApiProvider).activeTrip();
    _schedulePoll(trip);
    return trip;
  }

  void _schedulePoll(Trip? trip) {
    _poll?.cancel();
    if (trip == null || trip.status.isFinal) return;
    _poll = Timer.periodic(const Duration(seconds: 15), (_) => refresh());
  }

  Future<void> refresh() async {
    final current = state.valueOrNull;
    // A finished trip stays on screen (payment, rating) until the passenger closes it.
    if (current != null && current.status.isFinal) return;
    try {
      // While a trip is open, reload that trip (so a just-completed trip stays visible for
      // payment and rating). Otherwise look for any open trip.
      final trip =
          current != null && !current.status.isFinal
              ? await ref.read(passengerApiProvider).trip(current.id)
              : await ref.read(passengerApiProvider).activeTrip();
      state = AsyncData(trip);
      _schedulePoll(trip);
    } on ApiException {
      // Keep showing the last known state; the banner tells the user they are offline.
    }
  }

  /// Show a trip the user just booked or changed, without waiting for the next refresh.
  void show(Trip trip) {
    state = AsyncData(trip);
    _schedulePoll(trip);
  }

  void clear() {
    _poll?.cancel();
    state = const AsyncData(null);
  }

  void _onEvent(RealtimeEvent e) {
    final current = state.valueOrNull;
    if (e.name == 'trip.updated') {
      try {
        final trip = Trip.fromJson(e.data);
        if (current == null || current.id == trip.id) show(trip);
      } on Object {
        unawaited(refresh());
      }
    } else if (e.name == 'driver.location' && current != null && e.data['tripId'] == current.id) {
      final lat = (e.data['lat'] as num).toDouble();
      final lng = (e.data['lng'] as num).toDouble();
      state = AsyncData(
        current.withDriverLocation(DriverLocation(point: LatLngPoint(lat, lng), ageSeconds: 0)),
      );
    }
  }
}

final activeTripProvider = AsyncNotifierProvider<ActiveTripController, Trip?>(
  ActiveTripController.new,
);

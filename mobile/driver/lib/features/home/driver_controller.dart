import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:horide_core/horide_core.dart';

import '../../core/driver_api.dart';
import '../../core/location_reporter.dart';
import '../../core/providers.dart';

/// What the driver's main screen shows. The server decides every part of it: eligibility,
/// online status (it refuses to put an ineligible driver online), offers and the trip.
class DriverState {
  const DriverState({
    this.online = false,
    this.offers = const [],
    this.trip,
    this.message,
  });

  final bool online;
  final List<RideOffer> offers;
  final Trip? trip;

  /// Why the last action failed, in plain words (shown on the home screen).
  final String? message;

  DriverState copyWith({
    bool? online,
    List<RideOffer>? offers,
    Trip? trip,
    bool clearTrip = false,
    String? message,
    bool clearMessage = false,
  }) =>
      DriverState(
        online: online ?? this.online,
        offers: offers ?? this.offers,
        trip: clearTrip ? null : (trip ?? this.trip),
        message: clearMessage ? null : (message ?? this.message),
      );
}

final locationReporterProvider = Provider<LocationReporter>((ref) {
  final api = ref.watch(driverApiProvider);
  final r = LocationReporter(send: api.sendLocations);
  ref.onDispose(r.dispose);
  return r;
});

class DriverController extends Notifier<DriverState> {
  Timer? _poll;

  DriverApi get _api => ref.read(driverApiProvider);
  LocationReporter get _reporter => ref.read(locationReporterProvider);

  @override
  DriverState build() {
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
    // The app always starts offline (location isn't being sent yet), so tell the server too,
    // then pick up any trip that was open when the app closed.
    Future.microtask(() async {
      try {
        await _api.goOffline();
      } on ApiException {
        // Offline or signed out; refresh below copes.
      }
      await refresh();
    });
    return const DriverState();
  }

  /// Reload the trip and offers from the server (the source of truth).
  Future<void> refresh() async {
    try {
      final current = state.trip;
      // A finished trip stays until the driver closes it (payment recording, rating).
      final keepFinished = current != null && current.status.isFinal;
      final trip = keepFinished ? current : await _api.activeTrip();
      final offers = state.online && trip == null ? await _api.offers() : const <RideOffer>[];
      state = state.copyWith(trip: trip, clearTrip: trip == null, offers: offers);
      _syncReporter();
    } on ApiException {
      // Keep the last known state; the connection banner explains why.
    }
  }

  Future<void> goOnline() async {
    final problem = await LocationReporter.ensurePermission();
    if (problem != null) {
      state = state.copyWith(message: problem);
      return;
    }
    try {
      final fix = await LocationReporter.currentFix();
      await _api.goOnline(LocationReporter.toPoint(fix));
      state = state.copyWith(online: true, clearMessage: true);
      _syncReporter();
      _poll?.cancel();
      _poll = Timer.periodic(const Duration(seconds: 8), (_) => refresh());
      await refresh();
    } on ApiException catch (e) {
      final reasons = (e.details is Map ? (e.details! as Map)['reasons'] : null) as List<dynamic>?;
      final text = reasons == null || reasons.isEmpty
          ? e.message
          : reasons.map((r) => Eligibility.reasonText[r] ?? r.toString()).join('\n');
      state = state.copyWith(message: text);
    } on Object {
      state = state.copyWith(message: 'Could not get a GPS position. Move to an open area and try again.');
    }
  }

  Future<void> goOffline() async {
    _poll?.cancel();
    try {
      await _api.goOffline();
    } on ApiException catch (e) {
      state = state.copyWith(message: e.message);
      return;
    }
    state = state.copyWith(online: false, offers: const [], clearMessage: true);
    _syncReporter();
  }

  Future<void> accept(RideOffer offer) async {
    try {
      final trip = await _api.accept(offer.tripId);
      state = state.copyWith(trip: trip, offers: const [], clearMessage: true);
      _syncReporter();
    } on ApiException catch (e) {
      // Usually: another driver accepted first, or the offer expired.
      state = state.copyWith(
        message: e.message,
        offers: state.offers.where((o) => o.tripId != offer.tripId).toList(),
      );
    }
  }

  Future<void> reject(RideOffer offer) async {
    state = state.copyWith(offers: state.offers.where((o) => o.tripId != offer.tripId).toList());
    try {
      await _api.reject(offer.tripId);
    } on ApiException {
      // The offer expires on its own; nothing else to do.
    }
  }

  void showTrip(Trip trip) {
    state = state.copyWith(trip: trip);
    _syncReporter();
  }

  void closeTrip() {
    state = state.copyWith(clearTrip: true);
    _syncReporter();
    unawaited(refresh());
  }

  void dismissMessage() => state = state.copyWith(clearMessage: true);

  /// Location is sent while online, and always during a trip (even if the driver went offline:
  /// an active trip is never interrupted).
  void _syncReporter() {
    final trip = state.trip;
    final onTrip = trip != null && !trip.status.isFinal;
    if (onTrip || state.online) {
      _reporter.start(onTrip: onTrip);
    } else {
      _reporter.stop();
    }
  }

  void _onEvent(RealtimeEvent e) {
    switch (e.name) {
      case 'offer.created' || 'offer.closed':
        unawaited(refresh());
      case 'trip.updated':
        try {
          final trip = Trip.fromJson(e.data);
          final current = state.trip;
          if (current == null || current.id == trip.id) showTrip(trip);
        } on Object {
          unawaited(refresh());
        }
    }
  }
}

final driverControllerProvider =
    NotifierProvider<DriverController, DriverState>(DriverController.new);

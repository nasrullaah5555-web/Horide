import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

/// Sends the driver's position to Horide while online.
///
/// Battery and data: on a trip the phone reports every 5 seconds (the passenger is watching);
/// when waiting for rides, every 15 seconds and only after moving 20 metres. Points are buffered
/// while there is no signal and sent together (the server accepts up to 20 at once and keeps only
/// plausible, fresh points as the live position, so an old buffered point never shows as live).
class LocationReporter {
  LocationReporter({required this.send});

  final Future<void> Function(List<Map<String, dynamic>> points) send;

  static const maxBuffer = 20;

  StreamSubscription<Position>? _sub;
  Timer? _flush;
  final _buffer = <Map<String, dynamic>>[];
  bool _onTrip = false;
  bool _sending = false;
  Position? last;

  /// Whether the last attempt to send reached the server. Shown to the driver.
  final ValueNotifier<bool> connected = ValueNotifier(true);

  bool get running => _sub != null;

  /// Asks for permission if needed. Returns a message for the driver when location can't be used.
  static Future<String?> ensurePermission() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return 'Turn on location (GPS) on your phone to go online.';
    }
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
    if (p == LocationPermission.denied) return 'Horide Driver needs your location to go online.';
    if (p == LocationPermission.deniedForever) {
      return 'Location is blocked for Horide Driver. Allow it in your phone settings.';
    }
    return null;
  }

  static Future<Position> currentFix() => Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );

  static Map<String, dynamic> toPoint(Position p) => {
        'lat': p.latitude,
        'lng': p.longitude,
        // The phone's GPS time; the server rejects points too far in the future or the past.
        'recordedAt': p.timestamp.toUtc().toIso8601String(),
        if (p.accuracy > 0) 'accuracyM': p.accuracy,
        if (p.heading >= 0 && p.heading <= 360) 'heading': p.heading,
        if (p.speed >= 0) 'speedKmh': p.speed * 3.6,
      };

  void start({required bool onTrip}) {
    if (running && onTrip == _onTrip) return;
    _onTrip = onTrip;
    _sub?.cancel();
    _flush?.cancel();
    _sub = Geolocator.getPositionStream(locationSettings: _settings(onTrip)).listen(
      (p) {
        last = p;
        _buffer.add(toPoint(p));
        if (_buffer.length > maxBuffer) _buffer.removeAt(0); // oldest points matter least
      },
      onError: (Object _) => connected.value = false,
    );
    _flush = Timer.periodic(Duration(seconds: onTrip ? 5 : 15), (_) => _send());
  }

  void stop() {
    _sub?.cancel();
    _sub = null;
    _flush?.cancel();
    _flush = null;
    _buffer.clear();
  }

  Future<void> _send() async {
    if (_sending || _buffer.isEmpty) return;
    _sending = true;
    final batch = List<Map<String, dynamic>>.of(_buffer);
    try {
      await send(batch);
      _buffer.removeRange(0, batch.length.clamp(0, _buffer.length));
      connected.value = true;
    } on Object {
      connected.value = false; // keep the points and try again on the next tick
    } finally {
      _sending = false;
    }
  }

  LocationSettings _settings(bool onTrip) {
    final distance = onTrip ? 5 : 20;
    final interval = Duration(seconds: onTrip ? 4 : 10);
    if (defaultTargetPlatform == TargetPlatform.android) {
      return AndroidSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: distance,
        intervalDuration: interval,
        // A visible notification keeps location working while the screen is off, and tells
        // the driver Horide is using their location.
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'Horide Driver is online',
          notificationText: 'Sharing your location so passengers can be matched to you.',
          enableWakeLock: false,
        ),
      );
    }
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      return AppleSettings(
        accuracy: LocationAccuracy.best,
        distanceFilter: distance,
        activityType: ActivityType.automotiveNavigation,
        pauseLocationUpdatesAutomatically: false,
      );
    }
    return LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: distance);
  }

  void dispose() {
    stop();
    connected.dispose();
  }
}

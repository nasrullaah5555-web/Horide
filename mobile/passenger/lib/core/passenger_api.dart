import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:musride_core/musride_core.dart';

import 'providers.dart';

class DestinationProposal {
  const DestinationProposal({
    required this.changeId,
    required this.currentFare,
    required this.newFare,
    required this.distanceMetres,
    required this.expiresAt,
  });
  final String changeId;
  final String? currentFare;
  final String newFare;
  final int distanceMetres;
  final DateTime expiresAt;
}

class Receipt {
  const Receipt(this.data);
  final Map<String, dynamic> data;

  String? get pickupText => data['pickup_text'] as String?;
  String? get destinationText => data['destination_text'] as String?;
  String? get finalFare => data['final_fare'] as String?;
  String get method => data['method'] as String;
  String get paymentStatus => data['payment_status'] as String;
  String? get ebirrReference => data['ebirr_reference'] as String?;
  String? get driverName => data['driver_name'] as String?;
  String? get plate => data['plate_number'] as String?;
  int get distanceMetres => (data['route_distance_m'] as num).toInt();
  DateTime? get completedAt =>
      data['completed_at'] == null ? null : DateTime.parse(data['completed_at'] as String);
  String get note => data['note'] as String;
}

class TripSummary {
  const TripSummary(this.data);
  final Map<String, dynamic> data;

  String get id => data['id'] as String;
  TripStatus get status => TripStatus.parse(data['status'] as String);
  String? get pickupText => data['pickup_text'] as String?;
  String? get destinationText => data['destination_text'] as String?;
  String get fare => (data['final_fare'] ?? data['locked_fare'] ?? data['quoted_fare']) as String;
  DateTime get requestedAt => DateTime.parse(data['requested_at'] as String);
}

/// A place the passenger saved, such as "Home" or "Work". Most Jijiga addresses are landmarks,
/// so saving the exact pin saves explaining it again.
class SavedPlace {
  const SavedPlace({required this.id, required this.label, required this.point, this.addressText});
  final String id;
  final String label;
  final LatLngPoint point;
  final String? addressText;

  static SavedPlace fromJson(Map<String, dynamic> j) => SavedPlace(
    id: j['id'] as String,
    label: j['label'] as String,
    point: LatLngPoint((j['lat'] as num).toDouble(), (j['lng'] as num).toDouble()),
    addressText: j['address_text'] as String?,
  );
}

/// Every passenger endpoint, in one place.
class PassengerApi {
  PassengerApi(this._c);
  final ApiClient _c;

  Future<List<Quote>> quotes({
    required LatLngPoint pickup,
    required LatLngPoint destination,
    String? pickupText,
    String? destinationText,
    required PaymentMethod paymentMethod,
  }) async {
    final data = await _c.post('/quotes', {
      'pickup': pickup.toJson(),
      'destination': destination.toJson(),
      if (pickupText != null && pickupText.isNotEmpty) 'pickupText': pickupText,
      if (destinationText != null && destinationText.isNotEmpty) 'destinationText': destinationText,
      'categories': ['car', 'bajaj'],
      'paymentMethod': paymentMethod.name,
    });
    return (data['quotes'] as List<dynamic>)
        .map((q) => Quote.fromJson(q as Map<String, dynamic>))
        .toList();
  }

  /// Safe to retry with the same quote: the server returns the same trip.
  Future<Trip> book(String quoteToken) async =>
      Trip.fromJson(await _c.post('/trips', {'quoteToken': quoteToken}));

  Future<Trip?> activeTrip() async {
    final data = await _c.get('/trips/active');
    final trip = data['trip'];
    return trip == null ? null : Trip.fromJson(trip as Map<String, dynamic>);
  }

  Future<Trip> trip(String id) async => Trip.fromJson(await _c.get('/trips/$id'));

  /// A link family can open to follow this trip; it stops working when the trip ends.
  Future<String> shareLink(String id) async => (await _c.post('/trips/$id/share'))['url'] as String;

  /// Small approved photos of the driver and the car, once a driver has accepted (ADR-027).
  Future<TripPhotos> photos(String id) async =>
      TripPhotos.fromJson(await _c.get('/trips/$id/photos'));

  Future<Trip> cancel(String id, {String? reason}) async =>
      Trip.fromJson(await _c.post('/trips/$id/cancel', {if (reason != null) 'reason': reason}));

  Future<DestinationProposal> proposeDestination(
    String id,
    LatLngPoint destination,
    String? text,
  ) async {
    final d = await _c.post('/trips/$id/destination-change', {
      'destination': destination.toJson(),
      if (text != null && text.isNotEmpty) 'destinationText': text,
    });
    return DestinationProposal(
      changeId: d['changeId'] as String,
      currentFare: d['currentFare'] as String?,
      newFare: d['newFare'] as String,
      distanceMetres: (d['distanceMetres'] as num).toInt(),
      expiresAt: DateTime.parse(d['expiresAt'] as String),
    );
  }

  Future<Trip> decideDestination(String id, String changeId, {required bool approve}) async =>
      Trip.fromJson(
        await _c.post('/trips/$id/destination-change/$changeId/${approve ? 'approve' : 'reject'}'),
      );

  Future<Receipt> confirmPayment(String id) async =>
      Receipt(await _c.post('/trips/$id/payment/confirm'));

  Future<Receipt> disputePayment(String id, String note) async =>
      Receipt(await _c.post('/trips/$id/payment/dispute', {'note': note}));

  Future<Receipt> receipt(String id) async => Receipt(await _c.get('/trips/$id/receipt'));

  Future<void> rate(String id, int stars, String? comment, {Set<String> compliments = const {}}) =>
      _c.post('/trips/$id/rating', {
        'stars': stars,
        if (comment != null && comment.isNotEmpty) 'comment': comment,
        if (stars >= 4 && compliments.isNotEmpty) 'compliments': compliments.toList(),
      });

  Future<List<TripSummary>> history({DateTime? before}) async {
    final q = before == null ? '' : '?before=${Uri.encodeQueryComponent(before.toIso8601String())}';
    final d = await _c.get('/trips$q');
    return (d['trips'] as List<dynamic>)
        .map((t) => TripSummary(t as Map<String, dynamic>))
        .toList();
  }

  Future<void> complain({String? tripId, required String category, required String description}) =>
      _c.post('/complaints', {
        if (tripId != null) 'tripId': tripId,
        'category': category,
        'description': description,
      });

  Future<void> emergency({String? tripId, LatLngPoint? position}) => _c.post('/emergency', {
    if (tripId != null) 'tripId': tripId,
    if (position != null) 'position': position.toJson(),
  });

  Future<List<SavedPlace>> savedPlaces() async {
    final d = await _c.get('/passenger/saved-locations');
    return (d['locations'] as List<dynamic>)
        .map((l) => SavedPlace.fromJson(l as Map<String, dynamic>))
        .toList();
  }

  Future<void> savePlace(String label, LatLngPoint point, String? addressText) =>
      _c.post('/passenger/saved-locations', {
        'label': label,
        'position': point.toJson(),
        if (addressText != null && addressText.isNotEmpty) 'addressText': addressText,
      });

  Future<void> deleteSavedPlace(String id) => _c.delete('/passenger/saved-locations/$id');

  Future<Map<String, dynamic>> profile() => _c.get('/passenger/profile');

  /// [emergencyContactPhone] is always sent: null removes the contact.
  Future<Map<String, dynamic>> updateProfile({
    String? fullName,
    required String? emergencyContactPhone,
  }) => _c.patch('/passenger/profile', {
    if (fullName != null) 'fullName': fullName,
    'emergencyContactPhone': emergencyContactPhone,
  });
}

final passengerApiProvider = Provider<PassengerApi>(
  (ref) => PassengerApi(ref.watch(apiClientProvider)),
);

final savedPlacesProvider = FutureProvider.autoDispose<List<SavedPlace>>(
  (ref) => ref.watch(passengerApiProvider).savedPlaces(),
);

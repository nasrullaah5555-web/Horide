import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:musride_core/musride_core.dart';

import 'providers.dart';

/// Documents the driver is asked for, in display order. Insurance and permits are optional until
/// the Jijiga legal requirements are confirmed (OWNER_ACTION_REGISTER OA-16).
const documentLabels = <String, String>{
  'profile_photo': 'Profile photo',
  'national_id': 'National ID',
  'driving_licence': 'Driving licence',
  'vehicle_registration': 'Vehicle registration',
  'insurance': 'Insurance (if you have it)',
  'permit': 'Transport permit (if you have it)',
};
const vehicleDocuments = {'vehicle_registration', 'insurance'};

class DriverVehicle {
  const DriverVehicle(this.data);
  final Map<String, dynamic> data;
  String get id => data['id'] as String;
  VehicleCategory get category => VehicleCategory.values.byName(data['category'] as String);
  String get plate => data['plate_number'] as String;
  String get approvalStatus => data['approval_status'] as String;
  String? get rejectionReason => data['rejection_reason'] as String?;
  bool get isActive => data['is_active'] as bool;
  String get description => '${data['colour']} ${data['make']} ${data['model']}';
}

class DriverDocument {
  const DriverDocument(this.data);
  final Map<String, dynamic> data;
  String get type => data['type'] as String;
  String get status => data['status'] as String;
  String? get rejectionReason => data['rejection_reason'] as String?;
}

class DriverOverview {
  DriverOverview(Map<String, dynamic> j)
    : profile = j['profile'] as Map<String, dynamic>,
      vehicles =
          (j['vehicles'] as List<dynamic>)
              .map((v) => DriverVehicle(v as Map<String, dynamic>))
              .toList(),
      documents =
          (j['documents'] as List<dynamic>)
              .map((d) => DriverDocument(d as Map<String, dynamic>))
              .toList(),
      compliments = [
        for (final c in (j['compliments'] as List<dynamic>? ?? const []))
          (tag: (c as Map<String, dynamic>)['tag'] as String, count: (c['count'] as num).toInt()),
      ],
      eligibility = Eligibility.fromJson(j['eligibility'] as Map<String, dynamic>);

  final Map<String, dynamic> profile;
  final List<DriverVehicle> vehicles;
  final List<DriverDocument> documents;
  final Eligibility eligibility;

  /// How often passengers gave each compliment, most given first.
  final List<({String tag, int count})> compliments;

  String? get fullName => profile['full_name'] as String?;
  String get approvalStatus => profile['approval_status'] as String;
  String? get suspendedReason => profile['suspended_reason'] as String?;

  DriverVehicle? get vehicle =>
      vehicles.where((v) => v.isActive && v.approvalStatus != 'rejected').firstOrNull;

  /// The newest upload of each type decides its status.
  DriverDocument? latest(String type) => documents.where((d) => d.type == type).firstOrNull;
}

class Subscription {
  const Subscription(this.data);
  final Map<String, dynamic> data;
  String get planName => data['plan_name'] as String;
  String get price => data['price'].toString();
  DateTime get endsAt => DateTime.parse(data['ends_at'] as String);
  DateTime get startsAt => DateTime.parse(data['starts_at'] as String);
  String get status => data['status'] as String;
}

class DriverTripSummary {
  const DriverTripSummary(this.data);
  final Map<String, dynamic> data;
  String get id => data['id'] as String;
  TripStatus get status => TripStatus.parse(data['status'] as String);
  String? get pickupText => data['pickup_text'] as String?;
  String? get destinationText => data['destination_text'] as String?;
  String? get finalFare => data['final_fare'] as String?;
  String get fare => (data['final_fare'] ?? data['locked_fare'] ?? data['quoted_fare']) as String;
  DateTime get requestedAt => DateTime.parse(data['requested_at'] as String);
}

/// Every driver endpoint, in one place.
class DriverApi {
  DriverApi(this._c);
  final ApiClient _c;

  Future<DriverOverview> overview() async => DriverOverview(await _c.get('/driver/profile'));

  Future<void> setName(String fullName) => _c.patch('/driver/profile', {'fullName': fullName});

  Future<void> addVehicle({
    required VehicleCategory category,
    required String make,
    required String model,
    required String colour,
    int? year,
    required String plateNumber,
  }) => _c.post('/driver/vehicles', {
    'category': category.name,
    'make': make,
    'model': model,
    'colour': colour,
    if (year != null) 'year': year,
    'plateNumber': plateNumber,
  });

  Future<void> uploadDocument({
    required String type,
    String? vehicleId,
    required List<int> bytes,
    required String filename,
  }) => _c.upload(
    '/driver/documents',
    fields: {'type': type, if (vehicleId != null) 'vehicleId': vehicleId},
    fileField: 'file',
    bytes: bytes,
    filename: filename,
  );

  Future<Eligibility> eligibility() async =>
      Eligibility.fromJson(await _c.get('/driver/eligibility'));

  Future<(Subscription?, List<Subscription>)> subscriptions() async {
    final d = await _c.get('/driver/subscriptions');
    final active = d['active'];
    return (
      active == null ? null : Subscription(active as Map<String, dynamic>),
      (d['history'] as List<dynamic>).map((s) => Subscription(s as Map<String, dynamic>)).toList(),
    );
  }

  Future<void> goOnline(Map<String, dynamic> position) =>
      _c.post('/driver/availability', {'online': true, 'position': position});

  Future<void> goOffline() => _c.post('/driver/availability', {'online': false});

  Future<void> sendLocations(List<Map<String, dynamic>> points) =>
      _c.post('/driver/location', {'points': points});

  Future<List<RideOffer>> offers() async {
    final d = await _c.get('/driver/offers');
    return (d['offers'] as List<dynamic>)
        .map((o) => RideOffer.fromJson(o as Map<String, dynamic>))
        .toList();
  }

  Future<Trip> accept(String tripId) async => Trip.fromJson(await _c.post('/trips/$tripId/accept'));

  Future<void> reject(String tripId) => _c.post('/trips/$tripId/reject');

  Future<Trip?> activeTrip() async {
    final d = await _c.get('/trips/active');
    final t = d['trip'];
    return t == null ? null : Trip.fromJson(t as Map<String, dynamic>);
  }

  Future<Trip> trip(String id) async => Trip.fromJson(await _c.get('/trips/$id'));

  /// [step] is one of arriving, arrived, start, complete.
  Future<Trip> step(String tripId, String step) async =>
      Trip.fromJson(await _c.post('/trips/$tripId/$step'));

  /// Starting needs the passenger's 4-digit ride PIN.
  Future<Trip> start(String tripId, String pin) async =>
      Trip.fromJson(await _c.post('/trips/$tripId/start', {'pin': pin}));

  Future<Trip> cancel(String tripId, String reason) async =>
      Trip.fromJson(await _c.post('/trips/$tripId/cancel', {'reason': reason}));

  Future<Map<String, dynamic>> recordPayment(
    String tripId, {
    required PaymentMethod method,
    String? reference,
  }) => _c.post('/trips/$tripId/payment/received', {
    'method': method.name,
    if (reference != null && reference.isNotEmpty) 'reference': reference,
  });

  Future<Map<String, dynamic>> receipt(String tripId) => _c.get('/trips/$tripId/receipt');

  Future<Map<String, dynamic>> disputePayment(String tripId, String note) =>
      _c.post('/trips/$tripId/payment/dispute', {'note': note});

  Future<void> ratePassenger(String tripId, int stars) =>
      _c.post('/trips/$tripId/rating', {'stars': stars});

  Future<List<DriverTripSummary>> history() async {
    final d = await _c.get('/trips');
    return (d['trips'] as List<dynamic>)
        .map((t) => DriverTripSummary(t as Map<String, dynamic>))
        .toList();
  }

  Future<void> emergency({String? tripId, LatLngPoint? position}) => _c.post('/emergency', {
    if (tripId != null) 'tripId': tripId,
    if (position != null) 'position': position.toJson(),
  });

  Future<void> complain({String? tripId, required String category, required String description}) =>
      _c.post('/complaints', {
        if (tripId != null) 'tripId': tripId,
        'category': category,
        'description': description,
      });
}

final driverApiProvider = Provider<DriverApi>((ref) => DriverApi(ref.watch(apiClientProvider)));

/// The driver's recent trips (Trips tab, and today's total on the Drive tab).
final driverHistoryProvider = FutureProvider.autoDispose<List<DriverTripSummary>>(
  (ref) => ref.watch(driverApiProvider).history(),
);

/// Completed trips since midnight (phone time) and what passengers paid for them, in santim.
({int trips, BigInt santim}) todaysEarnings(List<DriverTripSummary> trips, {DateTime? now}) {
  final n = now ?? DateTime.now();
  final midnight = DateTime(n.year, n.month, n.day);
  final done = trips.where(
    (t) => t.status == TripStatus.completed && !t.requestedAt.toLocal().isBefore(midnight),
  );
  return (
    trips: done.length,
    santim: done.fold(BigInt.zero, (sum, t) => sum + BigInt.parse(t.finalFare ?? '0')),
  );
}

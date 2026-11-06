/// Data from the API, parsed by hand so every field is checked against the backend's JSON.
/// Money stays as santim strings (see money.dart).
library;

enum VehicleCategory { car, bajaj }

enum PaymentMethod { cash, ebirr }

enum TripStatus {
  requested,
  searching,
  accepted,
  driverArriving,
  arrived,
  inProgress,
  completed,
  cancelled,
  expired;

  static TripStatus parse(String value) => switch (value) {
    'requested' => requested,
    'searching' => searching,
    'accepted' => accepted,
    'driver_arriving' => driverArriving,
    'arrived' => arrived,
    'in_progress' => inProgress,
    'completed' => completed,
    'cancelled' => cancelled,
    'expired' => expired,
    _ => throw FormatException('Unknown trip status: $value'),
  };

  bool get isFinal => this == completed || this == cancelled || this == expired;
  bool get hasDriver =>
      this == accepted || this == driverArriving || this == arrived || this == inProgress;
}

String vehicleLabel(VehicleCategory c) => c == VehicleCategory.car ? 'Car' : 'Bajaj';
String paymentLabel(PaymentMethod m) => m == PaymentMethod.cash ? 'Cash' : 'eBirr';

class LatLngPoint {
  const LatLngPoint(this.lat, this.lng);
  final double lat;
  final double lng;

  Map<String, double> toJson() => {'lat': lat, 'lng': lng};

  static LatLngPoint fromJson(Map<String, dynamic> j) =>
      LatLngPoint((j['lat'] as num).toDouble(), (j['lng'] as num).toDouble());
}

class Place {
  const Place(this.point, this.text);
  final LatLngPoint point;
  final String? text;

  static Place fromJson(Map<String, dynamic> j) =>
      Place(LatLngPoint.fromJson(j), j['text'] as String?);
}

/// A server price for one vehicle type. [quoteToken] is signed by the server and is sent back
/// unchanged to book; the app never computes or edits fares.
class Quote {
  const Quote({
    required this.category,
    required this.fare,
    required this.distanceMetres,
    required this.durationSeconds,
    required this.isEstimate,
    required this.expiresAt,
    required this.quoteToken,
  });

  final VehicleCategory category;
  final String fare;
  final int distanceMetres;
  final int durationSeconds;
  final bool isEstimate;
  final DateTime expiresAt;
  final String quoteToken;

  static Quote fromJson(Map<String, dynamic> j) => Quote(
    category: VehicleCategory.values.byName(j['category'] as String),
    fare: j['fare'] as String,
    distanceMetres: (j['distanceMetres'] as num).toInt(),
    durationSeconds: (j['durationSeconds'] as num).toInt(),
    isEstimate: j['isEstimate'] as bool,
    expiresAt: DateTime.parse(j['expiresAt'] as String),
    quoteToken: j['quoteToken'] as String,
  );
}

/// The driver's last known position. Age is counted on the phone from when the server said the
/// position was taken (using the server-reported age avoids errors from a wrong phone clock),
/// so a position that stops updating turns stale on screen by itself.
class DriverLocation {
  DriverLocation({required this.point, required int ageSeconds, this.heading, DateTime? now})
    : observedAt = (now ?? DateTime.now()).subtract(Duration(seconds: ageSeconds));

  /// Positions older than this are never presented as live (master prompt §9).
  static const liveThreshold = Duration(seconds: 30);

  final LatLngPoint point;
  final DateTime observedAt;
  final int? heading;

  Duration ageAt(DateTime now) => now.difference(observedAt);
  bool isLiveAt(DateTime now) => ageAt(now) <= liveThreshold;
  bool get isLive => isLiveAt(DateTime.now());
  int get ageSeconds => ageAt(DateTime.now()).inSeconds;

  static DriverLocation fromJson(Map<String, dynamic> j, {DateTime? now}) => DriverLocation(
    point: LatLngPoint.fromJson(j),
    ageSeconds: (j['ageSeconds'] as num).toInt(),
    heading: (j['heading'] as num?)?.toInt(),
    now: now,
  );
}

class TripDriver {
  const TripDriver({
    required this.name,
    required this.rating,
    required this.ratingCount,
    required this.phone,
    required this.vehicle,
  });
  final String? name;
  final String rating;
  final int ratingCount;
  final String? phone;
  final TripVehicle vehicle;

  static TripDriver fromJson(Map<String, dynamic> j) => TripDriver(
    name: j['name'] as String?,
    rating: j['rating'].toString(),
    ratingCount: (j['ratingCount'] as num).toInt(),
    phone: j['phone'] as String?,
    vehicle: TripVehicle.fromJson(j['vehicle'] as Map<String, dynamic>),
  );
}

class TripVehicle {
  const TripVehicle({
    required this.make,
    required this.model,
    required this.colour,
    required this.plate,
    required this.category,
  });
  final String make;
  final String model;
  final String colour;
  final String plate;
  final VehicleCategory category;

  String get description => '$colour $make $model';

  static TripVehicle fromJson(Map<String, dynamic> j) => TripVehicle(
    make: j['make'] as String,
    model: j['model'] as String,
    colour: j['colour'] as String,
    plate: j['plate'] as String,
    category: VehicleCategory.values.byName(j['category'] as String),
  );
}

class TripPassenger {
  const TripPassenger({this.name, this.phone});
  final String? name;
  final String? phone;

  static TripPassenger fromJson(Map<String, dynamic> j) =>
      TripPassenger(name: j['name'] as String?, phone: j['phone'] as String?);
}

/// A trip as the API shows it to the current user (GET /trips/:id, GET /trips/active, socket).
class Trip {
  const Trip({
    required this.id,
    required this.status,
    required this.category,
    required this.pickup,
    required this.destination,
    required this.distanceMetres,
    required this.durationSeconds,
    required this.isEstimate,
    required this.quotedFare,
    required this.lockedFare,
    required this.finalFare,
    required this.paymentMethod,
    required this.requestedAt,
    this.cancelledBy,
    this.driver,
    this.driverLocation,
    this.passenger,
    this.startPin,
  });

  final String id;
  final TripStatus status;
  final VehicleCategory category;
  final Place pickup;
  final Place destination;
  final int distanceMetres;
  final int durationSeconds;
  final bool isEstimate;
  final String quotedFare;
  final String? lockedFare;
  final String? finalFare;
  final PaymentMethod paymentMethod;
  final DateTime requestedAt;
  final String? cancelledBy;
  final TripDriver? driver;
  final DriverLocation? driverLocation;
  final TripPassenger? passenger;

  /// The 4-digit ride PIN. Only the passenger receives it, and only until the trip starts; the
  /// driver must hear it from the passenger to start the trip.
  final String? startPin;

  /// The same trip with a newer driver position (from the live location stream).
  Trip withDriverLocation(DriverLocation location) => Trip(
    id: id,
    status: status,
    category: category,
    pickup: pickup,
    destination: destination,
    distanceMetres: distanceMetres,
    durationSeconds: durationSeconds,
    isEstimate: isEstimate,
    quotedFare: quotedFare,
    lockedFare: lockedFare,
    finalFare: finalFare,
    paymentMethod: paymentMethod,
    requestedAt: requestedAt,
    cancelledBy: cancelledBy,
    driver: driver,
    passenger: passenger,
    startPin: startPin,
    driverLocation: location,
  );

  /// The fare that applies right now: final, else locked at acceptance, else the quote.
  String get fare => finalFare ?? lockedFare ?? quotedFare;

  static Trip fromJson(Map<String, dynamic> j) {
    final route = j['route'] as Map<String, dynamic>;
    final fare = j['fare'] as Map<String, dynamic>;
    final times = j['times'] as Map<String, dynamic>;
    return Trip(
      id: j['id'] as String,
      status: TripStatus.parse(j['status'] as String),
      category: VehicleCategory.values.byName(j['category'] as String),
      pickup: Place.fromJson(j['pickup'] as Map<String, dynamic>),
      destination: Place.fromJson(j['destination'] as Map<String, dynamic>),
      distanceMetres: (route['distanceMetres'] as num).toInt(),
      durationSeconds: (route['durationSeconds'] as num).toInt(),
      isEstimate: route['isEstimate'] as bool,
      quotedFare: fare['quoted'] as String,
      lockedFare: fare['locked'] as String?,
      finalFare: fare['final'] as String?,
      paymentMethod: PaymentMethod.values.byName(j['paymentMethod'] as String),
      requestedAt: DateTime.parse(times['requestedAt'] as String),
      cancelledBy: j['cancelledBy'] as String?,
      driver: j['driver'] == null ? null : TripDriver.fromJson(j['driver'] as Map<String, dynamic>),
      driverLocation:
          j['driverLocation'] == null
              ? null
              : DriverLocation.fromJson(j['driverLocation'] as Map<String, dynamic>),
      passenger:
          j['passenger'] == null
              ? null
              : TripPassenger.fromJson(j['passenger'] as Map<String, dynamic>),
      startPin: j['startPin'] as String?,
    );
  }
}

/// A ride request offered to a driver (GET /driver/offers).
class RideOffer {
  const RideOffer({
    required this.tripId,
    required this.expiresAt,
    required this.distanceToPickupMetres,
    required this.category,
    required this.pickup,
    required this.pickupText,
    required this.destinationText,
    required this.tripDistanceMetres,
    required this.fare,
    required this.paymentMethod,
  });

  final String tripId;
  final DateTime expiresAt;
  final int distanceToPickupMetres;
  final VehicleCategory category;
  final LatLngPoint pickup;
  final String? pickupText;
  final String? destinationText;
  final int tripDistanceMetres;
  final String fare;
  final PaymentMethod paymentMethod;

  static RideOffer fromJson(Map<String, dynamic> j) => RideOffer(
    tripId: j['trip_id'] as String,
    expiresAt: DateTime.parse(j['expires_at'] as String),
    distanceToPickupMetres: (j['distance_to_pickup_m'] as num).toInt(),
    category: VehicleCategory.values.byName(j['category'] as String),
    pickup: LatLngPoint((j['pickup_lat'] as num).toDouble(), (j['pickup_lng'] as num).toDouble()),
    pickupText: j['pickup_text'] as String?,
    destinationText: j['destination_text'] as String?,
    tripDistanceMetres: (j['route_distance_m'] as num).toInt(),
    fare: j['quoted_fare'] as String,
    paymentMethod: PaymentMethod.values.byName(j['payment_method'] as String),
  );
}

/// Why a driver can or can't receive rides (GET /driver/eligibility).
class Eligibility {
  const Eligibility({
    required this.eligible,
    required this.reasons,
    required this.missingDocuments,
    this.subscriptionEndsAt,
  });
  final bool eligible;
  final List<String> reasons;
  final List<String> missingDocuments;
  final DateTime? subscriptionEndsAt;

  static Eligibility fromJson(Map<String, dynamic> j) => Eligibility(
    eligible: j['eligible'] as bool,
    reasons: (j['reasons'] as List<dynamic>).cast<String>(),
    missingDocuments: (j['missingDocuments'] as List<dynamic>).cast<String>(),
    subscriptionEndsAt:
        j['subscriptionEndsAt'] == null ? null : DateTime.parse(j['subscriptionEndsAt'] as String),
  );

  static const reasonText = <String, String>{
    'ACCOUNT_SUSPENDED': 'Your account is suspended. Contact Musride support.',
    'ACCOUNT_DELETED': 'This account is closed.',
    'DRIVER_NOT_APPROVED': 'Musride has not approved your documents yet.',
    'NO_APPROVED_VEHICLE': 'Your vehicle has not been approved yet.',
    'SUBSCRIPTION_INACTIVE':
        'Your monthly subscription is not active. Pay at the Musride office to continue.',
  };
}

import 'package:flutter_test/flutter_test.dart';
import 'package:horide_core/horide_core.dart';

/// A trip exactly as the backend returns it to a passenger (copied from the trip view in
/// apps/backend/src/modules/trips/trip-views.service.ts).
const passengerTripJson = <String, dynamic>{
  'id': 'f4e527ed-71ad-457f-965b-ab1205092172',
  'status': 'driver_arriving',
  'category': 'car',
  'pickup': {'lat': 9.3505, 'lng': 42.7979, 'text': 'Taiwan Market'},
  'destination': {'lat': 9.3655, 'lng': 42.8079, 'text': null},
  'route': {'distanceMetres': 2412, 'durationSeconds': 347, 'isEstimate': true},
  'fare': {'quoted': '8000', 'locked': '8000', 'final': null, 'cancellationFee': null},
  'paymentMethod': 'ebirr',
  'times': {
    'requestedAt': '2026-11-05T05:35:00.000Z',
    'acceptedAt': '2026-11-05T05:35:10.000Z',
    'arrivedAt': null,
    'startedAt': null,
    'completedAt': null,
    'cancelledAt': null,
  },
  'cancelledBy': null,
  'driver': {
    'name': 'Abdi Yusuf',
    'rating': '4.80',
    'ratingCount': 12,
    'phone': '+251911000000',
    'vehicle': {
      'make': 'Toyota',
      'model': 'Vitz',
      'colour': 'White',
      'plate': 'AA-12345',
      'category': 'car',
    },
  },
  'driverLocation': {
    'lat': 9.351,
    'lng': 42.798,
    'heading': 90,
    'recordedAt': '2026-11-05T05:36:00.000Z',
    'ageSeconds': 45,
    'isLive': false,
  },
};

void main() {
  test('parses a passenger trip view', () {
    final trip = Trip.fromJson(passengerTripJson);
    expect(trip.status, TripStatus.driverArriving);
    expect(trip.status.hasDriver, isTrue);
    expect(trip.paymentMethod, PaymentMethod.ebirr);
    expect(trip.fare, '8000');
    expect(trip.pickup.text, 'Taiwan Market');
    expect(trip.destination.text, isNull);
    expect(trip.driver?.vehicle.plate, 'AA-12345');
    expect(trip.driver?.vehicle.description, 'White Toyota Vitz');
    // A stale position must be recognisable as stale.
    expect(trip.driverLocation?.isLive, isFalse);
    expect(trip.driverLocation?.ageSeconds, inInclusiveRange(45, 47));
  });

  test('a live position turns stale by itself after 30 seconds', () {
    final now = DateTime(2026, 11, 5, 8);
    final loc = DriverLocation(point: const LatLngPoint(9.35, 42.8), ageSeconds: 5, now: now);
    expect(loc.isLiveAt(now), isTrue);
    expect(loc.isLiveAt(now.add(const Duration(seconds: 25))), isTrue);
    expect(loc.isLiveAt(now.add(const Duration(seconds: 26))), isFalse);
  });

  test('a finished trip hides the driver phone (field absent)', () {
    final json = Map<String, dynamic>.from(passengerTripJson)
      ..['status'] = 'completed'
      ..['fare'] = {'quoted': '8000', 'locked': '8000', 'final': '8000', 'cancellationFee': null}
      ..['driver'] = {
        'name': 'Abdi Yusuf',
        'rating': '4.80',
        'ratingCount': 12,
        'vehicle': (passengerTripJson['driver'] as Map<String, dynamic>)['vehicle'],
      }
      ..remove('driverLocation');
    final trip = Trip.fromJson(json);
    expect(trip.status.isFinal, isTrue);
    expect(trip.driver?.phone, isNull);
    expect(trip.driverLocation, isNull);
  });

  test('parses quotes and offers', () {
    final q = Quote.fromJson({
      'category': 'bajaj',
      'fare': '4000',
      'fareEtb': '40.00',
      'distanceMetres': 2345,
      'durationSeconds': 340,
      'isEstimate': true,
      'minimumApplied': false,
      'fareVersionId': 'v1',
      'expiresAt': '2026-11-05T05:40:00.000Z',
      'quoteToken': 'abc.def',
    });
    expect(q.category, VehicleCategory.bajaj);
    expect(formatEtbShort(q.fare), '40 ETB');

    final o = RideOffer.fromJson({
      'offer_id': 'o1',
      'trip_id': 't1',
      'expires_at': '2026-11-05T05:40:20.000Z',
      'distance_to_pickup_m': 640,
      'category': 'car',
      'pickup_text': 'Bus station',
      'pickup_lat': 9.3561,
      'pickup_lng': 42.7884,
      'destination_text': 'Airport road',
      'route_distance_m': 4930,
      'quoted_fare': '11500',
      'payment_method': 'cash',
    });
    expect(o.tripId, 't1');
    expect(o.paymentMethod, PaymentMethod.cash);
  });

  test('all trip statuses from the backend are understood', () {
    for (final s in [
      'requested',
      'searching',
      'accepted',
      'driver_arriving',
      'arrived',
      'in_progress',
      'completed',
      'cancelled',
      'expired',
    ]) {
      expect(() => TripStatus.parse(s), returnsNormally);
    }
    expect(() => TripStatus.parse('teleported'), throwsFormatException);
  });
}

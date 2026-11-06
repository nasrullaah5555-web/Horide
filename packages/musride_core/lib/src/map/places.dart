import 'dart:math';

import '../api/api_client.dart';
import '../models/models.dart';

/// A search suggestion from the server. [point] is known for some providers; otherwise ask
/// [PlacesApi.details] once the person picks it.
class PlaceSuggestion {
  const PlaceSuggestion({required this.id, required this.name, this.detail, this.point});

  factory PlaceSuggestion.fromJson(Map<String, dynamic> j) {
    final p = j['point'] as Map<String, dynamic>?;
    return PlaceSuggestion(
      id: j['id'] as String,
      name: j['name'] as String,
      detail: j['detail'] as String?,
      point:
          p == null
              ? null
              : LatLngPoint((p['lat'] as num).toDouble(), (p['lng'] as num).toDouble()),
    );
  }

  final String id;
  final String name;
  final String? detail;
  final LatLngPoint? point;
}

/// Place search through the Musride server (which holds any paid API key, never the app).
class PlacesApi {
  PlacesApi(this._c);
  final ApiClient _c;

  /// A new token per search screen: Google bills one session per place chosen, not per letter.
  static String newSession() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    final r = Random.secure();
    return List.generate(24, (_) => chars[r.nextInt(chars.length)]).join();
  }

  Future<List<PlaceSuggestion>> search(String query, {LatLngPoint? near, String? session}) async {
    final q = <String, String>{
      'q': query,
      if (near != null) 'lat': near.lat.toStringAsFixed(6),
      if (near != null) 'lng': near.lng.toStringAsFixed(6),
      if (session != null) 'session': session,
    };
    final r = await _c.get('/places/search?${Uri(queryParameters: q).query}');
    return (r['places'] as List<dynamic>)
        .map((e) => PlaceSuggestion.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<Place> details(PlaceSuggestion s, {String? session}) async {
    if (s.point != null) return Place(s.point!, s.name);
    final q = {'id': s.id, if (session != null) 'session': session};
    final r = await _c.get('/places/details?${Uri(queryParameters: q).query}');
    final p = r['point'] as Map<String, dynamic>;
    return Place(
      LatLngPoint((p['lat'] as num).toDouble(), (p['lng'] as num).toDouble()),
      r['name'] as String?,
    );
  }

  /// A readable name for a point on the map, or null if none is known.
  Future<String?> reverse(LatLngPoint p) async {
    final q = {'lat': p.lat.toStringAsFixed(6), 'lng': p.lng.toStringAsFixed(6)};
    final r = await _c.get('/places/reverse?${Uri(queryParameters: q).query}');
    return r['name'] as String?;
  }
}

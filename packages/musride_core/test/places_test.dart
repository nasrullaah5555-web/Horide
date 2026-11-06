import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:musride_core/musride_core.dart';

void main() {
  final calls = <Uri>[];
  final api = PlacesApi(
    ApiClient(
      baseUrl: 'https://api.test',
      tokens: MemoryTokenStore(const Tokens(accessToken: 'a', refreshToken: 'r')),
      httpClient: MockClient((req) async {
        calls.add(req.url);
        final body = switch (req.url.path) {
          '/places/search' => {
            'places': [
              {'id': 'g:abc', 'name': 'BBS Mall', 'detail': 'Eastleigh, Nairobi', 'point': null},
              {
                'id': 'pt:-1.296700,36.890800',
                'name': 'Donholm',
                'detail': 'Nairobi',
                'point': {'lat': -1.2967, 'lng': 36.8908},
              },
            ],
          },
          '/places/details' => {
            'point': {'lat': -1.2741, 'lng': 36.8513},
            'name': 'BBS Mall',
            'detail': null,
          },
          _ => {'name': 'Eastleigh 1st Avenue'},
        };
        return http.Response(jsonEncode(body), 200, headers: {'content-type': 'application/json'});
      }),
    ),
  );

  test('searches near a point with a session, and only asks for details when needed', () async {
    final found = await api.search(
      'bbs mall',
      near: const LatLngPoint(-1.27, 36.85),
      session: 'abcdefgh12',
    );
    expect(found.map((f) => f.name), ['BBS Mall', 'Donholm']);
    expect(calls.last.queryParameters, {
      'q': 'bbs mall',
      'lat': '-1.270000',
      'lng': '36.850000',
      'session': 'abcdefgh12',
    });

    final donholm = await api.details(found[1]);
    expect(donholm.point.lat, -1.2967);
    expect(calls.last.path, '/places/search'); // no extra request: the point was known

    final bbs = await api.details(found[0], session: 'abcdefgh12');
    expect(bbs.text, 'BBS Mall');
    expect(calls.last.path, '/places/details');
  });

  test('names a point', () async {
    expect(await api.reverse(const LatLngPoint(-1.27, 36.85)), 'Eastleigh 1st Avenue');
  });

  test('session tokens are random and the right shape for the server', () {
    final a = PlacesApi.newSession();
    expect(a, matches(RegExp(r'^[A-Za-z0-9]{24}$')));
    expect(PlacesApi.newSession(), isNot(a));
  });
}

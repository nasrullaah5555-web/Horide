import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:musride_core/musride_core.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

http.Response json(int status, Object body) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

void main() {
  group('ApiClient', () {
    test('sends the access token and decodes JSON', () async {
      final store = MemoryTokenStore(const Tokens(accessToken: 'a1', refreshToken: 'r1'));
      final client = ApiClient(
        baseUrl: 'https://api.test',
        tokens: store,
        httpClient: MockClient((req) async {
          expect(req.headers['Authorization'], 'Bearer a1');
          expect(req.url.toString(), 'https://api.test/trips/active');
          return json(200, {'trip': null});
        }),
      );
      expect(await client.get('/trips/active'), {'trip': null});
    });

    test('maps API errors to ApiException with the server message', () async {
      final client = ApiClient(
        baseUrl: 'https://api.test',
        tokens: MemoryTokenStore(const Tokens(accessToken: 'a', refreshToken: 'r')),
        httpClient: MockClient(
          (_) async => json(422, {
            'error': {'code': 'PICKUP_OUTSIDE_SERVICE_AREA', 'message': 'Not available here yet.'},
          }),
        ),
      );
      await expectLater(
        client.post('/quotes', {}),
        throwsA(
          isA<ApiException>()
              .having((e) => e.status, 'status', 422)
              .having((e) => e.code, 'code', 'PICKUP_OUTSIDE_SERVICE_AREA')
              .having((e) => e.message, 'message', 'Not available here yet.'),
        ),
      );
    });

    test('on 401 refreshes once, stores the rotated tokens and retries', () async {
      final store = MemoryTokenStore(const Tokens(accessToken: 'old', refreshToken: 'r-old'));
      var refreshes = 0;
      final client = ApiClient(
        baseUrl: 'https://api.test',
        tokens: store,
        httpClient: MockClient((req) async {
          if (req.url.path == '/auth/refresh') {
            refreshes++;
            expect(jsonDecode(req.body), {'refreshToken': 'r-old'});
            return json(200, {'accessToken': 'new', 'refreshToken': 'r-new'});
          }
          return req.headers['Authorization'] == 'Bearer new'
              ? json(200, {'ok': true})
              : json(401, {
                'error': {'code': 'UNAUTHENTICATED', 'message': 'Please log in.'},
              });
        }),
      );
      expect(await client.get('/auth/me'), {'ok': true});
      expect(refreshes, 1);
      final t = await store.read();
      expect(t?.accessToken, 'new');
      expect(t?.refreshToken, 'r-new');
    });

    test('concurrent 401s share ONE refresh (a refresh token can only be used once)', () async {
      final store = MemoryTokenStore(const Tokens(accessToken: 'old', refreshToken: 'r-old'));
      var refreshes = 0;
      final client = ApiClient(
        baseUrl: 'https://api.test',
        tokens: store,
        httpClient: MockClient((req) async {
          if (req.url.path == '/auth/refresh') {
            refreshes++;
            await Future<void>.delayed(const Duration(milliseconds: 20));
            return json(200, {'accessToken': 'new', 'refreshToken': 'r-new'});
          }
          return req.headers['Authorization'] == 'Bearer new'
              ? json(200, {'ok': true})
              : json(401, {
                'error': {'code': 'UNAUTHENTICATED', 'message': 'x'},
              });
        }),
      );
      final results = await Future.wait([client.get('/a'), client.get('/b'), client.get('/c')]);
      expect(results, everyElement({'ok': true}));
      expect(refreshes, 1);
    });

    test('when refresh fails, tokens are cleared and onSignedOut fires', () async {
      final store = MemoryTokenStore(const Tokens(accessToken: 'old', refreshToken: 'r-old'));
      final client = ApiClient(
        baseUrl: 'https://api.test',
        tokens: store,
        httpClient: MockClient(
          (_) async => json(401, {
            'error': {'code': 'SESSION_INVALID', 'message': 'Please log in again.'},
          }),
        ),
      );
      final signedOut = Completer<void>();
      client.onSignedOut.listen((_) => signedOut.complete());
      await expectLater(client.get('/auth/me'), throwsA(isA<ApiException>()));
      await signedOut.future.timeout(const Duration(seconds: 1));
      expect(await store.read(), isNull);
    });

    test('network failure becomes a friendly ApiException', () async {
      final client = ApiClient(
        baseUrl: 'https://api.test',
        tokens: MemoryTokenStore(),
        httpClient: MockClient((_) async => throw http.ClientException('no route')),
      );
      await expectLater(
        client.get('/trips/active'),
        throwsA(isA<ApiException>().having((e) => e.isNetwork, 'isNetwork', true)),
      );
    });
  });

  group('AuthApi', () {
    test('verifyCode stores both tokens', () async {
      final store = MemoryTokenStore();
      final client = ApiClient(
        baseUrl: 'https://api.test',
        tokens: store,
        httpClient: MockClient((req) async {
          expect(jsonDecode(req.body), containsPair('role', 'passenger'));
          return json(200, {
            'accessToken': 'a',
            'refreshToken': 'r',
            'user': {'id': 'u1', 'phone': '+251911234567', 'isNew': true},
          });
        }),
      );
      final user = await AuthApi(
        client,
      ).verifyCode(challengeId: 'c1', code: '123456', role: UserRole.passenger);
      expect(user.isNew, isTrue);
      expect((await store.read())?.refreshToken, 'r');
    });
  });
}

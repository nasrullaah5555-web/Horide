import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:musride_core/musride_core.dart';

http.Response _json(int status, Object body) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

ApiClient _client(List<String> calls, List<Map<String, dynamic>> items, {int? unread}) => ApiClient(
  baseUrl: 'https://api.test',
  tokens: MemoryTokenStore(const Tokens(accessToken: 'a', refreshToken: 'r')),
  httpClient: MockClient((req) async {
    calls.add('${req.method} ${req.url.path}');
    if (req.url.path == '/notifications/read-all') return http.Response('', 204);
    return _json(200, {
      'notifications': items,
      'unread': unread ?? items.where((i) => i['read_at'] == null).length,
    });
  }),
);

void main() {
  final unreadItem = {
    'id': 'n1',
    'type': 'trip.accepted',
    'title': 'Your driver is coming',
    'body': 'Abdi is on the way in a white car, ET978755.',
    'data': null,
    'read_at': null,
    'created_at': '2026-11-06T13:47:00Z',
  };

  testWidgets('shows messages and marks them read on the server', (tester) async {
    final calls = <String>[];
    await tester.pumpWidget(
      MaterialApp(home: NotificationsScreen(api: _client(calls, [unreadItem]))),
    );
    await tester.pumpAndSettle();
    expect(find.text('Your driver is coming'), findsOneWidget);
    expect(find.textContaining('ET978755'), findsOneWidget);
    expect(calls, ['GET /notifications', 'POST /notifications/read-all']);
  });

  testWidgets('says so when there are no messages, without marking anything read', (tester) async {
    final calls = <String>[];
    await tester.pumpWidget(MaterialApp(home: NotificationsScreen(api: _client(calls, []))));
    await tester.pumpAndSettle();
    expect(find.text('No notifications yet'), findsOneWidget);
    expect(calls, ['GET /notifications']);
  });

  testWidgets('the bell shows the unread count', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          appBar: AppBar(
            actions: [NotificationsBell(api: _client([], [unreadItem]), onOpen: () async {})],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('1'), findsOneWidget);
    expect(find.byTooltip('Notifications, 1 unread'), findsOneWidget);
  });

  test('times are shown as day, month and clock time', () {
    expect(formatInboxTime(DateTime.utc(2026, 11, 6, 13, 47)).contains('Nov'), isTrue);
  });
}

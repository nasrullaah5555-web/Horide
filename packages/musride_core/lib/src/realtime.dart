import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import 'api/token_store.dart';

/// One message pushed by the server.
class RealtimeEvent {
  const RealtimeEvent(this.name, this.data);
  final String name;
  final Map<String, dynamic> data;
}

/// Live updates from the server (offers, trip changes, driver location).
///
/// Messages can be lost on a weak connection, so they are treated as hints: whenever the socket
/// (re)connects, [onReconnected] fires and the app reloads the true state with GET /trips/active.
class RealtimeClient {
  RealtimeClient({required this.baseUrl, required this.tokens});

  final String baseUrl;
  final TokenStore tokens;
  io.Socket? _socket;
  final _events = StreamController<RealtimeEvent>.broadcast();
  final _reconnected = StreamController<void>.broadcast();

  Stream<RealtimeEvent> get events => _events.stream;
  Stream<void> get onReconnected => _reconnected.stream;

  static const _names = ['offer.created', 'offer.closed', 'trip.updated', 'driver.location'];

  Future<void> connect() async {
    await disconnect();
    final t = await tokens.read();
    if (t == null) return;
    final socket = io.io(
      baseUrl,
      io.OptionBuilder()
          .setPath('/realtime')
          .setTransports(['websocket'])
          .setAuth({'token': t.accessToken})
          .disableAutoConnect()
          .enableReconnection()
          .setReconnectionDelay(2000)
          .setReconnectionDelayMax(15000)
          .build(),
    );
    for (final name in _names) {
      socket.on(name, (dynamic data) {
        if (data is Map) _events.add(RealtimeEvent(name, Map<String, dynamic>.from(data)));
      });
    }
    socket.onConnect((_) => _reconnected.add(null));
    // The server disconnects when the access token expires; reconnect with a fresh token.
    socket.onDisconnect((_) async {
      final fresh = await tokens.read();
      if (fresh != null && _socket == socket) {
        socket.auth = {'token': fresh.accessToken};
      }
    });
    _socket = socket..connect();
  }

  Future<void> disconnect() async {
    _socket?.dispose();
    _socket = null;
  }

  bool get isConnected => _socket?.connected ?? false;
}

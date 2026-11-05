import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import 'token_store.dart';

/// An error from the API, in the server's standard shape: `{ error: { code, message, details } }`.
/// `message` is written for people and can be shown directly in the app.
class ApiException implements Exception {
  const ApiException(this.status, this.code, this.message, [this.details]);
  final int status;
  final String code;
  final String message;
  final Object? details;

  /// No answer from the server at all (no signal, server down).
  bool get isNetwork => status == 0;

  @override
  String toString() => 'ApiException($status, $code): $message';
}

/// Talks to the Horide API.
///
/// - Adds the access token to every request.
/// - When the access token has expired (401), uses the refresh token once to get new tokens and
///   retries the request. Concurrent requests share one refresh, because each refresh token can
///   only be used once (a second use would make the server log the user out everywhere).
/// - If refreshing fails, clears the tokens and reports [onSignedOut].
class ApiClient {
  ApiClient({
    required this.baseUrl,
    required this.tokens,
    http.Client? httpClient,
    this.timeout = const Duration(seconds: 20),
  }) : _http = httpClient ?? http.Client();

  final String baseUrl;
  final TokenStore tokens;
  final Duration timeout;
  final http.Client _http;

  final _signedOut = StreamController<void>.broadcast();
  Future<bool>? _refreshing;

  /// Fires when the session ended and the user must log in again.
  Stream<void> get onSignedOut => _signedOut.stream;

  Future<Map<String, dynamic>> get(String path) => _send('GET', path);
  Future<Map<String, dynamic>> post(String path, [Object? body]) => _send('POST', path, body: body);
  Future<Map<String, dynamic>> patch(String path, [Object? body]) =>
      _send('PATCH', path, body: body);
  Future<Map<String, dynamic>> delete(String path, [Object? body]) =>
      _send('DELETE', path, body: body);

  /// Uploads one file as multipart/form-data (driver documents).
  Future<Map<String, dynamic>> upload(
    String path, {
    required Map<String, String> fields,
    required String fileField,
    required List<int> bytes,
    required String filename,
  }) async {
    Future<http.Response> build() async {
      final req = http.MultipartRequest('POST', Uri.parse('$baseUrl$path'))
        ..fields.addAll(fields)
        ..files.add(http.MultipartFile.fromBytes(fileField, bytes, filename: filename));
      final t = await tokens.read();
      if (t != null) req.headers['Authorization'] = 'Bearer ${t.accessToken}';
      return http.Response.fromStream(await _http.send(req).timeout(const Duration(seconds: 90)));
    }

    return _withRetry(build, authenticated: true);
  }

  /// Unauthenticated calls (OTP request/verify, refresh) skip the token logic.
  Future<Map<String, dynamic>> postPublic(String path, Object body) async {
    final res = await _raw('POST', path, body: body, accessToken: null);
    return _decode(res);
  }

  Future<Map<String, dynamic>> _send(String method, String path, {Object? body}) {
    return _withRetry(
      () async => _raw(method, path, body: body, accessToken: (await tokens.read())?.accessToken),
      authenticated: true,
    );
  }

  Future<Map<String, dynamic>> _withRetry(
    Future<http.Response> Function() request, {
    required bool authenticated,
  }) async {
    var res = await _guard(request);
    if (res.statusCode == 401 && authenticated && await _refresh()) {
      res = await _guard(request);
    }
    if (res.statusCode == 401 && authenticated) {
      await _endSession();
    }
    return _decode(res);
  }

  Future<http.Response> _guard(Future<http.Response> Function() request) async {
    try {
      return await request();
    } on SocketException {
      throw const ApiException(0, 'NETWORK', 'No connection. Check your internet and try again.');
    } on TimeoutException {
      throw const ApiException(0, 'NETWORK', 'The connection is slow. Please try again.');
    } on http.ClientException {
      throw const ApiException(0, 'NETWORK', 'No connection. Check your internet and try again.');
    }
  }

  Future<http.Response> _raw(
    String method,
    String path, {
    Object? body,
    required String? accessToken,
  }) {
    final headers = <String, String>{'Accept': 'application/json'};
    if (body != null) headers['Content-Type'] = 'application/json';
    if (accessToken != null) headers['Authorization'] = 'Bearer $accessToken';
    final req = http.Request(method, Uri.parse('$baseUrl$path'))..headers.addAll(headers);
    if (body != null) req.body = jsonEncode(body);
    return _http.send(req).then(http.Response.fromStream).timeout(timeout);
  }

  /// One refresh at a time; everyone waiting gets the same result.
  Future<bool> _refresh() {
    return _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);
  }

  Future<bool> _doRefresh() async {
    final current = await tokens.read();
    if (current == null) return false;
    try {
      final res = await _raw('POST', '/auth/refresh',
          body: {'refreshToken': current.refreshToken}, accessToken: null);
      if (res.statusCode != 200) return false;
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      await tokens.write(Tokens(
        accessToken: data['accessToken'] as String,
        refreshToken: data['refreshToken'] as String,
      ));
      return true;
    } on Exception {
      // Network trouble while refreshing: keep the tokens, the next request will try again.
      return false;
    }
  }

  Future<void> _endSession() async {
    await tokens.clear();
    _signedOut.add(null);
  }

  Map<String, dynamic> _decode(http.Response res) {
    Object? data;
    if (res.body.isNotEmpty) {
      try {
        data = jsonDecode(res.body);
      } on FormatException {
        data = null;
      }
    }
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return data is Map<String, dynamic> ? data : <String, dynamic>{};
    }
    final error = data is Map<String, dynamic> ? data['error'] : null;
    if (error is Map<String, dynamic>) {
      throw ApiException(
        res.statusCode,
        error['code'] as String? ?? 'ERROR',
        error['message'] as String? ?? 'Something went wrong. Please try again.',
        error['details'],
      );
    }
    throw ApiException(res.statusCode, 'ERROR', 'Something went wrong. Please try again.');
  }

  void close() {
    _http.close();
    _signedOut.close();
  }
}

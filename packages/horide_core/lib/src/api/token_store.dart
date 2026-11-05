import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The two login tokens. The refresh token is long-lived and must never be logged or shown.
class Tokens {
  const Tokens({required this.accessToken, required this.refreshToken});
  final String accessToken;
  final String refreshToken;
}

abstract class TokenStore {
  Future<Tokens?> read();
  Future<void> write(Tokens tokens);
  Future<void> clear();
}

/// Stores tokens in the Android Keystore / iOS Keychain (OWASP MASVS-STORAGE).
/// Never in shared preferences or plain files.
class SecureTokenStore implements TokenStore {
  SecureTokenStore({String keyPrefix = 'horide'})
    : _access = '$keyPrefix.access',
      _refresh = '$keyPrefix.refresh';

  final String _access;
  final String _refresh;

  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
  );

  @override
  Future<Tokens?> read() async {
    final access = await _storage.read(key: _access);
    final refresh = await _storage.read(key: _refresh);
    if (access == null || refresh == null) return null;
    return Tokens(accessToken: access, refreshToken: refresh);
  }

  @override
  Future<void> write(Tokens tokens) async {
    await _storage.write(key: _access, value: tokens.accessToken);
    await _storage.write(key: _refresh, value: tokens.refreshToken);
  }

  @override
  Future<void> clear() async {
    await _storage.delete(key: _access);
    await _storage.delete(key: _refresh);
  }
}

/// For tests only.
class MemoryTokenStore implements TokenStore {
  MemoryTokenStore([this._tokens]);
  Tokens? _tokens;

  @override
  Future<Tokens?> read() async => _tokens;

  @override
  Future<void> write(Tokens tokens) async => _tokens = tokens;

  @override
  Future<void> clear() async => _tokens = null;
}

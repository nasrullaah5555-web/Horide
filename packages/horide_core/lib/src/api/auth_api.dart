import 'api_client.dart';
import 'token_store.dart';

enum UserRole { passenger, driver }

class OtpChallenge {
  const OtpChallenge({
    required this.challengeId,
    required this.expiresAt,
    required this.resendAfter,
  });
  final String challengeId;
  final DateTime expiresAt;
  final Duration resendAfter;
}

class SignedInUser {
  const SignedInUser({required this.id, required this.phone, required this.isNew});
  final String id;
  final String phone;
  final bool isNew;
}

/// Phone-number login with a one-time SMS code.
class AuthApi {
  AuthApi(this.client);
  final ApiClient client;

  Future<OtpChallenge> requestCode(String phoneE164) async {
    final data = await client.postPublic('/auth/otp/request', {'phone': phoneE164});
    return OtpChallenge(
      challengeId: data['challengeId'] as String,
      expiresAt: DateTime.parse(data['expiresAt'] as String),
      resendAfter: Duration(seconds: (data['resendAfterSeconds'] as num).toInt()),
    );
  }

  Future<SignedInUser> verifyCode({
    required String challengeId,
    required String code,
    required UserRole role,
    String? deviceInfo,
  }) async {
    final data = await client.postPublic('/auth/otp/verify', {
      'challengeId': challengeId,
      'code': code,
      'role': role.name,
      if (deviceInfo != null) 'deviceInfo': deviceInfo,
    });
    await client.tokens.write(
      Tokens(
        accessToken: data['accessToken'] as String,
        refreshToken: data['refreshToken'] as String,
      ),
    );
    final user = data['user'] as Map<String, dynamic>;
    return SignedInUser(
      id: user['id'] as String,
      phone: user['phone'] as String,
      isNew: user['isNew'] as bool,
    );
  }

  Future<bool> isSignedIn() async => (await client.tokens.read()) != null;

  /// Ends the session on the server (all devices in this session family) and on this phone.
  Future<void> signOut() async {
    final t = await client.tokens.read();
    if (t != null) {
      try {
        await client.postPublic('/auth/logout', {'refreshToken': t.refreshToken});
      } on ApiException {
        // Still sign out locally if the server can't be reached.
      }
    }
    await client.tokens.clear();
  }
}

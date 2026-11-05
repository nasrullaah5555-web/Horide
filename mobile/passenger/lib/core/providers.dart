import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:horide_core/horide_core.dart';

/// Shared services. Overridden in tests with fakes.
final tokenStoreProvider = Provider<TokenStore>(
  (ref) => SecureTokenStore(keyPrefix: 'horide.passenger'),
);

final apiClientProvider = Provider<ApiClient>((ref) {
  final client = ApiClient(baseUrl: HorideConfig.apiUrl, tokens: ref.watch(tokenStoreProvider));
  ref.onDispose(client.close);
  return client;
});

final authApiProvider = Provider<AuthApi>((ref) => AuthApi(ref.watch(apiClientProvider)));

final realtimeProvider = Provider<RealtimeClient>((ref) {
  final rt = RealtimeClient(baseUrl: HorideConfig.apiUrl, tokens: ref.watch(tokenStoreProvider));
  ref.onDispose(rt.disconnect);
  return rt;
});

/// Whether someone is signed in on this phone. The router listens to this.
class SessionNotifier extends AsyncNotifier<bool> {
  @override
  Future<bool> build() async {
    final api = ref.watch(apiClientProvider);
    final sub = api.onSignedOut.listen((_) => state = const AsyncData(false));
    ref.onDispose(sub.cancel);
    return ref.watch(authApiProvider).isSignedIn();
  }

  void signedIn() => state = const AsyncData(true);

  Future<void> signOut() async {
    await ref.read(realtimeProvider).disconnect();
    await ref.read(authApiProvider).signOut();
    state = const AsyncData(false);
  }
}

final sessionProvider = AsyncNotifierProvider<SessionNotifier, bool>(SessionNotifier.new);

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:musride_core/musride_core.dart';

/// Shared services. Overridden in tests with fakes.
final tokenStoreProvider = Provider<TokenStore>(
  (ref) => SecureTokenStore(keyPrefix: 'musride.passenger'),
);

final apiClientProvider = Provider<ApiClient>((ref) {
  final client = ApiClient(baseUrl: MusrideConfig.apiUrl, tokens: ref.watch(tokenStoreProvider));
  ref.onDispose(client.close);
  return client;
});

final authApiProvider = Provider<AuthApi>((ref) => AuthApi(ref.watch(apiClientProvider)));

final realtimeProvider = Provider<RealtimeClient>((ref) {
  final rt = RealtimeClient(baseUrl: MusrideConfig.apiUrl, tokens: ref.watch(tokenStoreProvider));
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

  /// Deletes the account on the server; the error is shown to the person if it fails
  /// (for example while a trip is still open).
  Future<void> deleteAccount() async {
    await ref.read(authApiProvider).deleteAccount();
    await ref.read(realtimeProvider).disconnect();
    state = const AsyncData(false);
  }

  Future<void> signOut() async {
    await ref.read(realtimeProvider).disconnect();
    await ref.read(authApiProvider).signOut();
    state = const AsyncData(false);
  }
}

final sessionProvider = AsyncNotifierProvider<SessionNotifier, bool>(SessionNotifier.new);

/// Place search (suggestions while typing, names for map points) through the Musride server.
final placesApiProvider = Provider<PlacesApi>((ref) => PlacesApi(ref.watch(apiClientProvider)));

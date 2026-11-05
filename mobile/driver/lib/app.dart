import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:musride_core/musride_core.dart';

import 'core/providers.dart';
import 'features/auth/code_screen.dart';
import 'features/auth/phone_screen.dart';
import 'features/history/history_screen.dart';
import 'features/home/home_screen.dart';
import 'features/onboarding/onboarding_screen.dart';
import 'features/trip/trip_screen.dart';

/// Routes. Anyone not signed in is sent to /login; a signed-in user never sees /login.
final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen(sessionProvider, (_, __) => refresh.value++);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: '/',
    refreshListenable: refresh,
    redirect: (context, state) {
      final session = ref.read(sessionProvider);
      if (session.isLoading) return null;
      final signedIn = session.valueOrNull ?? false;
      final atLogin = state.matchedLocation.startsWith('/login');
      if (!signedIn && !atLogin) return '/login';
      if (signedIn && atLogin) return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (_, __) => const PhoneScreen()),
      GoRoute(
        path: '/login/code',
        builder: (_, state) => CodeScreen(args: state.extra! as CodeScreenArgs),
      ),
      GoRoute(path: '/', builder: (_, __) => const HomeScreen()),
      GoRoute(path: '/trip', builder: (_, __) => const TripScreen()),
      GoRoute(path: '/onboarding', builder: (_, __) => const OnboardingScreen()),
      GoRoute(path: '/history', builder: (_, __) => const HistoryScreen()),
      GoRoute(
        path: '/history/:id/payment',
        builder: (_, state) => HistoryPaymentScreen(tripId: state.pathParameters['id']!),
      ),
    ],
  );
});

class MusrideApp extends ConsumerWidget {
  const MusrideApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    if (session.isLoading) {
      return MaterialApp(
        theme: MusrideTheme.light(),
        darkTheme: MusrideTheme.dark(),
        home: const Scaffold(body: Center(child: CircularProgressIndicator())),
      );
    }
    return MaterialApp.router(
      title: 'Musride Driver',
      debugShowCheckedModeBanner: false,
      theme: MusrideTheme.light(),
      darkTheme: MusrideTheme.dark(),
      routerConfig: ref.watch(routerProvider),
      builder: (context, child) => ConnectionBanner(child: child ?? const SizedBox.shrink()),
    );
  }
}

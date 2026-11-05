import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';

import '../theme.dart';

/// A strip at the top of the screen when the phone has no network, so people know why nothing
/// is updating instead of thinking the app is broken. Disappears when the connection returns.
class ConnectionBanner extends StatefulWidget {
  const ConnectionBanner({super.key, required this.child, this.connectivity});

  final Widget child;
  final Connectivity? connectivity;

  @override
  State<ConnectionBanner> createState() => _ConnectionBannerState();
}

class _ConnectionBannerState extends State<ConnectionBanner> {
  late final Connectivity _connectivity = widget.connectivity ?? Connectivity();
  StreamSubscription<List<ConnectivityResult>>? _sub;
  bool _offline = false;

  @override
  void initState() {
    super.initState();
    // If the platform can't report connectivity (e.g. in tests), assume online: the API calls
    // themselves still report network errors.
    _connectivity.checkConnectivity().then(_update, onError: (Object _) {});
    _sub = _connectivity.onConnectivityChanged.listen(_update, onError: (Object _) {});
  }

  void _update(List<ConnectivityResult> results) {
    final offline = results.isEmpty || results.every((r) => r == ConnectivityResult.none);
    if (mounted && offline != _offline) setState(() => _offline = offline);
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        AnimatedSize(
          duration: const Duration(milliseconds: 200),
          child:
              _offline
                  ? Material(
                    color: HorideColors.amber,
                    child: SafeArea(
                      bottom: false,
                      child: Semantics(
                        liveRegion: true,
                        child: const Padding(
                          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                          child: Row(
                            children: [
                              Icon(Icons.wifi_off, color: Colors.white, size: 20),
                              SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  'No internet. We will update when you are back online.',
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  )
                  : const SizedBox(width: double.infinity),
        ),
        Expanded(child: widget.child),
      ],
    );
  }
}

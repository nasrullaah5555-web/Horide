import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';

import '../design/components.dart';
import '../design/tokens.g.dart';

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
                    color: MusrideColors.amber,
                    child: SafeArea(
                      bottom: false,
                      child: Semantics(
                        liveRegion: true,
                        child: const Padding(
                          padding: EdgeInsets.symmetric(
                            horizontal: MusrideSpace.lg,
                            vertical: MusrideSpace.md,
                          ),
                          child: Row(
                            children: [
                              Icon(
                                Icons.wifi_off,
                                color: MusrideColors.white,
                                size: MusrideSize.iconSmall,
                              ),
                              Gap(MusrideSpace.md),
                              Expanded(
                                child: Text(
                                  'No internet. We will update when you are back online.',
                                  style: TextStyle(
                                    color: MusrideColors.white,
                                    fontWeight: MusrideFontWeight.medium,
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

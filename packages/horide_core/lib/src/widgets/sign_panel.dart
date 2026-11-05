import 'package:flutter/material.dart';

import '../theme.dart';

enum SignTone { go, calm, alert }

/// The road-sign panel used for the one most important status on a screen
/// (e.g. "Driver arriving, 3 min"). Same visual language as the staff console.
class SignPanel extends StatelessWidget {
  const SignPanel({super.key, required this.title, this.subtitle, this.tone = SignTone.go, this.trailing});

  final String title;
  final String? subtitle;
  final SignTone tone;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final colour = switch (tone) {
      SignTone.go => HorideColors.sign,
      SignTone.calm => HorideColors.navySoft,
      SignTone.alert => HorideColors.signal,
    };
    return Semantics(
      container: true,
      liveRegion: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colour,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: Colors.white, width: 3),
          boxShadow: const [BoxShadow(color: Color(0x2614283E), blurRadius: 0, spreadRadius: 1)],
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 14, 18, 14),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w800, height: 1.1),
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        subtitle!,
                        style: TextStyle(color: Colors.white.withValues(alpha: 0.9), fontSize: 15, fontWeight: FontWeight.w600),
                      ),
                    ],
                  ],
                ),
              ),
              if (trailing != null) trailing!,
            ],
          ),
        ),
      ),
    );
  }
}

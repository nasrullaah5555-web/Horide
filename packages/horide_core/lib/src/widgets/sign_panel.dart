import 'package:flutter/material.dart';

import '../design/components.dart';
import '../design/tokens.g.dart';

enum SignTone { go, calm, alert }

/// The road-sign panel used for the one most important status on a screen
/// (e.g. "Driver arriving, 3 min"). Same visual language as the staff console and website.
class SignPanel extends StatelessWidget {
  const SignPanel({
    super.key,
    required this.title,
    this.subtitle,
    this.tone = SignTone.go,
    this.trailing,
  });

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
          borderRadius: BorderRadius.circular(HorideRadius.sign),
          border: Border.all(color: HorideColors.white, width: HorideStroke.signBorder),
          boxShadow: const [
            BoxShadow(color: HorideColors.shadow, spreadRadius: HorideStroke.hairline),
          ],
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: HorideSpace.lg, vertical: HorideSpace.md),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: HorideColors.white,
                        fontSize: HorideFontSize.headline,
                        fontWeight: HorideFontWeight.heavy,
                        height: HorideLineHeight.tight,
                      ),
                    ),
                    if (subtitle != null) ...[
                      const Gap(HorideSpace.xs),
                      Text(
                        subtitle!,
                        style: const TextStyle(
                          color: HorideColors.white,
                          fontSize: HorideFontSize.body,
                          fontWeight: HorideFontWeight.medium,
                        ),
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

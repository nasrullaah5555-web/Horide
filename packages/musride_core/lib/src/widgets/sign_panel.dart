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
      SignTone.go => MusrideColors.sign,
      SignTone.calm => MusrideColors.navySoft,
      SignTone.alert => MusrideColors.signal,
    };
    return Semantics(
      container: true,
      liveRegion: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colour,
          borderRadius: BorderRadius.circular(MusrideRadius.sign),
          border: Border.all(color: MusrideColors.white, width: MusrideStroke.signBorder),
          boxShadow: const [
            BoxShadow(color: MusrideColors.shadow, spreadRadius: MusrideStroke.hairline),
          ],
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: MusrideSpace.lg,
            vertical: MusrideSpace.md,
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: MusrideColors.white,
                        fontSize: MusrideFontSize.headline,
                        fontWeight: MusrideFontWeight.heavy,
                        height: MusrideLineHeight.tight,
                      ),
                    ),
                    if (subtitle != null) ...[
                      const Gap(MusrideSpace.xs),
                      Text(
                        subtitle!,
                        style: const TextStyle(
                          color: MusrideColors.white,
                          fontSize: MusrideFontSize.body,
                          fontWeight: MusrideFontWeight.medium,
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

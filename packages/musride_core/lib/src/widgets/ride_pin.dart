import 'package:flutter/material.dart';

import '../design/components.dart';
import '../design/tokens.g.dart';

/// The passenger's 4-digit ride PIN, large and easy to read out to the driver.
class RidePinCard extends StatelessWidget {
  const RidePinCard({super.key, required this.pin});
  final String pin;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Ride PIN ${pin.split('').join(' ')}. Tell your driver when you get in.',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: MusrideSpace.lg,
          vertical: MusrideSpace.md,
        ),
        decoration: BoxDecoration(
          color: MusrideColors.signSoft,
          border: Border.all(color: MusrideColors.sign, width: MusrideStroke.control),
          borderRadius: BorderRadius.circular(MusrideRadius.control),
        ),
        child: Row(
          children: [
            const Icon(Icons.pin_outlined, color: MusrideColors.signDeep),
            const Gap(MusrideSpace.md),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Ride PIN',
                    style: TextStyle(
                      color: MusrideColors.navy,
                      fontWeight: MusrideFontWeight.bold,
                    ),
                  ),
                  Text(
                    'Tell your driver when you get in',
                    style: TextStyle(color: MusrideColors.navy, fontSize: MusrideFontSize.small),
                  ),
                ],
              ),
            ),
            Text(
              pin,
              style: const TextStyle(
                color: MusrideColors.navy,
                fontSize: MusrideFontSize.code,
                fontWeight: MusrideFontWeight.heavy,
                letterSpacing: MusrideLetterSpacing.code,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

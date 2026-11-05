import 'package:flutter/material.dart';

import 'tokens.g.dart';

/// Map markers, shared by both apps so every map looks the same.

/// A pin: pickup is green, destination navy.
class MapPin extends StatelessWidget {
  const MapPin({super.key, required this.colour, this.label});
  final Color colour;
  final String? label;

  /// The space a pin needs in a flutter_map Marker.
  static const width = MusrideSize.marker;
  static const height = MusrideSize.pin + MusrideSize.pinStem + MusrideSpace.xs;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: MusrideSize.pin,
            height: MusrideSize.pin,
            decoration: BoxDecoration(
              color: colour,
              shape: BoxShape.circle,
              border: Border.all(color: MusrideColors.white, width: MusrideStroke.marker),
              boxShadow: const [
                BoxShadow(color: MusrideColors.shadow, blurRadius: MusrideSpace.sm),
              ],
            ),
          ),
          Container(width: MusrideStroke.signBorder, height: MusrideSize.pinStem, color: colour),
        ],
      ),
    );
  }
}

/// A vehicle or person position. Live = solid navy; stale = hollow grey, so an old position
/// never looks live.
class PositionDot extends StatelessWidget {
  const PositionDot({super.key, required this.live, this.icon, this.label});
  final bool live;
  final IconData? icon;
  final String? label;

  static const size = MusrideSize.marker;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      child: Center(
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            color: live ? MusrideColors.navy : MusrideColors.white,
            shape: BoxShape.circle,
            border: Border.all(
              color: live ? MusrideColors.white : MusrideColors.stale,
              width: MusrideStroke.marker,
            ),
            boxShadow: const [BoxShadow(color: MusrideColors.shadow, blurRadius: MusrideSpace.sm)],
          ),
          child:
              icon == null
                  ? null
                  : Icon(
                    icon,
                    size: MusrideFontSize.small,
                    color: live ? MusrideColors.white : MusrideColors.stale,
                  ),
        ),
      ),
    );
  }
}

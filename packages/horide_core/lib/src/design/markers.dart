import 'package:flutter/material.dart';

import 'tokens.g.dart';

/// Map markers, shared by both apps so every map looks the same.

/// A pin: pickup is green, destination navy.
class MapPin extends StatelessWidget {
  const MapPin({super.key, required this.colour, this.label});
  final Color colour;
  final String? label;

  /// The space a pin needs in a flutter_map Marker.
  static const width = HorideSize.marker;
  static const height = HorideSize.pin + HorideSize.pinStem + HorideSpace.xs;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: HorideSize.pin,
            height: HorideSize.pin,
            decoration: BoxDecoration(
              color: colour,
              shape: BoxShape.circle,
              border: Border.all(color: HorideColors.white, width: HorideStroke.marker),
              boxShadow: const [BoxShadow(color: HorideColors.shadow, blurRadius: HorideSpace.sm)],
            ),
          ),
          Container(width: HorideStroke.signBorder, height: HorideSize.pinStem, color: colour),
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

  static const size = HorideSize.marker;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      child: Center(
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            color: live ? HorideColors.navy : HorideColors.white,
            shape: BoxShape.circle,
            border: Border.all(
              color: live ? HorideColors.white : HorideColors.stale,
              width: HorideStroke.marker,
            ),
            boxShadow: const [BoxShadow(color: HorideColors.shadow, blurRadius: HorideSpace.sm)],
          ),
          child:
              icon == null
                  ? null
                  : Icon(
                    icon,
                    size: HorideFontSize.small,
                    color: live ? HorideColors.white : HorideColors.stale,
                  ),
        ),
      ),
    );
  }
}

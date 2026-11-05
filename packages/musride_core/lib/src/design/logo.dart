import 'package:flutter/material.dart';

import 'tokens.g.dart';

/// The Musride logo (brand sheet, design/brand/): the Route M symbol, optionally with the wordmark.
/// The M is a journey: green pickup ring to drop-off dot. Drawn as vectors, so it is sharp at any size.
class MusrideLogo extends StatelessWidget {
  const MusrideLogo({super.key, this.size = MusrideLogoSize.logo, this.onDark = false, this.wordmark = true});

  /// Height of the symbol.
  final double size;

  /// White M and dot for navy backgrounds.
  final bool onDark;

  /// Show "MUSRIDE" next to the symbol.
  final bool wordmark;

  @override
  Widget build(BuildContext context) {
    final ink = onDark ? MusrideColors.white : MusrideColors.navy;
    final symbol = Semantics(
      label: 'Musride',
      child: CustomPaint(
        size: Size.square(size),
        painter: _RouteM(ink: ink, hole: onDark ? MusrideColors.navy : MusrideColors.white),
      ),
    );
    if (!wordmark) return symbol;
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        symbol,
        SizedBox(width: size * 0.12),
        ExcludeSemantics(
          child: Text(
            'MUSRIDE',
            style: TextStyle(
              fontFamily: musrideBrandFontFamily,
              fontWeight: MusrideFontWeight.bold,
              fontSize: size * 0.62,
              letterSpacing: size * 0.62 * MusrideLetterSpacing.wordmarkEm,
              color: ink,
              height: 1,
            ),
          ),
        ),
      ],
    );
  }
}

/// Logo sizes.
abstract final class MusrideLogoSize {
  static const logo = MusrideSize.avatar;
}

class _RouteM extends CustomPainter {
  _RouteM({required this.ink, required this.hole});
  final Color ink;
  final Color hole;

  @override
  void paint(Canvas canvas, Size size) {
    final k = size.shortestSide / 100;
    canvas.scale(k);
    final stroke = Paint()
      ..color = ink
      ..style = PaintingStyle.stroke
      ..strokeWidth = MusrideLogoShape.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    // Same points as MusrideLogoShape.path: M22 72 V17 L50 53 L78 17 V72.
    final m = Path()
      ..moveTo(22, 72)
      ..lineTo(22, 17)
      ..lineTo(50, 53)
      ..lineTo(78, 17)
      ..lineTo(78, 72);
    canvas.drawPath(m, stroke);
    const ring = Offset(MusrideLogoShape.ringX, MusrideLogoShape.ringY);
    canvas.drawCircle(ring, MusrideLogoShape.ringR, Paint()..color = MusrideColors.sign);
    canvas.drawCircle(ring, MusrideLogoShape.holeR, Paint()..color = hole);
    canvas.drawCircle(
      const Offset(MusrideLogoShape.dotX, MusrideLogoShape.dotY),
      MusrideLogoShape.dotR,
      Paint()..color = ink,
    );
  }

  @override
  bool shouldRepaint(_RouteM old) => old.ink != ink || old.hole != hole;
}

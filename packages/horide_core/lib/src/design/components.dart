import 'package:flutter/material.dart';

import 'tokens.g.dart';

/// The shared building blocks of every Horide screen. Screens combine these and the theme;
/// they never set their own colours, sizes, corners or button styles (scripts/check-design.mjs).

/// Empty space from the spacing scale, e.g. `const Gap(HorideSpace.md)`. Works in rows and columns.
class Gap extends StatelessWidget {
  const Gap(this.size, {super.key});
  final double size;

  @override
  Widget build(BuildContext context) => SizedBox(width: size, height: size);
}

/// Standard paddings.
abstract final class HorideInsets {
  static const screen = EdgeInsets.all(HorideSpace.lg);
  static const panel = EdgeInsets.fromLTRB(
    HorideSpace.lg,
    HorideSpace.lg,
    HorideSpace.lg,
    HorideSpace.md,
  );
  static const tile = EdgeInsets.symmetric(horizontal: HorideSpace.md, vertical: HorideSpace.sm);
  static const overlay = EdgeInsets.all(HorideSpace.md);
}

enum HorideButtonKind {
  /// The main action on a screen (navy filled).
  primary,

  /// Positive "go" actions: book, accept, go online, confirm (green filled).
  go,

  /// Secondary actions (outlined).
  secondary,

  /// Destructive or alarming actions: cancel ride, emergency (red outlined).
  danger,

  /// Emergency calls only (red filled).
  emergency,

  /// Low-emphasis links such as "Sign out" (text only).
  quiet,

  /// Destructive low-emphasis links such as "Delete my account" (red text only).
  quietDanger,
}

/// The only button used in the apps. Every button has the same height, corners and type;
/// only its kind changes its colour.
class HorideButton extends StatelessWidget {
  const HorideButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.kind = HorideButtonKind.primary,
    this.icon,
    this.compact = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final HorideButtonKind kind;
  final IconData? icon;

  /// Shorter button for overlays on a map (still at least 48 dp tall).
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final height = compact ? HorideSize.touchTarget - HorideSpace.sm : HorideSize.touchTarget;
    final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(HorideRadius.control));
    final minSize = Size(compact ? 0 : double.infinity, height);
    final text = Text(label);
    final iconWidget = icon == null ? null : Icon(icon, size: HorideSize.iconSmall);

    Widget filled(Color bg) {
      final style = FilledButton.styleFrom(
        backgroundColor: bg,
        foregroundColor: HorideColors.white,
        minimumSize: minSize,
        shape: shape,
      );
      return iconWidget == null
          ? FilledButton(style: style, onPressed: onPressed, child: text)
          : FilledButton.icon(style: style, onPressed: onPressed, icon: iconWidget, label: text);
    }

    Widget outlined(Color fg) {
      final style = OutlinedButton.styleFrom(
        foregroundColor: fg,
        minimumSize: minSize,
        shape: shape,
        side: BorderSide(
          color: fg == scheme.onSurface ? scheme.outline : fg,
          width: HorideStroke.control,
        ),
      );
      return iconWidget == null
          ? OutlinedButton(style: style, onPressed: onPressed, child: text)
          : OutlinedButton.icon(style: style, onPressed: onPressed, icon: iconWidget, label: text);
    }

    Widget quiet(Color fg) {
      final style = TextButton.styleFrom(foregroundColor: fg, minimumSize: minSize, shape: shape);
      return iconWidget == null
          ? TextButton(style: style, onPressed: onPressed, child: text)
          : TextButton.icon(style: style, onPressed: onPressed, icon: iconWidget, label: text);
    }

    return switch (kind) {
      HorideButtonKind.primary => filled(scheme.primary),
      HorideButtonKind.go => filled(HorideColors.sign),
      HorideButtonKind.emergency => filled(HorideColors.signal),
      HorideButtonKind.secondary => outlined(scheme.onSurface),
      HorideButtonKind.danger => outlined(HorideColors.signal),
      HorideButtonKind.quiet => quiet(scheme.onSurface),
      HorideButtonKind.quietDanger => quiet(HorideColors.signal),
    };
  }
}

/// Round icon button floating over a map (menu, my location, call).
class HorideRoundButton extends StatelessWidget {
  const HorideRoundButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onPressed,
  });
  final IconData icon;
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).colorScheme.surface,
      shape: const CircleBorder(),
      elevation: HorideSpace.xs,
      child: IconButton(
        iconSize: HorideSize.icon,
        constraints: const BoxConstraints(
          minWidth: HorideSize.touchTarget,
          minHeight: HorideSize.touchTarget,
        ),
        tooltip: label,
        icon: Icon(icon),
        onPressed: onPressed,
      ),
    );
  }
}

/// The white panel at the bottom of map screens.
class HorideBottomPanel extends StatelessWidget {
  const HorideBottomPanel({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).colorScheme.surface,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(HorideRadius.panel)),
      elevation: HorideSpace.sm,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: HorideInsets.panel,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: children,
          ),
        ),
      ),
    );
  }
}

/// An amber box for things that need the person's attention, with an optional action.
class HorideNotice extends StatelessWidget {
  const HorideNotice({super.key, required this.text, this.onClose, this.action});
  final String text;
  final VoidCallback? onClose;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(
        HorideSpace.md,
        HorideSpace.sm,
        HorideSpace.xs,
        HorideSpace.sm,
      ),
      decoration: BoxDecoration(
        color: HorideColors.amberSoft,
        border: Border.all(color: HorideColors.amber),
        borderRadius: BorderRadius.circular(HorideRadius.control),
      ),
      child: Row(
        children: [
          Expanded(child: Text(text, style: const TextStyle(color: HorideColors.navy))),
          if (action != null) action!,
          if (onClose != null)
            IconButton(tooltip: 'Dismiss', onPressed: onClose, icon: const Icon(Icons.close)),
        ],
      ),
    );
  }
}

/// One line of status: green when all is well, amber as a warning.
class StatusText extends StatelessWidget {
  const StatusText(this.text, {super.key, required this.ok});
  final String text;
  final bool ok;

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: TextStyle(
      color: ok ? HorideColors.signDeep : HorideColors.amber,
      fontWeight: HorideFontWeight.bold,
    ),
  );
}

/// Muted supporting text (explanations under a button, small print).
class HintText extends StatelessWidget {
  const HintText(this.text, {super.key, this.center = false});
  final String text;
  final bool center;

  @override
  Widget build(BuildContext context) => Text(
    text,
    textAlign: center ? TextAlign.center : TextAlign.start,
    style: Theme.of(context).textTheme.bodySmall,
  );
}

/// A label on the left and a value on the right (receipts, trip summaries).
class InfoRow extends StatelessWidget {
  const InfoRow(this.label, this.value, {super.key, this.bold = false});
  final String label;
  final String value;
  final bool bold;

  static const labelWidth = HorideSpace.xxxl * 2.5;

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: HorideSpace.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: labelWidth, child: Text(label, style: TextStyle(color: muted))),
          Expanded(
            child: Text(
              value,
              style: TextStyle(fontWeight: bold ? HorideFontWeight.heavy : HorideFontWeight.medium),
            ),
          ),
        ],
      ),
    );
  }
}

/// A vehicle registration plate, drawn like the real thing so passengers check it.
class PlateBadge extends StatelessWidget {
  const PlateBadge(this.plate, {super.key});
  final String plate;

  @override
  Widget build(BuildContext context) {
    final fg = Theme.of(context).colorScheme.onSurface;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: HorideSpace.sm, vertical: HorideSpace.xxs),
      decoration: BoxDecoration(
        border: Border.all(color: fg, width: HorideStroke.focus),
        borderRadius: BorderRadius.circular(HorideRadius.sm),
      ),
      child: Text(
        plate,
        style: const TextStyle(
          fontWeight: HorideFontWeight.heavy,
          letterSpacing: HorideLetterSpacing.plate,
        ),
      ),
    );
  }
}

/// A round avatar showing a person's first initial.
class InitialAvatar extends StatelessWidget {
  const InitialAvatar(this.name, {super.key});
  final String? name;

  @override
  Widget build(BuildContext context) {
    final n = name?.trim() ?? '';
    return CircleAvatar(
      radius: HorideSize.avatar / 2,
      backgroundColor: HorideColors.navy,
      child: Text(
        n.isEmpty ? '?' : n[0].toUpperCase(),
        style: const TextStyle(
          color: HorideColors.white,
          fontSize: HorideFontSize.titleLarge,
          fontWeight: HorideFontWeight.heavy,
        ),
      ),
    );
  }
}

/// Five tappable stars.
class StarRating extends StatelessWidget {
  const StarRating({super.key, required this.value, required this.onChanged});
  final int value;
  final ValueChanged<int>? onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        for (var i = 1; i <= 5; i++)
          IconButton(
            tooltip: '$i star${i == 1 ? '' : 's'}',
            iconSize: HorideSize.star,
            onPressed: onChanged == null ? null : () => onChanged!(i),
            icon: Icon(i <= value ? Icons.star : Icons.star_border, color: HorideColors.amber),
          ),
      ],
    );
  }
}

/// A small white spinner for use on coloured panels.
class PanelSpinner extends StatelessWidget {
  const PanelSpinner({super.key});

  @override
  Widget build(BuildContext context) => const SizedBox(
    width: HorideSize.spinner,
    height: HorideSize.spinner,
    child: CircularProgressIndicator(
      color: HorideColors.white,
      strokeWidth: HorideStroke.signBorder,
    ),
  );
}

/// A selectable option card (e.g. car or Bajaj price). Selected = thick green border.
class OptionTile extends StatelessWidget {
  const OptionTile({
    super.key,
    required this.selected,
    required this.onTap,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.trailing,
  });
  final bool selected;
  final VoidCallback onTap;
  final IconData icon;
  final String title;
  final String subtitle;
  final String trailing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      selected: selected,
      button: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(HorideRadius.card),
        child: Container(
          constraints: const BoxConstraints(minHeight: HorideSize.touchTarget + HorideSpace.sm),
          padding: HorideInsets.tile,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(HorideRadius.card),
            border: Border.all(
              color: selected ? HorideColors.sign : theme.colorScheme.outline,
              width: selected ? HorideStroke.selected : HorideStroke.hairline,
            ),
          ),
          child: Row(
            children: [
              Icon(icon, size: HorideSize.iconLarge),
              const Gap(HorideSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: theme.textTheme.titleMedium),
                    Text(subtitle, style: theme.textTheme.bodySmall),
                  ],
                ),
              ),
              Text(trailing, style: theme.textTheme.titleLarge),
            ],
          ),
        ),
      ),
    );
  }
}

/// List of three numbered sections with a heading (onboarding, finished trip).
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: HorideSpace.lg, bottom: HorideSpace.sm),
    child: Text(text, style: Theme.of(context).textTheme.titleMedium),
  );
}

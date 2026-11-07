import 'package:flutter/material.dart';

import '../design/components.dart';
import '../design/tokens.g.dart';

/// Reasons a passenger can pick when cancelling, the short list Uber and Bolt use.
const passengerCancelReasons = [
  'Driver is taking too long',
  'Driver asked me to cancel',
  'Driver is not moving or going the wrong way',
  'Wrong pickup or destination',
  'I found another ride',
  'I changed my plans',
];

/// Reasons a driver can pick when cancelling.
const driverCancelReasons = [
  'Passenger is not at the pickup',
  'Passenger asked me to cancel',
  'Pickup is too far or hard to reach',
  'Too many passengers or too much luggage',
  'Problem with my vehicle',
  'I don\'t feel safe',
];

/// The words for "something else": shows a box to write the reason.
const otherCancelReason = 'Something else';

/// What the person decided in [showCancelRideSheet].
class CancelChoice {
  const CancelChoice(this.reason);

  /// The reason they picked or wrote, or null when they chose not to say.
  final String? reason;
}

/// Asks "Why are you cancelling?" with optional reasons. Returns null when they keep the ride.
/// Picking a reason is never required: "Cancel ride" works with nothing chosen.
Future<CancelChoice?> showCancelRideSheet(
  BuildContext context, {
  required List<String> reasons,
  String title = 'Cancel this ride?',
  String? warning,
  String keepLabel = 'Keep ride',
  String cancelLabel = 'Cancel ride',
}) {
  return showModalBottomSheet<CancelChoice>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder:
        (sheet) => _CancelSheet(
          reasons: reasons,
          title: title,
          warning: warning,
          keepLabel: keepLabel,
          cancelLabel: cancelLabel,
        ),
  );
}

class _CancelSheet extends StatefulWidget {
  const _CancelSheet({
    required this.reasons,
    required this.title,
    required this.warning,
    required this.keepLabel,
    required this.cancelLabel,
  });
  final List<String> reasons;
  final String title;
  final String? warning;
  final String keepLabel;
  final String cancelLabel;

  @override
  State<_CancelSheet> createState() => _CancelSheetState();
}

class _CancelSheetState extends State<_CancelSheet> {
  String? _picked;
  final _other = TextEditingController();

  @override
  void dispose() {
    _other.dispose();
    super.dispose();
  }

  String? get _reason {
    if (_picked != otherCancelReason) return _picked;
    final text = _other.text.trim();
    return text.isEmpty ? null : text;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final options = [...widget.reasons, otherCancelReason];
    return SafeArea(
      child: Padding(
        // Keeps the "something else" box above the keyboard.
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(MusrideSpace.lg, 0, MusrideSpace.lg, MusrideSpace.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(widget.title, style: theme.textTheme.titleLarge),
              if (widget.warning != null) ...[
                const Gap(MusrideSpace.xs),
                Text(widget.warning!, style: theme.textTheme.bodyMedium),
              ],
              const Gap(MusrideSpace.md),
              Text(
                'Why are you cancelling? (optional)',
                style: theme.textTheme.titleSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const Gap(MusrideSpace.xs),
              for (final option in options)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    _picked == option ? Icons.radio_button_checked : Icons.radio_button_off,
                    color: _picked == option ? MusrideColors.sign : null,
                  ),
                  title: Text(option),
                  selected: _picked == option,
                  // Tapping the chosen reason again clears it: saying nothing is fine.
                  onTap: () => setState(() => _picked = _picked == option ? null : option),
                ),
              if (_picked == otherCancelReason)
                TextField(
                  controller: _other,
                  autofocus: true,
                  maxLength: 300,
                  maxLines: 3,
                  minLines: 1,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(hintText: 'Tell us what happened'),
                ),
              const Gap(MusrideSpace.md),
              MusrideButton(
                kind: MusrideButtonKind.danger,
                label: widget.cancelLabel,
                onPressed: () => Navigator.pop(context, CancelChoice(_reason)),
              ),
              const Gap(MusrideSpace.sm),
              MusrideButton(
                kind: MusrideButtonKind.quiet,
                label: widget.keepLabel,
                onPressed: () => Navigator.pop(context),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

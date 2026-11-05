import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../emergency.dart';
import '../design/components.dart';
import '../design/tokens.g.dart';

/// Emergency help, used by both apps.
///
/// The public emergency numbers come first and work without the internet: Musride staff are not
/// an emergency service. Opening the sheet also alerts Musride (with the trip and position) in the
/// background; if that fails, the numbers are still there and the failure is shown plainly.
Future<void> showEmergencySheet(
  BuildContext context, {
  required Future<void> Function() alertMusride,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _EmergencySheet(alertMusride: alertMusride),
  );
}

class _EmergencySheet extends StatefulWidget {
  const _EmergencySheet({required this.alertMusride});
  final Future<void> Function() alertMusride;

  @override
  State<_EmergencySheet> createState() => _EmergencySheetState();
}

enum _AlertState { sending, sent, failed }

class _EmergencySheetState extends State<_EmergencySheet> {
  _AlertState _alert = _AlertState.sending;

  @override
  void initState() {
    super.initState();
    _send();
  }

  Future<void> _send() async {
    setState(() => _alert = _AlertState.sending);
    try {
      await widget.alertMusride();
      if (mounted) setState(() => _alert = _AlertState.sent);
    } on Object {
      if (mounted) setState(() => _alert = _AlertState.failed);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(MusrideSpace.lg, 0, MusrideSpace.lg, MusrideSpace.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Emergency', style: theme.textTheme.headlineSmall),
            const Gap(MusrideSpace.xs),
            const Text('If you are in danger, call now.'),
            const Gap(MusrideSpace.md),
            for (final n in emergencyNumbers)
              Padding(
                padding: const EdgeInsets.only(bottom: MusrideSpace.sm),
                child: MusrideButton(
                  kind: MusrideButtonKind.emergency,
                  icon: Icons.call,
                  label: '${n.service}  ${n.number}',
                  onPressed: () => launchUrl(Uri(scheme: 'tel', path: n.number)),
                ),
              ),
            const Gap(MusrideSpace.sm),
            Row(
              children: [
                Icon(switch (_alert) {
                  _AlertState.sending => Icons.schedule,
                  _AlertState.sent => Icons.check_circle,
                  _AlertState.failed => Icons.error_outline,
                }, color: _alert == _AlertState.failed ? MusrideColors.signal : MusrideColors.sign),
                const Gap(MusrideSpace.sm),
                Expanded(
                  child: Text(switch (_alert) {
                    _AlertState.sending => 'Alerting Musride with your trip and location...',
                    _AlertState.sent => 'Musride has been alerted with your trip and location.',
                    _AlertState.failed => 'Could not reach Musride. Call the numbers above.',
                  }),
                ),
                if (_alert == _AlertState.failed)
                  MusrideButton(
                    kind: MusrideButtonKind.quiet,
                    compact: true,
                    label: 'Retry',
                    onPressed: _send,
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

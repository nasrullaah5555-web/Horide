import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../emergency.dart';
import '../theme.dart';

/// Emergency help, used by both apps.
///
/// The public emergency numbers come first and work without the internet: Horide staff are not
/// an emergency service. Opening the sheet also alerts Horide (with the trip and position) in the
/// background; if that fails, the numbers are still there and the failure is shown plainly.
Future<void> showEmergencySheet(
  BuildContext context, {
  required Future<void> Function() alertHoride,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _EmergencySheet(alertHoride: alertHoride),
  );
}

class _EmergencySheet extends StatefulWidget {
  const _EmergencySheet({required this.alertHoride});
  final Future<void> Function() alertHoride;

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
      await widget.alertHoride();
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
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Emergency', style: theme.textTheme.headlineSmall),
            const SizedBox(height: 4),
            const Text('If you are in danger, call now.'),
            const SizedBox(height: 12),
            for (final n in emergencyNumbers)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: HorideColors.signal,
                    minimumSize: const Size.fromHeight(kLargeTouchTarget),
                  ),
                  onPressed: () => launchUrl(Uri(scheme: 'tel', path: n.number)),
                  icon: const Icon(Icons.call),
                  label: Text('${n.service}  ${n.number}'),
                ),
              ),
            const SizedBox(height: 6),
            Row(
              children: [
                Icon(
                  switch (_alert) {
                    _AlertState.sending => Icons.schedule,
                    _AlertState.sent => Icons.check_circle,
                    _AlertState.failed => Icons.error_outline,
                  },
                  color: _alert == _AlertState.failed ? HorideColors.signal : HorideColors.sign,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(switch (_alert) {
                    _AlertState.sending => 'Alerting Horide with your trip and location...',
                    _AlertState.sent => 'Horide has been alerted with your trip and location.',
                    _AlertState.failed => 'Could not reach Horide. Call the numbers above.',
                  }),
                ),
                if (_alert == _AlertState.failed)
                  TextButton(onPressed: _send, child: const Text('Retry')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

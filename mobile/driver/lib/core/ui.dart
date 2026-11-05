import 'package:flutter/material.dart';
import 'package:horide_core/horide_core.dart';

/// Shows an API error in plain words. Network errors get the same treatment: the message
/// already explains what happened and what to do.
void showError(BuildContext context, Object error) {
  final message = error is ApiException ? error.message : 'Something went wrong. Please try again.';
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}

/// A labelled row used on receipts and trip summaries.
class InfoRow extends StatelessWidget {
  const InfoRow(this.label, this.value, {super.key, this.bold = false});
  final String label;
  final String value;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 120, child: Text(label, style: TextStyle(color: muted))),
          Expanded(
            child: Text(
              value,
              style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

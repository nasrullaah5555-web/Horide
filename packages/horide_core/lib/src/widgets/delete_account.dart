import 'package:flutter/material.dart';

import '../theme.dart';

/// Asks twice before deleting an account. Returns true only if the person typed DELETE.
Future<bool> confirmAccountDeletion(BuildContext context, {required String whatIsRemoved}) async {
  final typed = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (d) => StatefulBuilder(
      builder: (d, setState) => AlertDialog(
        title: const Text('Delete your account?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(whatIsRemoved),
            const SizedBox(height: 8),
            const Text(
              'Trip and payment records are kept without your name or phone number, as business '
              'records. This cannot be undone.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: typed,
              autocorrect: false,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(labelText: 'Type DELETE to confirm'),
              onChanged: (_) => setState(() {}),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Keep account')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: HorideColors.signal),
            onPressed: typed.text.trim() == 'DELETE' ? () => Navigator.pop(d, true) : null,
            child: const Text('Delete'),
          ),
        ],
      ),
    ),
  );
  typed.dispose();
  return ok ?? false;
}

import 'package:flutter/material.dart';

import '../design/components.dart';
import '../design/tokens.g.dart';

/// Asks twice before deleting an account. Returns true only if the person typed DELETE.
Future<bool> confirmAccountDeletion(BuildContext context, {required String whatIsRemoved}) async {
  final typed = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder:
        (d) => StatefulBuilder(
          builder:
              (d, setState) => AlertDialog(
                title: const Text('Delete your account?'),
                content: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(whatIsRemoved),
                    const Gap(MusrideSpace.sm),
                    const Text(
                      'Trip and payment records are kept without your name or phone number, as business '
                      'records. This cannot be undone.',
                    ),
                    const Gap(MusrideSpace.md),
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
                  MusrideButton(
                    kind: MusrideButtonKind.quiet,
                    compact: true,
                    label: 'Keep account',
                    onPressed: () => Navigator.pop(d, false),
                  ),
                  MusrideButton(
                    kind: MusrideButtonKind.quietDanger,
                    compact: true,
                    label: 'Delete',
                    onPressed: typed.text.trim() == 'DELETE' ? () => Navigator.pop(d, true) : null,
                  ),
                ],
              ),
        ),
  );
  typed.dispose();
  return ok ?? false;
}

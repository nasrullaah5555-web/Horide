import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:musride_core/musride_core.dart';

import '../../core/passenger_api.dart';
import '../../core/ui.dart';

/// Complaints go to Musride support staff (admin dashboard, Complaints).
class ComplaintScreen extends ConsumerStatefulWidget {
  const ComplaintScreen({super.key, this.tripId});
  final String? tripId;

  @override
  ConsumerState<ComplaintScreen> createState() => _ComplaintScreenState();
}

class _ComplaintScreenState extends ConsumerState<ComplaintScreen> {
  static const categories = <String, String>{
    'safety': 'Safety',
    'behaviour': 'Driver behaviour',
    'payment': 'Payment',
    'vehicle': 'Vehicle',
    'app': 'The app',
    'other': 'Something else',
  };

  String _category = 'other';
  final _text = TextEditingController();
  bool _busy = false;
  bool _sent = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_text.text.trim().length < 5) {
      showError(
        context,
        const ApiException(400, 'TOO_SHORT', 'Please describe the problem in a few words.'),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      await ref
          .read(passengerApiProvider)
          .complain(tripId: widget.tripId, category: _category, description: _text.text.trim());
      if (mounted) setState(() => _sent = true);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Report a problem')),
      body:
          _sent
              ? const Center(
                child: Padding(
                  padding: EdgeInsets.all(MusrideSpace.xl),
                  child: Text(
                    'Thank you. Musride support will review your report.\n\n'
                    'If you are in danger, use the Emergency button or call 991.',
                    textAlign: TextAlign.center,
                  ),
                ),
              )
              : ListView(
                padding: const EdgeInsets.all(MusrideSpace.lg),
                children: [
                  if (widget.tripId != null)
                    const Padding(
                      padding: EdgeInsets.only(bottom: MusrideSpace.md),
                      child: Text('This report will be linked to your trip.'),
                    ),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final e in categories.entries)
                        ChoiceChip(
                          label: Text(e.value),
                          selected: _category == e.key,
                          onSelected: (_) => setState(() => _category = e.key),
                        ),
                    ],
                  ),
                  const Gap(MusrideSpace.lg),
                  TextField(
                    controller: _text,
                    maxLength: 2000,
                    minLines: 4,
                    maxLines: 8,
                    decoration: const InputDecoration(hintText: 'Tell us what happened'),
                  ),
                  const Gap(MusrideSpace.sm),
                  MusrideButton(label: 'Send report', onPressed: _busy ? null : _send),
                ],
              ),
    );
  }
}

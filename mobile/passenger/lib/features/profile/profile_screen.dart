import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:musride_core/musride_core.dart';

import '../../core/passenger_api.dart';
import '../../core/providers.dart';
import '../../core/ui.dart';

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  final _name = TextEditingController();
  final _contact = TextEditingController();
  String? _phone;
  bool _loading = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _name.dispose();
    _contact.dispose();
    super.dispose();
  }

  void _fill(Map<String, dynamic> p) {
    _phone = p['phone'] as String?;
    _name.text = (p['full_name'] as String?) ?? '';
    _contact.text = (p['emergency_contact_phone'] as String?) ?? '';
  }

  Future<void> _load() async {
    try {
      final p = await ref.read(passengerApiProvider).profile();
      if (mounted) setState(() => _fill(p));
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    final contact = _contact.text.trim();
    if (contact.isNotEmpty &&
        normalizeMobile(contact, allowKenya: MusrideConfig.allowKenyanPhones) == null) {
      showError(
        context,
        ApiException(400, 'INVALID_PHONE', MusrideConfig.phoneHint),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      final p = await ref
          .read(passengerApiProvider)
          .updateProfile(
            fullName: _name.text.trim().isEmpty ? null : _name.text.trim(),
            emergencyContactPhone: contact.isEmpty ? null : contact,
          );
      if (!mounted) return;
      setState(() => _fill(p));
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Saved')));
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Your profile')),
      body:
          _loading
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                padding: const EdgeInsets.all(MusrideSpace.lg),
                children: [
                  if (_phone != null) InfoRow('Phone', _phone!),
                  const Gap(MusrideSpace.md),
                  TextField(
                    controller: _name,
                    maxLength: 120,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      labelText: 'Your name (shown to your driver)',
                    ),
                  ),
                  TextField(
                    controller: _contact,
                    keyboardType: TextInputType.phone,
                    maxLength: 25,
                    decoration: const InputDecoration(
                      labelText: 'Emergency contact phone (optional)',
                    ),
                  ),
                  const Gap(MusrideSpace.sm),
                  MusrideButton(label: 'Save', onPressed: _busy ? null : _save),
                  const Gap(MusrideSpace.lg),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.history),
                    title: const Text('Your trips and receipts'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => context.push('/history'),
                  ),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.notifications_outlined),
                    title: const Text('Notifications'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => context.push('/notifications'),
                  ),
                  const Gap(MusrideSpace.xl),
                  MusrideButton(
                    kind: MusrideButtonKind.secondary,
                    label: 'Sign out',
                    onPressed: () => ref.read(sessionProvider.notifier).signOut(),
                  ),
                  const Gap(MusrideSpace.xxl),
                  MusrideButton(
                    kind: MusrideButtonKind.quietDanger,
                    label: 'Delete my account',
                    onPressed: () async {
                      final ok = await confirmAccountDeletion(
                        context,
                        whatIsRemoved:
                            'Your phone number, name, emergency contact and saved places will be removed.',
                      );
                      if (!ok) return;
                      try {
                        await ref.read(sessionProvider.notifier).deleteAccount();
                      } catch (e) {
                        if (context.mounted) showError(context, e);
                      }
                    },
                  ),
                ],
              ),
    );
  }
}

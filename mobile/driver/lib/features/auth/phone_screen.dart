import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:musride_core/musride_core.dart';

import '../../core/providers.dart';
import '../../core/ui.dart';
import 'code_screen.dart';

/// Step 1 of login: the phone number. The same screen creates an account the first time.
class PhoneScreen extends ConsumerStatefulWidget {
  const PhoneScreen({super.key});

  @override
  ConsumerState<PhoneScreen> createState() => _PhoneScreenState();
}

class _PhoneScreenState extends ConsumerState<PhoneScreen> {
  final _phone = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final e164 = normalizeMobile(_phone.text, allowKenya: MusrideConfig.allowKenyanPhones);
    if (e164 == null) {
      setState(() => _error = MusrideConfig.phoneHint);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final challenge = await ref.read(authApiProvider).requestCode(e164);
      if (!mounted) return;
      context.push('/login/code', extra: CodeScreenArgs(phone: e164, challenge: challenge));
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            MusrideSpace.xl,
            MusrideSpace.xxl,
            MusrideSpace.xl,
            MusrideSpace.xl,
          ),
          children: [
            const MusrideLogo(),
            const Gap(MusrideSpace.sm),
            const HintText('Driver app · Drive in Jijiga'),
            const Gap(MusrideSpace.xxxl),
            Text('Your phone number', style: theme.textTheme.headlineMedium),
            const Gap(MusrideSpace.sm),
            Text(
              'We will send you a 6-digit code by SMS.',
              style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
            ),
            const Gap(MusrideSpace.xl),
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              autofillHints: const [AutofillHints.telephoneNumber],
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9+ ]'))],
              style: const TextStyle(
                fontSize: MusrideFontSize.titleLarge,
                fontWeight: MusrideFontWeight.bold,
                letterSpacing: MusrideLetterSpacing.phone,
              ),
              decoration: InputDecoration(hintText: '09XX XXX XXX', errorText: _error),
              onSubmitted: (_) => _submit(),
            ),
            const Gap(MusrideSpace.xl),
            MusrideButton(
              kind: MusrideButtonKind.go,
              label: _busy ? 'Sending code…' : 'Send code',
              onPressed: _busy ? null : _submit,
            ),
          ],
        ),
      ),
    );
  }
}

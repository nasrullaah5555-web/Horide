import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:horide_core/horide_core.dart';

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
    final e164 = normalizeEthiopianMobile(_phone.text);
    if (e164 == null) {
      setState(() => _error = 'Enter an Ethiopian mobile number, for example 0911 234 567.');
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
            HorideSpace.xl,
            HorideSpace.xxl,
            HorideSpace.xl,
            HorideSpace.xl,
          ),
          children: [
            const SignPanel(title: 'Horide', subtitle: 'Rides in Jijiga'),
            const Gap(HorideSpace.xxxl),
            Text('Your phone number', style: theme.textTheme.headlineMedium),
            const Gap(HorideSpace.sm),
            Text(
              'We will send you a 6-digit code by SMS.',
              style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
            ),
            const Gap(HorideSpace.xl),
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              autofillHints: const [AutofillHints.telephoneNumber],
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9+ ]'))],
              style: const TextStyle(
                fontSize: HorideFontSize.titleLarge,
                fontWeight: HorideFontWeight.bold,
                letterSpacing: HorideLetterSpacing.phone,
              ),
              decoration: InputDecoration(hintText: '09XX XXX XXX', errorText: _error),
              onSubmitted: (_) => _submit(),
            ),
            const Gap(HorideSpace.xl),
            HorideButton(
              kind: HorideButtonKind.go,
              label: _busy ? 'Sending code…' : 'Send code',
              onPressed: _busy ? null : _submit,
            ),
          ],
        ),
      ),
    );
  }
}

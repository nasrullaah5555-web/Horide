import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:horide_core/horide_core.dart';

import '../../core/providers.dart';
import '../../core/ui.dart';

class CodeScreenArgs {
  const CodeScreenArgs({required this.phone, required this.challenge});
  final String phone;
  final OtpChallenge challenge;
}

/// Step 2 of login: the SMS code.
class CodeScreen extends ConsumerStatefulWidget {
  const CodeScreen({super.key, required this.args});
  final CodeScreenArgs args;

  @override
  ConsumerState<CodeScreen> createState() => _CodeScreenState();
}

class _CodeScreenState extends ConsumerState<CodeScreen> {
  final _code = TextEditingController();
  late OtpChallenge _challenge = widget.args.challenge;
  Timer? _timer;
  int _resendIn = 0;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _startCountdown(_challenge.resendAfter);
  }

  void _startCountdown(Duration d) {
    _timer?.cancel();
    setState(() => _resendIn = d.inSeconds);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (_resendIn <= 1) t.cancel();
      if (mounted) setState(() => _resendIn = _resendIn > 0 ? _resendIn - 1 : 0);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _code.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    if (_code.text.length != 6 || _busy) return;
    setState(() => _busy = true);
    try {
      await ref
          .read(authApiProvider)
          .verifyCode(challengeId: _challenge.challengeId, code: _code.text, role: UserRole.passenger);
      ref.read(sessionProvider.notifier).signedIn();
      if (mounted) context.go('/');
    } catch (e) {
      _code.clear();
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resend() async {
    try {
      final c = await ref.read(authApiProvider).requestCode(widget.args.phone);
      setState(() => _challenge = c);
      _startCountdown(c.resendAfter);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
          children: [
            Text('Enter the code', style: theme.textTheme.headlineMedium),
            const SizedBox(height: 8),
            Text(
              'Sent by SMS to ${widget.args.phone}.',
              style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 24),
            TextField(
              controller: _code,
              autofocus: true,
              keyboardType: TextInputType.number,
              autofillHints: const [AutofillHints.oneTimeCode],
              maxLength: 6,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800, letterSpacing: 12),
              decoration: const InputDecoration(counterText: ''),
              onChanged: (v) {
                if (v.length == 6) _verify();
              },
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _busy ? null : _verify,
              child: Text(_busy ? 'Checking…' : 'Continue'),
            ),
            const SizedBox(height: 12),
            TextButton(
              onPressed: _resendIn > 0 ? null : _resend,
              child: Text(_resendIn > 0 ? 'Send a new code in $_resendIn s' : 'Send a new code'),
            ),
          ],
        ),
      ),
    );
  }
}

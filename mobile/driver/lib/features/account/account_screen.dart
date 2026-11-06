import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:musride_core/musride_core.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/driver_api.dart';
import '../../core/providers.dart';
import '../../core/ui.dart';
import '../home/home_screen.dart';
import '../onboarding/onboarding_screen.dart';

/// Who you are, your subscription, your vehicle and documents, help, and settings.
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final overview = ref.watch(overviewProvider);
    final subs = ref.watch(subscriptionProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Account')),
      body: RefreshIndicator(
        onRefresh: () {
          ref.invalidate(subscriptionProvider);
          return ref.refresh(overviewProvider.future);
        },
        child: ListView(
          padding: const EdgeInsets.symmetric(vertical: MusrideSpace.md),
          children: [
            overview.when(
              loading:
                  () => const Padding(
                    padding: EdgeInsets.all(MusrideSpace.xl),
                    child: Center(child: CircularProgressIndicator()),
                  ),
              error:
                  (e, _) => Padding(
                    padding: const EdgeInsets.all(MusrideSpace.lg),
                    child: MusrideNotice(
                      text: e is ApiException ? e.message : 'Could not load your account.',
                      action: MusrideButton(
                        kind: MusrideButtonKind.quiet,
                        compact: true,
                        label: 'Try again',
                        onPressed: () => ref.invalidate(overviewProvider),
                      ),
                    ),
                  ),
              data: (o) => _Header(overview: o),
            ),
            const _Heading('Subscription'),
            subs.when(
              loading: () => const ListTile(title: Text('Loading…')),
              error: (_, __) => const ListTile(title: Text('Could not load your subscription.')),
              data: (s) => _SubscriptionTile(active: s.$1),
            ),
            const _Heading('Your vehicle and documents'),
            ListTile(
              leading: const Icon(Icons.badge_outlined),
              title: const Text('Vehicle and documents'),
              subtitle: Text(
                overview.valueOrNull == null
                    ? 'Name, vehicle, licence and ID'
                    : (overview.valueOrNull!.eligibility.eligible
                        ? 'Ready to drive'
                        : 'Something still needs your attention'),
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/onboarding'),
            ),
            const _Heading('Help'),
            ListTile(
              leading: const Icon(Icons.support_agent),
              title: const Text('Report a problem'),
              subtitle: const Text('Safety, payment, a passenger, the app'),
              onTap: () => _report(context, ref),
            ),
            ListTile(
              leading: const Icon(Icons.call_outlined),
              title: const Text('Call Musride support'),
              subtitle: const Text(MusrideContact.supportPhoneDisplay),
              onTap: () => launchUrl(Uri(scheme: 'tel', path: MusrideContact.supportPhone)),
            ),
            ListTile(
              leading: const Icon(Icons.mail_outline),
              title: const Text('Email Musride'),
              subtitle: const Text(MusrideContact.supportEmail),
              onTap: () => launchUrl(Uri(scheme: 'mailto', path: MusrideContact.supportEmail)),
            ),
            const _Heading('Settings'),
            ListTile(
              leading: const Icon(Icons.logout),
              title: const Text('Sign out'),
              onTap: () => ref.read(sessionProvider.notifier).signOut(),
            ),
            ListTile(
              leading: const Icon(Icons.delete_outline, color: MusrideColors.signal),
              title: const Text('Delete my account', style: TextStyle(color: MusrideColors.signal)),
              onTap: () async {
                final ok = await confirmAccountDeletion(
                  context,
                  whatIsRemoved:
                      'Your phone number, name, documents and location will be removed, '
                      'and your vehicle can no longer be used for rides.',
                );
                if (!ok) return;
                try {
                  await ref.read(sessionProvider.notifier).deleteAccount();
                } catch (e) {
                  if (context.mounted) showError(context, e);
                }
              },
            ),
            const Gap(MusrideSpace.lg),
          ],
        ),
      ),
    );
  }

  Future<void> _report(BuildContext context, WidgetRef ref) async {
    final text = TextEditingController();
    var category = 'other';
    const categories = {
      'safety': 'Safety',
      'payment': 'Payment',
      'behaviour': 'A passenger',
      'vehicle': 'Vehicle',
      'app': 'The app',
      'other': 'Something else',
    };
    final sent = await showDialog<bool>(
      context: context,
      builder:
          (d) => StatefulBuilder(
            builder:
                (d, setState) => AlertDialog(
                  title: const Text('Report a problem'),
                  content: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      DropdownButtonFormField<String>(
                        initialValue: category,
                        decoration: const InputDecoration(labelText: 'About'),
                        items: [
                          for (final e in categories.entries)
                            DropdownMenuItem(value: e.key, child: Text(e.value)),
                        ],
                        onChanged: (v) => setState(() => category = v ?? 'other'),
                      ),
                      const Gap(MusrideSpace.sm),
                      TextField(
                        controller: text,
                        maxLength: 1000,
                        maxLines: 4,
                        minLines: 2,
                        decoration: const InputDecoration(
                          hintText: 'What happened? (at least 10 characters)',
                        ),
                        onChanged: (_) => setState(() {}),
                      ),
                    ],
                  ),
                  actions: [
                    MusrideButton(
                      kind: MusrideButtonKind.quiet,
                      compact: true,
                      label: 'Back',
                      onPressed: () => Navigator.pop(d),
                    ),
                    MusrideButton(
                      compact: true,
                      label: 'Send',
                      onPressed: text.text.trim().length < 10 ? null : () => Navigator.pop(d, true),
                    ),
                  ],
                ),
          ),
    );
    final description = text.text.trim();
    text.dispose();
    if (sent != true) return;
    try {
      await ref.read(driverApiProvider).complain(category: category, description: description);
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Sent. Musride staff will contact you.')));
      }
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.overview});
  final DriverOverview overview;

  @override
  Widget build(BuildContext context) {
    final p = overview.profile;
    final name = overview.fullName;
    final count = (p['rating_count'] as num?)?.toInt() ?? 0;
    final avg = p['rating_avg'];
    final (status, ok) = switch (overview.approvalStatus) {
      'approved' => ('Approved driver', true),
      'rejected' => ('Not approved', false),
      'suspended' => ('Suspended', false),
      _ => ('Waiting for Musride review', false),
    };
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        MusrideSpace.lg,
        MusrideSpace.sm,
        MusrideSpace.lg,
        MusrideSpace.md,
      ),
      child: Row(
        children: [
          InitialAvatar(name),
          const Gap(MusrideSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name ?? 'Add your name', style: Theme.of(context).textTheme.titleLarge),
                if (p['phone'] != null) HintText(p['phone'] as String),
                const Gap(MusrideSpace.xxs),
                StatusText(status, ok: ok),
                HintText(
                  count == 0
                      ? 'No ratings yet'
                      : '★ ${num.parse(avg.toString()).toStringAsFixed(1)} from $count trips',
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SubscriptionTile extends StatelessWidget {
  const _SubscriptionTile({required this.active});
  final Subscription? active;

  @override
  Widget build(BuildContext context) {
    final s = active;
    if (s == null) {
      return const ListTile(
        leading: Icon(Icons.event_busy, color: MusrideColors.signal),
        title: Text('No active subscription'),
        subtitle: Text('Pay at the Musride office to receive ride requests.'),
      );
    }
    final days = s.endsAt.difference(DateTime.now()).inDays;
    return ListTile(
      leading: const Icon(Icons.event_available, color: MusrideColors.sign),
      title: Text(s.planName),
      subtitle: Text(
        'Active until ${formatInboxTime(s.endsAt).split(',').first}'
        ' (${days <= 0 ? 'ends today' : '$days days left'})',
      ),
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(
      MusrideSpace.lg,
      MusrideSpace.lg,
      MusrideSpace.lg,
      MusrideSpace.xs,
    ),
    child: Text(
      text.toUpperCase(),
      style: Theme.of(context).textTheme.labelMedium?.copyWith(
        color: Theme.of(context).colorScheme.onSurfaceVariant,
        letterSpacing: MusrideLetterSpacing.plate,
      ),
    ),
  );
}

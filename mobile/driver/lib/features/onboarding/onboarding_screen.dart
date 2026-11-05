import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:horide_core/horide_core.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/driver_api.dart';
import '../../core/providers.dart';
import '../../core/ui.dart';
import '../home/home_screen.dart';

final subscriptionProvider = FutureProvider.autoDispose(
  (ref) => ref.watch(driverApiProvider).subscriptions(),
);

/// Account, vehicle, documents and subscription: everything Horide checks before a driver can
/// go online. Documents are reviewed by Horide staff; nothing here approves itself.
class OnboardingScreen extends ConsumerWidget {
  const OnboardingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final overview = ref.watch(overviewProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Account and documents')),
      body: overview.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error:
            (e, _) => Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(e is ApiException ? e.message : 'Could not load your account.'),
                  TextButton(
                    onPressed: () => ref.invalidate(overviewProvider),
                    child: const Text('Try again'),
                  ),
                ],
              ),
            ),
        data:
            (o) => RefreshIndicator(
              onRefresh: () => ref.refresh(overviewProvider.future),
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  SignPanel(
                    title: o.eligibility.eligible ? 'Ready to drive' : 'Not ready yet',
                    subtitle:
                        o.eligibility.eligible
                            ? 'You can go online.'
                            : o.eligibility.reasons
                                .map((r) => Eligibility.reasonText[r] ?? r)
                                .join('\n'),
                    tone: o.eligibility.eligible ? SignTone.go : SignTone.calm,
                  ),
                  const SizedBox(height: 20),
                  _Section(
                    title: '1. Your name',
                    child: _NameForm(initial: o.fullName, locked: o.approvalStatus == 'approved'),
                  ),
                  _Section(title: '2. Your vehicle', child: _VehicleSection(vehicle: o.vehicle)),
                  _Section(title: '3. Documents', child: _Documents(overview: o)),
                  const _Section(title: '4. Monthly subscription', child: _SubscriptionSection()),
                  TextButton(
                    style: TextButton.styleFrom(foregroundColor: HorideColors.signal),
                    onPressed: () async {
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
                    child: const Text('Delete my account'),
                  ),
                ],
              ),
            ),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 24),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        child,
      ],
    ),
  );
}

class _NameForm extends ConsumerStatefulWidget {
  const _NameForm({required this.initial, required this.locked});
  final String? initial;
  final bool locked;

  @override
  ConsumerState<_NameForm> createState() => _NameFormState();
}

class _NameFormState extends ConsumerState<_NameForm> {
  late final _name = TextEditingController(text: widget.initial ?? '');
  bool _busy = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.locked) return InfoRow('Name', '${widget.initial ?? ''} (verified)');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _name,
          maxLength: 120,
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(labelText: 'Full name, as on your National ID'),
        ),
        OutlinedButton(
          onPressed:
              _busy
                  ? null
                  : () async {
                    if (_name.text.trim().isEmpty) return;
                    setState(() => _busy = true);
                    try {
                      await ref.read(driverApiProvider).setName(_name.text.trim());
                      ref.invalidate(overviewProvider);
                    } catch (e) {
                      if (context.mounted) showError(context, e);
                    } finally {
                      if (mounted) setState(() => _busy = false);
                    }
                  },
          child: const Text('Save name'),
        ),
      ],
    );
  }
}

class _VehicleSection extends ConsumerStatefulWidget {
  const _VehicleSection({required this.vehicle});
  final DriverVehicle? vehicle;

  @override
  ConsumerState<_VehicleSection> createState() => _VehicleSectionState();
}

class _VehicleSectionState extends ConsumerState<_VehicleSection> {
  VehicleCategory _category = VehicleCategory.bajaj;
  final _make = TextEditingController();
  final _model = TextEditingController();
  final _colour = TextEditingController();
  final _year = TextEditingController();
  final _plate = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    for (final c in [_make, _model, _colour, _year, _plate]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if ([_make, _model, _colour, _plate].any((c) => c.text.trim().isEmpty)) {
      showError(
        context,
        const ApiException(400, 'REQUIRED', 'Fill in make, model, colour and plate.'),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      await ref
          .read(driverApiProvider)
          .addVehicle(
            category: _category,
            make: _make.text.trim(),
            model: _model.text.trim(),
            colour: _colour.text.trim(),
            year: int.tryParse(_year.text.trim()),
            plateNumber: _plate.text.trim(),
          );
      ref.invalidate(overviewProvider);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final v = widget.vehicle;
    if (v != null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InfoRow('Vehicle', '${vehicleLabel(v.category)}: ${v.description}'),
          InfoRow('Plate', v.plate),
          InfoRow('Status', _status(v.approvalStatus)),
        ],
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SegmentedButton<VehicleCategory>(
          segments: const [
            ButtonSegment(value: VehicleCategory.bajaj, label: Text('Bajaj')),
            ButtonSegment(value: VehicleCategory.car, label: Text('Car')),
          ],
          selected: {_category},
          onSelectionChanged: (s) => setState(() => _category = s.first),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _make,
          maxLength: 40,
          decoration: const InputDecoration(labelText: 'Make (e.g. Bajaj, Toyota)'),
        ),
        TextField(
          controller: _model,
          maxLength: 40,
          decoration: const InputDecoration(labelText: 'Model'),
        ),
        TextField(
          controller: _colour,
          maxLength: 30,
          decoration: const InputDecoration(labelText: 'Colour'),
        ),
        TextField(
          controller: _year,
          maxLength: 4,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Year (optional)'),
        ),
        TextField(
          controller: _plate,
          maxLength: 15,
          textCapitalization: TextCapitalization.characters,
          decoration: const InputDecoration(labelText: 'Plate number'),
        ),
        FilledButton(onPressed: _busy ? null : _save, child: const Text('Add vehicle')),
      ],
    );
  }
}

String _status(String s) => switch (s) {
  'pending' => 'Waiting for Horide review',
  'approved' => 'Approved',
  'rejected' => 'Rejected',
  'expired' => 'Expired',
  _ => s,
};

class _Documents extends ConsumerStatefulWidget {
  const _Documents({required this.overview});
  final DriverOverview overview;

  @override
  ConsumerState<_Documents> createState() => _DocumentsState();
}

class _DocumentsState extends ConsumerState<_Documents> {
  String? _uploading;

  Future<void> _upload(String type, ImageSource source) async {
    final vehicle = widget.overview.vehicle;
    if (vehicleDocuments.contains(type) && vehicle == null) {
      showError(context, const ApiException(400, 'VEHICLE_REQUIRED', 'Add your vehicle first.'));
      return;
    }
    // Resized and compressed on the phone: smaller uploads on a weak connection, still readable.
    final file = await ImagePicker().pickImage(
      source: source,
      maxWidth: 2000,
      maxHeight: 2000,
      imageQuality: 80,
      preferredCameraDevice: type == 'profile_photo' ? CameraDevice.front : CameraDevice.rear,
    );
    if (file == null) return;
    setState(() => _uploading = type);
    try {
      await ref
          .read(driverApiProvider)
          .uploadDocument(
            type: type,
            vehicleId: vehicleDocuments.contains(type) ? vehicle!.id : null,
            bytes: await file.readAsBytes(),
            filename: file.name,
          );
      ref.invalidate(overviewProvider);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _uploading = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final o = widget.overview;
    return Column(
      children: [
        for (final entry in documentLabels.entries)
          Builder(
            builder: (context) {
              final doc = o.latest(entry.key);
              final missing = o.eligibility.missingDocuments.contains(entry.key);
              return ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(entry.value),
                subtitle: Text(
                  doc == null
                      ? (missing ? 'Required' : 'Not uploaded')
                      : doc.status == 'rejected'
                      ? 'Rejected: ${doc.rejectionReason ?? 'upload a clearer photo'}'
                      : _status(doc.status),
                  style: TextStyle(
                    color:
                        doc?.status == 'rejected' || (doc == null && missing)
                            ? HorideColors.signal
                            : null,
                  ),
                ),
                trailing:
                    _uploading == entry.key
                        ? const SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(strokeWidth: 3),
                        )
                        : doc?.status == 'approved'
                        ? const Icon(Icons.check_circle, color: HorideColors.sign)
                        : PopupMenuButton<ImageSource>(
                          tooltip: 'Upload',
                          icon: const Icon(Icons.upload),
                          onSelected: (s) => _upload(entry.key, s),
                          itemBuilder:
                              (_) => const [
                                PopupMenuItem(
                                  value: ImageSource.camera,
                                  child: Text('Take a photo'),
                                ),
                                PopupMenuItem(
                                  value: ImageSource.gallery,
                                  child: Text('Choose from gallery'),
                                ),
                              ],
                        ),
              );
            },
          ),
        const SizedBox(height: 6),
        Text(
          'Your documents are stored privately and only Horide verification staff can see them.',
          style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
      ],
    );
  }
}

class _SubscriptionSection extends ConsumerWidget {
  const _SubscriptionSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final subs = ref.watch(subscriptionProvider);
    return subs.when(
      loading: () => const LinearProgressIndicator(),
      error: (e, _) => Text(e is ApiException ? e.message : 'Could not load your subscription.'),
      data: (d) {
        final active = d.$1;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (active == null)
              const Text(
                'No active subscription. Pay your monthly subscription at the Horide office; staff '
                'will record it and you can go online right away.',
              )
            else ...[
              InfoRow('Plan', active.planName),
              InfoRow('Valid until', active.endsAt.toLocal().toString().substring(0, 16)),
              if (active.endsAt.difference(DateTime.now()).inDays < 3)
                const Text(
                  'Your subscription ends soon. Renew it to keep receiving rides. A trip in progress '
                  'is never interrupted.',
                  style: TextStyle(color: HorideColors.amber, fontWeight: FontWeight.w700),
                ),
            ],
          ],
        );
      },
    );
  }
}

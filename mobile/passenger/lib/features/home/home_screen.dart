import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:musride_core/musride_core.dart';

import '../../core/passenger_api.dart';
import '../../core/ui.dart';
import '../trip/trip_controller.dart';

/// Map-first booking: move the map to set the pickup, choose a destination, see the server's
/// price for each vehicle type, book.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  final _map = MapController();
  final _pickupText = TextEditingController();
  Place? _destination;
  List<Quote>? _quotes;
  VehicleCategory _category = VehicleCategory.car;
  PaymentMethod _payment = PaymentMethod.cash;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    currentPosition().then((p) {
      if (p != null && mounted) _map.move(p, 16);
    });
  }

  @override
  void dispose() {
    _pickupText.dispose();
    super.dispose();
  }

  Place get _pickup => Place(
    toPoint(_map.camera.center),
    _pickupText.text.trim().isEmpty ? null : _pickupText.text.trim(),
  );

  Future<void> _chooseDestination() async {
    final place = await PlacePicker.open(
      context,
      title: 'Where to?',
      confirmLabel: 'Set destination',
      start: _map.camera.center,
    );
    if (place == null || !mounted) return;
    setState(() => _destination = place);
    await _loadQuotes();
  }

  Future<void> _loadQuotes() async {
    final destination = _destination;
    if (destination == null) return;
    setState(() {
      _busy = true;
      _quotes = null;
    });
    try {
      final pickup = _pickup;
      final quotes = await ref
          .read(passengerApiProvider)
          .quotes(
            pickup: pickup.point,
            destination: destination.point,
            pickupText: pickup.text,
            destinationText: destination.text,
            paymentMethod: _payment,
          );
      if (mounted) setState(() => _quotes = quotes);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _book(Quote quote) async {
    if (quote.expiresAt.isBefore(DateTime.now())) {
      await _loadQuotes(); // prices are valid for 5 minutes; fetch fresh ones
      return;
    }
    setState(() => _busy = true);
    try {
      final trip = await ref.read(passengerApiProvider).book(quote.quoteToken);
      ref.read(activeTripProvider.notifier).show(trip);
      if (mounted) context.go('/trip');
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // An open trip always takes over the screen (e.g. after reopening the app mid-ride).
    ref.listen(activeTripProvider, (_, next) {
      final trip = next.valueOrNull;
      if (trip != null && !trip.status.isFinal) context.go('/trip');
    });

    return Scaffold(
      body: Stack(
        children: [
          FlutterMap(
            mapController: _map,
            options: MapOptions(
              initialCenter: jijiga,
              initialZoom: 15,
              onPositionChanged: (_, hasGesture) {
                // Moving the pickup makes the old prices wrong.
                if (hasGesture && _quotes != null) setState(() => _quotes = null);
              },
            ),
            children: [
              ...baseMapLayers(),
              if (_destination != null)
                MarkerLayer(
                  markers: [pinMarker(_destination!.point, MusrideColors.navy, 'Destination')],
                ),
              mapAttribution(),
            ],
          ),
          const Center(child: CentrePin(colour: MusrideColors.sign, label: 'Pickup point')),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(MusrideSpace.md),
              child: Row(
                children: [
                  MusrideRoundButton(
                    icon: Icons.menu,
                    label: 'Menu',
                    onPressed: () => _openMenu(context),
                  ),
                  const Spacer(),
                  MusrideRoundButton(
                    icon: Icons.my_location,
                    label: 'Go to my location',
                    onPressed: () async {
                      final p = await currentPosition();
                      if (p != null) _map.move(p, 16);
                    },
                  ),
                ],
              ),
            ),
          ),
          Align(alignment: Alignment.bottomCenter, child: _bottomPanel(context)),
        ],
      ),
    );
  }

  Widget _bottomPanel(BuildContext context) {
    final quotes = _quotes;
    return MusrideBottomPanel(
      children: [
        TextField(
          controller: _pickupText,
          maxLength: 200,
          decoration: const InputDecoration(
            prefixIcon: Icon(Icons.trip_origin, color: MusrideColors.sign),
            hintText: 'Pickup landmark (helps the driver find you)',
            counterText: '',
          ),
        ),
        const Gap(MusrideSpace.md),
        MusrideButton(
          kind: MusrideButtonKind.secondary,
          icon: Icons.place,
          label:
              _destination == null
                  ? 'Where to?'
                  : (_destination!.text ?? 'Destination set on the map'),
          onPressed: _busy ? null : _chooseDestination,
        ),
        _SavedPlacesRow(
          onPick: (place) async {
            setState(() => _destination = Place(place.point, place.label));
            await _loadQuotes();
          },
          current: _destination,
        ),
        if (_busy && quotes == null) ...[
          const Gap(MusrideSpace.lg),
          const Center(child: CircularProgressIndicator()),
        ],
        if (quotes != null) ...[
          const Gap(MusrideSpace.lg),
          for (final q in quotes)
            Padding(
              padding: const EdgeInsets.only(bottom: MusrideSpace.sm),
              child: OptionTile(
                selected: q.category == _category,
                onTap: () => setState(() => _category = q.category),
                icon:
                    q.category == VehicleCategory.car
                        ? Icons.directions_car
                        : Icons.electric_rickshaw,
                title: vehicleLabel(q.category),
                subtitle:
                    '${formatKm(q.distanceMetres)}, about ${formatMinutes(q.durationSeconds)}'
                    '${q.isEstimate ? ' (estimate)' : ''}',
                trailing: formatEtbShort(q.fare),
              ),
            ),
          const Gap(MusrideSpace.sm),
          SegmentedButton<PaymentMethod>(
            segments: const [
              ButtonSegment(
                value: PaymentMethod.cash,
                label: Text('Cash'),
                icon: Icon(Icons.payments_outlined),
              ),
              ButtonSegment(
                value: PaymentMethod.ebirr,
                label: Text('eBirr'),
                icon: Icon(Icons.phone_android),
              ),
            ],
            selected: {_payment},
            onSelectionChanged: (s) {
              setState(() => _payment = s.first);
              _loadQuotes(); // the price is tied to the payment method in the quote
            },
          ),
          const Gap(MusrideSpace.sm),
          const HintText(
            'You pay the driver directly. Musride does not take payment in the app.',
            center: true,
          ),
          const Gap(MusrideSpace.md),
          Builder(
            builder: (context) {
              final selected = quotes.where((q) => q.category == _category).firstOrNull;
              if (selected == null) return const SizedBox.shrink();
              return MusrideButton(
                label:
                    'Book ${vehicleLabel(selected.category).toLowerCase()} for ${formatEtbShort(selected.fare)}',
                onPressed: _busy ? null : () => _book(selected),
              );
            },
          ),
        ],
      ],
    );
  }

  void _openMenu(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder:
          (sheet) => SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ListTile(
                  leading: const Icon(Icons.history),
                  title: const Text('Your trips'),
                  onTap: () {
                    Navigator.pop(sheet);
                    context.push('/history');
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.support_agent),
                  title: const Text('Report a problem'),
                  onTap: () {
                    Navigator.pop(sheet);
                    context.push('/complaint');
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.person_outline),
                  title: const Text('Your profile'),
                  onTap: () {
                    Navigator.pop(sheet);
                    context.push('/profile');
                  },
                ),
              ],
            ),
          ),
    );
  }
}

/// Saved places as one-tap destinations, plus "Save" for the destination just chosen.
class _SavedPlacesRow extends ConsumerWidget {
  const _SavedPlacesRow({required this.onPick, required this.current});
  final ValueChanged<SavedPlace> onPick;
  final Place? current;

  Future<void> _save(BuildContext context, WidgetRef ref, Place place) async {
    final label = TextEditingController(text: place.text ?? '');
    final name = await showDialog<String>(
      context: context,
      builder:
          (d) => AlertDialog(
            title: const Text('Save this place'),
            content: TextField(
              controller: label,
              maxLength: 40,
              autofocus: true,
              decoration: const InputDecoration(hintText: 'Name, e.g. Home or Work'),
            ),
            actions: [
              MusrideButton(compact: true, 
                kind: MusrideButtonKind.quiet,
                label: 'Cancel',
                onPressed: () => Navigator.pop(d),
              ),
              MusrideButton(compact: true, label: 'Save', onPressed: () => Navigator.pop(d, label.text.trim())),
            ],
          ),
    );
    label.dispose();
    if (name == null || name.isEmpty) return;
    try {
      await ref.read(passengerApiProvider).savePlace(name, place.point, place.text);
      ref.invalidate(savedPlacesProvider);
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }

  Future<void> _delete(BuildContext context, WidgetRef ref, SavedPlace p) async {
    final ok = await showDialog<bool>(
      context: context,
      builder:
          (d) => AlertDialog(
            title: Text('Remove "${p.label}"?'),
            actions: [
              MusrideButton(compact: true, 
                kind: MusrideButtonKind.quiet,
                label: 'Keep',
                onPressed: () => Navigator.pop(d, false),
              ),
              MusrideButton(compact: true, label: 'Remove', onPressed: () => Navigator.pop(d, true)),
            ],
          ),
    );
    if (ok != true) return;
    try {
      await ref.read(passengerApiProvider).deleteSavedPlace(p.id);
      ref.invalidate(savedPlacesProvider);
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final places = ref.watch(savedPlacesProvider).valueOrNull ?? const <SavedPlace>[];
    final place = current;
    final alreadySaved =
        place != null &&
        places.any((p) => p.point.lat == place.point.lat && p.point.lng == place.point.lng);
    if (places.isEmpty && (place == null || alreadySaved)) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: MusrideSpace.sm),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            for (final p in places)
              Padding(
                padding: const EdgeInsets.only(right: MusrideSpace.sm),
                child: GestureDetector(
                  onLongPress: () => _delete(context, ref, p),
                  child: ActionChip(
                    avatar: const Icon(Icons.bookmark, size: MusrideSize.iconSmall),
                    label: Text(p.label),
                    tooltip: 'Go to ${p.label} (hold to remove)',
                    onPressed: () => onPick(p),
                  ),
                ),
              ),
            if (place != null && !alreadySaved)
              ActionChip(
                avatar: const Icon(Icons.bookmark_add_outlined, size: MusrideSize.iconSmall),
                label: const Text('Save this place'),
                onPressed: () => _save(context, ref, place),
              ),
          ],
        ),
      ),
    );
  }
}

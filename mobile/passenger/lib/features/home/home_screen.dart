import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart' show Distance, LengthUnit;
import 'package:musride_core/musride_core.dart';

import '../../core/passenger_api.dart';
import '../../core/providers.dart';
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

  /// True once the passenger typed their own pickup note; then it's never overwritten.
  bool _pickupTyped = false;
  Timer? _naming;

  /// Moves the map to the phone's position. Only once the map is on screen: moving it before
  /// does nothing, which left the map on Jijiga for a passenger in Nairobi (2026-11-06).
  Future<void> _goToMe() async {
    final p = await currentPosition();
    if (!mounted) return;
    if (p == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Your location is off, so the map can\'t find you. Turn on location, '
            'or search for your pickup.',
          ),
        ),
      );
      return;
    }
    _map.move(p, 16);
    await _namePickup();
  }

  /// Fills the pickup with the name of the place under the pin ("Current location" style), unless
  /// the passenger wrote their own note.
  Future<void> _namePickup() async {
    if (_pickupTyped) return;
    final at = toPoint(_map.camera.center);
    try {
      final name = await ref.read(placesApiProvider).reverse(at);
      final now = _map.camera.center;
      if (!mounted || _pickupTyped || now.latitude != at.lat || now.longitude != at.lng) return;
      setState(() => _pickupText.text = name ?? '');
    } on ApiException {
      // No name: the pin position is what counts; the passenger can type a landmark.
    }
  }

  Future<void> _choosePickup() async {
    final place = await PlacePicker.open(
      context,
      title: 'Pickup',
      confirmLabel: 'Set pickup here',
      start: _map.camera.center,
      places: ref.read(placesApiProvider),
    );
    if (place == null || !mounted) return;
    _map.move(toLatLng(place.point), 17);
    setState(() {
      _pickupText.text = place.text ?? '';
      _pickupTyped = place.text != null;
      _quotes = null;
    });
    if (_destination != null) await _loadQuotes();
  }

  @override
  void dispose() {
    _naming?.cancel();
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
      places: ref.read(placesApiProvider),
    );
    if (place == null || !mounted) return;
    setState(() => _destination = place);
    await _loadQuotes();
  }

  Future<void> _loadQuotes() async {
    final destination = _destination;
    if (destination == null) return;
    final metres = const Distance().as(
      LengthUnit.Meter,
      _map.camera.center,
      toLatLng(destination.point),
    );
    if (metres < 150) {
      showError(
        context,
        const ApiException(
          422,
          'SAME_PLACE',
          'Your destination is where your pickup is. Search for the destination by name, '
              'or move its pin to the place.',
        ),
      );
      return;
    }
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
              initialCenter: marketCentre,
              initialZoom: 15,
              onMapReady: _goToMe,
              onPositionChanged: (_, hasGesture) {
                if (!hasGesture) return;
                // Moving the pickup makes the old prices wrong.
                if (_quotes != null) setState(() => _quotes = null);
                _naming?.cancel();
                _naming = Timer(const Duration(milliseconds: 700), _namePickup);
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
                    onPressed: () {
                      _pickupTyped = false;
                      _goToMe();
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
          onChanged: (v) => _pickupTyped = v.trim().isNotEmpty,
          decoration: InputDecoration(
            prefixIcon: const Icon(Icons.trip_origin, color: MusrideColors.sign),
            hintText: 'Pickup: your location, or type a landmark',
            counterText: '',
            suffixIcon: IconButton(
              tooltip: 'Search for a pickup place',
              icon: const Icon(Icons.search),
              onPressed: _busy ? null : _choosePickup,
            ),
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
            // The methods used in this city: cash and eBirr in Jijiga, cash and M-Pesa in Nairobi.
            segments: [
              for (final m in Market.current.paymentMethods)
                ButtonSegment(
                  value: m,
                  label: Text(paymentLabel(m)),
                  icon: Icon(
                    m == PaymentMethod.cash ? Icons.payments_outlined : Icons.phone_android,
                  ),
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
                  leading: const Icon(Icons.notifications_outlined),
                  title: const Text('Notifications'),
                  onTap: () {
                    Navigator.pop(sheet);
                    context.push('/notifications');
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
              MusrideButton(
                compact: true,
                kind: MusrideButtonKind.quiet,
                label: 'Cancel',
                onPressed: () => Navigator.pop(d),
              ),
              MusrideButton(
                compact: true,
                label: 'Save',
                onPressed: () => Navigator.pop(d, label.text.trim()),
              ),
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
              MusrideButton(
                compact: true,
                kind: MusrideButtonKind.quiet,
                label: 'Keep',
                onPressed: () => Navigator.pop(d, false),
              ),
              MusrideButton(
                compact: true,
                label: 'Remove',
                onPressed: () => Navigator.pop(d, true),
              ),
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

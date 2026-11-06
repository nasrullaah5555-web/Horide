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

/// Booking, Faras/Bolt style: the pickup starts at the phone's position, the destination is
/// searched by name, both show on the map (green dot, navy square, a dashed line between), and the
/// server's price for each vehicle type appears. Moving the map only looks around: it never moves
/// the pickup (it did until 2026-11-06, which made the two points easy to mix up).
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

/// The share of the screen the bottom panel can cover; the map keeps both points above it.
const _panelShare = 0.55;

class _HomeScreenState extends ConsumerState<HomeScreen> {
  final _map = MapController();
  final _landmark = TextEditingController();
  Place? _pickup;
  Place? _destination;
  List<Quote>? _quotes;
  VehicleCategory _category = VehicleCategory.car;
  PaymentMethod _payment = PaymentMethod.cash;
  bool _busy = false;
  bool _locating = false;

  /// The pickup words the current prices were made with (the driver sees the ones in the quote).
  String? _quotedPickupText;

  @override
  void dispose() {
    _landmark.dispose();
    super.dispose();
  }

  /// Sets the pickup to the phone's position. Only once the map is on screen: moving it before
  /// does nothing, which left the map on Jijiga for a passenger in Nairobi (2026-11-06).
  Future<void> _pickupHere() async {
    setState(() => _locating = true);
    final p = await currentPosition();
    if (!mounted) return;
    setState(() => _locating = false);
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
    String? name;
    try {
      name = await ref.read(placesApiProvider).reverse(toPoint(p));
    } on ApiException {
      // No name: the position is what counts; the passenger can add a landmark.
    }
    if (!mounted) return;
    await _setPickup(Place(toPoint(p), name));
  }

  Future<void> _setPickup(Place place) async {
    setState(() {
      _pickup = place;
      _quotes = null;
    });
    _showOnMap();
    if (_destination != null) await _loadQuotes();
  }

  /// Both points in view above the panel, or the one that is set.
  void _showOnMap() {
    final a = _pickup?.point;
    final b = _destination?.point;
    if (a != null && b != null) {
      _map.fitCamera(
        fitTrip(a, b, bottom: MediaQuery.sizeOf(context).height * _panelShare),
      );
    } else if (a != null || b != null) {
      _map.move(toLatLng((a ?? b)!), 16);
    }
  }

  Future<void> _choosePickup() async {
    final place = await PlacePicker.open(
      context,
      title: 'Pickup',
      confirmLabel: 'Set pickup here',
      start: _pickup == null ? null : toLatLng(_pickup!.point),
      places: ref.read(placesApiProvider),
      offerCurrentLocation: true,
      other: _destination == null ? null : OtherEnd.destination(_destination!.point),
    );
    if (place == null || !mounted) return;
    await _setPickup(place);
  }

  Future<void> _chooseDestination() async {
    final place = await PlacePicker.open(
      context,
      title: 'Where to?',
      confirmLabel: 'Set destination',
      start: _pickup == null ? null : toLatLng(_pickup!.point),
      places: ref.read(placesApiProvider),
      other: _pickup == null ? null : OtherEnd.pickup(_pickup!.point),
    );
    if (place == null || !mounted) return;
    await _setDestination(place);
  }

  Future<void> _setDestination(Place place) async {
    setState(() {
      _destination = place;
      _quotes = null;
    });
    _showOnMap();
    await _loadQuotes();
  }

  /// What the driver reads as the pickup: the place's name, plus the passenger's landmark.
  String? get _pickupText {
    final parts = [_pickup?.text?.trim(), _landmark.text.trim()]
        .whereType<String>()
        .where((t) => t.isNotEmpty);
    final text = parts.join(' · ');
    if (text.isEmpty) return null;
    return text.length <= 200 ? text : text.substring(0, 200);
  }

  Future<void> _loadQuotes() async {
    final pickup = _pickup;
    final destination = _destination;
    if (pickup == null || destination == null) return;
    final metres = const Distance().as(
      LengthUnit.Meter,
      toLatLng(pickup.point),
      toLatLng(destination.point),
    );
    if (metres < 150) {
      showError(
        context,
        const ApiException(
          422,
          'SAME_PLACE',
          'Your destination is where your pickup is. Search for the destination by name.',
        ),
      );
      return;
    }
    setState(() {
      _busy = true;
      _quotes = null;
    });
    final pickupText = _pickupText;
    try {
      final quotes = await ref
          .read(passengerApiProvider)
          .quotes(
            pickup: pickup.point,
            destination: destination.point,
            pickupText: pickupText,
            destinationText: destination.text,
            paymentMethod: _payment,
          );
      if (mounted) {
        setState(() {
          _quotes = quotes;
          _quotedPickupText = pickupText;
        });
      }
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _book(Quote chosen) async {
    var quote = chosen;
    // A landmark typed after the prices came, or prices older than 5 minutes: get fresh ones
    // first, so the driver sees the landmark and the price is current.
    if (_pickupText != _quotedPickupText || quote.expiresAt.isBefore(DateTime.now())) {
      await _loadQuotes();
      final fresh = _quotes?.where((q) => q.category == chosen.category).firstOrNull;
      if (fresh == null || !mounted) return;
      if (fresh.fare != chosen.fare) return; // the new price is on screen; let them decide
      quote = fresh;
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

    final pickup = _pickup;
    final destination = _destination;
    return Scaffold(
      body: Stack(
        children: [
          FlutterMap(
            mapController: _map,
            options: MapOptions(
              initialCenter: marketCentre,
              initialZoom: 15,
              interactionOptions: mapInteraction,
              onMapReady: _pickupHere,
            ),
            children: [
              ...baseMapLayers(),
              if (pickup != null && destination != null) tripLine(pickup.point, destination.point),
              MarkerLayer(
                markers: [
                  if (pickup != null) pickupMarker(pickup.point),
                  if (destination != null) destinationMarker(destination.point),
                ],
              ),
              mapAttribution(),
            ],
          ),
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
                    label: 'Pick me up where I am',
                    onPressed: () {
                      if (!_locating && !_busy) _pickupHere();
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
    final pickup = _pickup;
    final destination = _destination;
    return MusrideBottomPanel(
      children: [
        _PlaceField(
          icon: Icons.trip_origin,
          colour: MusrideColors.sign,
          label: 'Pickup',
          hint: _locating ? 'Finding your location…' : 'Where should the driver pick you up?',
          value:
              pickup == null ? null : (pickup.text ?? 'Pin on the map (no street name)'),
          onTap: _busy ? null : _choosePickup,
        ),
        const Gap(MusrideSpace.sm),
        _PlaceField(
          icon: Icons.square_rounded,
          colour: MusrideColors.navy,
          label: 'Destination',
          hint: 'Where to?',
          value:
              destination == null
                  ? null
                  : (destination.text ?? 'Pin on the map (no street name)'),
          onTap: _busy ? null : _chooseDestination,
        ),
        if (pickup != null) ...[
          const Gap(MusrideSpace.sm),
          TextField(
            controller: _landmark,
            maxLength: 120,
            textInputAction: TextInputAction.done,
            onSubmitted: (_) => _loadQuotes(),
            decoration: const InputDecoration(
              isDense: true,
              hintText: 'Landmark for the driver (optional), e.g. blue gate',
              prefixIcon: Icon(Icons.edit_note),
              counterText: '',
            ),
          ),
        ],
        _SavedPlacesRow(
          onPick: (place) => _setDestination(Place(place.point, place.label)),
          current: destination,
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

/// A pickup or destination row: looks like a text box, opens the place search when tapped.
class _PlaceField extends StatelessWidget {
  const _PlaceField({
    required this.icon,
    required this.colour,
    required this.label,
    required this.hint,
    required this.value,
    required this.onTap,
  });
  final IconData icon;
  final Color colour;
  final String label;
  final String hint;
  final String? value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: value == null ? '$label: $hint' : '$label: $value. Tap to change.',
      excludeSemantics: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(MusrideRadius.control),
        child: InputDecorator(
          isEmpty: value == null,
          decoration: InputDecoration(
            prefixIcon: Icon(icon, color: colour),
            hintText: hint,
            suffixIcon: const Icon(Icons.search),
          ),
          child: Text(value ?? '', maxLines: 1, overflow: TextOverflow.ellipsis),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:horide_core/horide_core.dart';

import '../../core/map.dart';
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

  Place get _pickup => Place(toPoint(_map.camera.center), _pickupText.text.trim().isEmpty ? null : _pickupText.text.trim());

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
      final quotes = await ref.read(passengerApiProvider).quotes(
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
                  markers: [
                    Marker(
                      point: toLatLng(_destination!.point),
                      width: 30,
                      height: 44,
                      alignment: Alignment.topCenter,
                      child: const MapPin(colour: HorideColors.navy, label: 'Destination'),
                    ),
                  ],
                ),
              mapAttribution(),
            ],
          ),
          const Center(
            child: IgnorePointer(
              child: Padding(
                padding: EdgeInsets.only(bottom: 40),
                child: MapPin(colour: HorideColors.sign, label: 'Pickup point'),
              ),
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  _RoundButton(icon: Icons.menu, label: 'Menu', onTap: () => _openMenu(context)),
                  const Spacer(),
                  _RoundButton(
                    icon: Icons.my_location,
                    label: 'Go to my location',
                    onTap: () async {
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
    final theme = Theme.of(context);
    final quotes = _quotes;
    return Material(
      color: theme.colorScheme.surface,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
      elevation: 8,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _pickupText,
                maxLength: 200,
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.trip_origin, color: HorideColors.sign),
                  hintText: 'Pickup landmark (helps the driver find you)',
                  counterText: '',
                ),
              ),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: _busy ? null : _chooseDestination,
                icon: const Icon(Icons.place),
                label: Text(_destination == null ? 'Where to?' : (_destination!.text ?? 'Destination set on the map')),
              ),
              if (_busy && quotes == null) ...[
                const SizedBox(height: 16),
                const Center(child: CircularProgressIndicator()),
              ],
              if (quotes != null) ...[
                const SizedBox(height: 14),
                for (final q in quotes) _QuoteTile(quote: q, selected: q.category == _category, onTap: () => setState(() => _category = q.category)),
                const SizedBox(height: 8),
                SegmentedButton<PaymentMethod>(
                  segments: const [
                    ButtonSegment(value: PaymentMethod.cash, label: Text('Cash'), icon: Icon(Icons.payments_outlined)),
                    ButtonSegment(value: PaymentMethod.ebirr, label: Text('eBirr'), icon: Icon(Icons.phone_android)),
                  ],
                  selected: {_payment},
                  onSelectionChanged: (s) {
                    setState(() => _payment = s.first);
                    _loadQuotes(); // the price is tied to the payment method in the quote
                  },
                ),
                const SizedBox(height: 6),
                Text(
                  'You pay the driver directly. Horide does not take payment in the app.',
                  style: TextStyle(color: theme.colorScheme.onSurfaceVariant, fontSize: 13),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 10),
                Builder(builder: (context) {
                  final selected = quotes.where((q) => q.category == _category).firstOrNull;
                  if (selected == null) return const SizedBox.shrink();
                  return FilledButton(
                    onPressed: _busy ? null : () => _book(selected),
                    child: Text('Book ${vehicleLabel(selected.category).toLowerCase()} for ${formatEtbShort(selected.fare)}'),
                  );
                }),
              ],
            ],
          ),
        ),
      ),
    );
  }

  void _openMenu(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheet) => SafeArea(
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

class _QuoteTile extends StatelessWidget {
  const _QuoteTile({required this.quote, required this.selected, required this.onTap});
  final Quote quote;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Semantics(
        selected: selected,
        button: true,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            constraints: const BoxConstraints(minHeight: kLargeTouchTarget + 8),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: selected ? HorideColors.sign : theme.colorScheme.outline, width: selected ? 2.5 : 1),
            ),
            child: Row(
              children: [
                Icon(quote.category == VehicleCategory.car ? Icons.directions_car : Icons.electric_rickshaw, size: 30),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(vehicleLabel(quote.category), style: theme.textTheme.titleMedium),
                      Text(
                        '${formatKm(quote.distanceMetres)}, about ${formatMinutes(quote.durationSeconds)}'
                        '${quote.isEstimate ? ' (estimate)' : ''}',
                        style: TextStyle(color: theme.colorScheme.onSurfaceVariant, fontSize: 13),
                      ),
                    ],
                  ),
                ),
                Text(formatEtbShort(quote.fare), style: theme.textTheme.titleLarge),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).colorScheme.surface,
      shape: const CircleBorder(),
      elevation: 3,
      child: IconButton(
        iconSize: 26,
        constraints: const BoxConstraints(minWidth: kLargeTouchTarget, minHeight: kLargeTouchTarget),
        tooltip: label,
        icon: Icon(icon),
        onPressed: onTap,
      ),
    );
  }
}

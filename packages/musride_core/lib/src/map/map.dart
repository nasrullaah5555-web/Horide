import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_client.dart';
import '../config.dart';
import '../market.dart';
import '../design/components.dart';
import '../design/markers.dart';
import '../design/tokens.g.dart';
import '../models/models.dart';
import 'places.dart';

/// Maps used by both apps: same tiles, same pins, same place picker.

LatLng toLatLng(LatLngPoint p) => LatLng(p.lat, p.lng);
LatLngPoint toPoint(LatLng p) => LatLngPoint(p.latitude, p.longitude);

const jijiga = LatLng(MusrideConfig.jijigaLat, MusrideConfig.jijigaLng);

/// Where maps start before the phone has a position: the market's city centre.
LatLng get marketCentre => toLatLng(Market.current.centre);

/// Each app identifies itself to the tile server (OpenStreetMap's usage policy asks for this).
String _userAgent = 'et.musride';
void configureMaps({required String appId}) => _userAgent = appId;

/// OpenStreetMap tiles. OSM's public servers are for light use; production needs a tile
/// provider that allows app traffic (OWNER_ACTION_REGISTER OA-20).
List<Widget> baseMapLayers() => [
  TileLayer(
    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    userAgentPackageName: _userAgent,
    maxZoom: 19,
  ),
];

Widget mapAttribution() => RichAttributionWidget(
  attributions: [
    TextSourceAttribution(
      'OpenStreetMap contributors',
      onTap: () => launchUrl(Uri.parse('https://www.openstreetmap.org/copyright')),
    ),
  ],
);

/// A pin as a flutter_map marker, with its tip on the point.
Marker pinMarker(LatLngPoint p, Color colour, String label) => Marker(
  point: toLatLng(p),
  width: MapPin.width,
  height: MapPin.height,
  alignment: Alignment.topCenter,
  child: MapPin(colour: colour, label: label),
);

/// The fixed pin in the middle of a map that the person moves the map under.
class CentrePin extends StatelessWidget {
  const CentrePin({super.key, required this.colour, required this.label});
  final Color colour;
  final String label;

  @override
  Widget build(BuildContext context) => IgnorePointer(
    child: Padding(
      // Lift the pin so its tip, not its middle, marks the centre of the map.
      padding: const EdgeInsets.only(bottom: MapPin.height),
      child: MapPin(colour: colour, label: label),
    ),
  );
}

/// Current position if the person allows location; null otherwise (the map still works by
/// moving the pin by hand).
Future<LatLng?> currentPosition() async {
  try {
    if (!await Geolocator.isLocationServiceEnabled()) return null;
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
      return null;
    }
    final p = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 10),
      ),
    );
    return LatLng(p.latitude, p.longitude);
  } on Exception {
    return null;
  }
}

/// Every Musride map: pan and zoom, never rotate. A turned map made streets hard to recognise and
/// a two-finger zoom often rotated it by accident (owner's phone video, 2026-11-06).
const mapInteraction = InteractionOptions(flags: InteractiveFlag.all & ~InteractiveFlag.rotate);

/// The pickup's round green dot on a map.
Marker pickupMarker(LatLngPoint p) => Marker(
  point: toLatLng(p),
  width: PickupMarker.size,
  height: PickupMarker.size,
  child: const PickupMarker(),
);

/// The destination's navy square on a map.
Marker destinationMarker(LatLngPoint p) => Marker(
  point: toLatLng(p),
  width: DestinationMarker.size,
  height: DestinationMarker.size,
  child: const DestinationMarker(),
);

/// A dashed line from pickup to destination. It shows which way the trip goes, not the road the
/// driver takes (the price uses the road distance from the server).
Widget tripLine(LatLngPoint from, LatLngPoint to) => PolylineLayer(
  polylines: [
    Polyline(
      points: [toLatLng(from), toLatLng(to)],
      color: MusrideColors.navy,
      strokeWidth: MusrideStroke.signBorder,
      pattern: StrokePattern.dashed(segments: const [MusrideSpace.sm, MusrideSpace.sm]),
    ),
  ],
);

/// Fits pickup and destination on screen, above a bottom panel covering [bottom] pixels.
CameraFit fitTrip(LatLngPoint a, LatLngPoint b, {required double bottom}) => CameraFit.coordinates(
  coordinates: [toLatLng(a), toLatLng(b)],
  maxZoom: 17,
  padding: EdgeInsets.fromLTRB(MusrideSpace.xxxl, MusrideSpace.xxxl, MusrideSpace.xxxl, bottom),
);

/// The other end of the trip, shown while choosing this one so the two can't be confused.
class OtherEnd {
  const OtherEnd.pickup(this.point) : isPickup = true;
  const OtherEnd.destination(this.point) : isPickup = false;
  final LatLngPoint point;
  final bool isPickup;
}

/// Choose a place, search first (like Faras and Bolt): type a name and tap a result, or use the
/// current location. The map with a fixed pin is only the fallback for a spot with no name
/// ("Choose on the map"). Returns the place, or null if cancelled.
class PlacePicker extends StatefulWidget {
  const PlacePicker({
    super.key,
    required this.title,
    required this.confirmLabel,
    this.start,
    this.places,
    this.offerCurrentLocation = false,
    this.other,
  });
  final String title;
  final String confirmLabel;

  /// Where searches are biased to and where the map opens.
  final LatLng? start;

  /// Place search through the server; without it only the map can be used.
  final PlacesApi? places;

  /// Shows "Use my current location" first (for the pickup).
  final bool offerCurrentLocation;

  /// The trip's other end, drawn on the map.
  final OtherEnd? other;

  static Future<Place?> open(
    BuildContext context, {
    required String title,
    required String confirmLabel,
    LatLng? start,
    PlacesApi? places,
    bool offerCurrentLocation = false,
    OtherEnd? other,
  }) {
    return Navigator.of(context).push<Place>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder:
            (_) => PlacePicker(
              title: title,
              confirmLabel: confirmLabel,
              start: start,
              places: places,
              offerCurrentLocation: offerCurrentLocation,
              other: other,
            ),
      ),
    );
  }

  @override
  State<PlacePicker> createState() => _PlacePickerState();
}

class _PlacePickerState extends State<PlacePicker> {
  final _map = MapController();
  final _query = TextEditingController();
  final _session = PlacesApi.newSession();
  Timer? _typing;
  Timer? _moving;
  List<PlaceSuggestion> _results = const [];
  bool _searching = false;
  bool _locating = false;
  String? _searchError;

  /// Map mode: the person moves the map under a fixed pin. Search mode otherwise.
  late bool _onMap = widget.places == null;

  /// The name of the spot under the pin, looked up after the map stops moving.
  String? _name;

  @override
  void dispose() {
    _typing?.cancel();
    _moving?.cancel();
    _query.dispose();
    super.dispose();
  }

  void _onTyping(String text) {
    _typing?.cancel();
    final q = text.trim();
    if (q.length < 2 || widget.places == null) {
      setState(() {
        _results = const [];
        _searchError = null;
      });
      return;
    }
    // Wait until the person pauses, so a search isn't sent for every letter.
    _typing = Timer(const Duration(milliseconds: 400), () async {
      setState(() => _searching = true);
      try {
        final start = widget.start ?? marketCentre;
        final found = await widget.places!.search(q, near: toPoint(start), session: _session);
        if (!mounted || _query.text.trim() != q) return;
        setState(() {
          _results = found;
          _searchError =
              found.isEmpty ? 'Nothing found. Try another name, or choose on the map.' : null;
        });
      } on ApiException catch (e) {
        if (mounted) setState(() => _searchError = e.message);
      } finally {
        if (mounted) setState(() => _searching = false);
      }
    });
  }

  /// A result is the answer: no pin to move afterwards.
  Future<void> _choose(PlaceSuggestion s) async {
    FocusScope.of(context).unfocus();
    try {
      final place = await widget.places!.details(s, session: _session);
      if (mounted) Navigator.of(context).pop(Place(place.point, place.text ?? s.name));
    } on ApiException catch (e) {
      if (mounted) setState(() => _searchError = e.message);
    }
  }

  Future<void> _useCurrentLocation() async {
    setState(() => _locating = true);
    final p = await currentPosition();
    if (!mounted) return;
    if (p == null) {
      setState(() => _locating = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Your location is off. Turn on location, or search for the place.'),
        ),
      );
      return;
    }
    String? name;
    try {
      name = await widget.places?.reverse(toPoint(p));
    } on ApiException {
      // No name: the position is what counts.
    }
    if (mounted) Navigator.of(context).pop(Place(toPoint(p), name));
  }

  void _showMap() {
    FocusScope.of(context).unfocus();
    setState(() {
      _onMap = true;
      _name = null;
    });
  }

  /// After the person moves the map, name the new spot (a moment after they stop).
  void _onMapMoved(MapCamera _, bool byPerson) {
    if (!byPerson) return;
    setState(() => _name = null);
    _moving?.cancel();
    _moving = Timer(const Duration(milliseconds: 700), _nameUnderPin);
  }

  Future<void> _nameUnderPin() async {
    final api = widget.places;
    if (api == null || !mounted) return;
    final at = toPoint(_map.camera.center);
    try {
      final name = await api.reverse(at);
      final now = _map.camera.center;
      // Only if the pin hasn't moved again while waiting for the answer.
      if (mounted && _name == null && now.latitude == at.lat && now.longitude == at.lng) {
        setState(() => _name = name);
      }
    } on ApiException {
      // No name is fine: the pin position is what counts.
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          if (_onMap && widget.places != null)
            IconButton(
              tooltip: 'Search by name',
              icon: const Icon(Icons.search),
              onPressed: () => setState(() => _onMap = false),
            ),
        ],
      ),
      body: _onMap ? _mapView(context) : _searchView(context),
    );
  }

  Widget _searchView(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            MusrideSpace.lg,
            MusrideSpace.xs,
            MusrideSpace.lg,
            MusrideSpace.sm,
          ),
          child: TextField(
            controller: _query,
            autofocus: true,
            textInputAction: TextInputAction.search,
            onChanged: _onTyping,
            decoration: InputDecoration(
              hintText: 'Search for a place, area or street',
              prefixIcon: const Icon(Icons.search),
              suffixIcon:
                  _searching
                      ? const Padding(
                        padding: EdgeInsets.all(MusrideSpace.md),
                        child: PanelSpinner(),
                      )
                      : (_query.text.isEmpty
                          ? null
                          : IconButton(
                            tooltip: 'Clear',
                            icon: const Icon(Icons.close),
                            onPressed: () {
                              _query.clear();
                              _onTyping('');
                            },
                          )),
            ),
          ),
        ),
        Expanded(
          child: ListView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            children: [
              if (widget.offerCurrentLocation)
                ListTile(
                  leading:
                      _locating
                          ? const PanelSpinner()
                          : const Icon(Icons.my_location, color: MusrideColors.sign),
                  title: const Text('Use my current location'),
                  onTap: _locating ? null : _useCurrentLocation,
                ),
              if (_searchError != null)
                ListTile(leading: const Icon(Icons.info_outline), title: Text(_searchError!)),
              for (final r in _results)
                ListTile(
                  leading: const Icon(Icons.place_outlined),
                  title: Text(r.name),
                  subtitle: r.detail == null ? null : Text(r.detail!),
                  onTap: () => _choose(r),
                ),
              ListTile(
                leading: const Icon(Icons.map_outlined),
                title: const Text('Choose on the map'),
                subtitle: const Text('For a spot without a name'),
                onTap: _showMap,
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _mapView(BuildContext context) {
    final other = widget.other;
    return Column(
      children: [
        Expanded(
          child: Stack(
            alignment: Alignment.center,
            children: [
              FlutterMap(
                mapController: _map,
                options: MapOptions(
                  initialCenter: widget.start ?? marketCentre,
                  initialZoom: 17,
                  interactionOptions: mapInteraction,
                  onMapReady: _nameUnderPin,
                  onPositionChanged: _onMapMoved,
                ),
                children: [
                  ...baseMapLayers(),
                  if (other != null)
                    MarkerLayer(
                      markers: [
                        other.isPickup ? pickupMarker(other.point) : destinationMarker(other.point),
                      ],
                    ),
                  mapAttribution(),
                ],
              ),
              // Green when choosing the pickup, navy for the destination, as on the main map.
              CentrePin(
                colour: widget.offerCurrentLocation ? MusrideColors.sign : MusrideColors.navy,
                label: 'Chosen place',
              ),
            ],
          ),
        ),
        MusrideBottomPanel(
          children: [
            Text(
              _name ?? 'Drag the map so the pin is on the place',
              style: Theme.of(context).textTheme.titleMedium,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const Gap(MusrideSpace.md),
            MusrideButton(
              label: widget.confirmLabel,
              onPressed: () => Navigator.of(context).pop(Place(toPoint(_map.camera.center), _name)),
            ),
          ],
        ),
      ],
    );
  }
}

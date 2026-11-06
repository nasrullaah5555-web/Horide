import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_client.dart';
import '../config.dart';
import '../design/components.dart';
import '../design/markers.dart';
import '../design/tokens.g.dart';
import '../models/models.dart';
import 'places.dart';

/// Maps used by both apps: same tiles, same pins, same place picker.

LatLng toLatLng(LatLngPoint p) => LatLng(p.lat, p.lng);
LatLngPoint toPoint(LatLng p) => LatLngPoint(p.latitude, p.longitude);

const jijiga = LatLng(MusrideConfig.jijigaLat, MusrideConfig.jijigaLng);

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

/// Full-screen map to choose a place: search by name (with suggestions) or move the map under
/// the fixed pin. Returns the chosen point and its name, or null if cancelled.
class PlacePicker extends StatefulWidget {
  const PlacePicker({
    super.key,
    required this.title,
    required this.confirmLabel,
    this.start,
    this.places,
  });
  final String title;
  final String confirmLabel;
  final LatLng? start;

  /// Place search through the server; without it only the map can be used.
  final PlacesApi? places;

  static Future<Place?> open(
    BuildContext context, {
    required String title,
    required String confirmLabel,
    LatLng? start,
    PlacesApi? places,
  }) {
    return Navigator.of(context).push<Place>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder:
            (_) =>
                PlacePicker(title: title, confirmLabel: confirmLabel, start: start, places: places),
      ),
    );
  }

  @override
  State<PlacePicker> createState() => _PlacePickerState();
}

class _PlacePickerState extends State<PlacePicker> {
  final _map = MapController();
  final _query = TextEditingController();
  final _focus = FocusNode();
  final _session = PlacesApi.newSession();
  Timer? _typing;
  Timer? _moving;
  List<PlaceSuggestion> _results = const [];
  bool _searching = false;
  String? _searchError;

  /// The name of the place under the pin: from a chosen suggestion, or looked up after moving.
  String? _name;

  @override
  void initState() {
    super.initState();
    _focus.addListener(() => setState(() {}));
    WidgetsBinding.instance.addPostFrameCallback((_) => _nameUnderPin());
  }

  @override
  void dispose() {
    _typing?.cancel();
    _moving?.cancel();
    _query.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _onTyping(String text) {
    _typing?.cancel();
    final q = text.trim();
    if (q.length < 2 || widget.places == null) {
      setState(() => _results = const []);
      return;
    }
    // Wait until the person pauses, so a search isn't sent for every letter.
    _typing = Timer(const Duration(milliseconds: 400), () async {
      setState(() => _searching = true);
      try {
        final found = await widget.places!.search(
          q,
          near: toPoint(_map.camera.center),
          session: _session,
        );
        if (!mounted || _query.text.trim() != q) return;
        setState(() {
          _results = found;
          _searchError = found.isEmpty ? 'Nothing found. Try another name, or move the map.' : null;
        });
      } on ApiException catch (e) {
        if (mounted) setState(() => _searchError = e.message);
      } finally {
        if (mounted) setState(() => _searching = false);
      }
    });
  }

  Future<void> _choose(PlaceSuggestion s) async {
    _focus.unfocus();
    try {
      final place = await widget.places!.details(s, session: _session);
      if (!mounted) return;
      _map.move(toLatLng(place.point), 17);
      setState(() {
        _name = place.text ?? s.name;
        _query.text = s.name;
        _results = const [];
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _searchError = e.message);
    }
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
    final showList = _focus.hasFocus && (_results.isNotEmpty || _searchError != null);
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Column(
        children: [
          if (widget.places != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                MusrideSpace.lg,
                MusrideSpace.xs,
                MusrideSpace.lg,
                MusrideSpace.sm,
              ),
              child: TextField(
                controller: _query,
                focusNode: _focus,
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
                                  setState(() => _results = const []);
                                },
                              )),
                ),
              ),
            ),
          Expanded(
            child: Stack(
              alignment: Alignment.center,
              children: [
                FlutterMap(
                  mapController: _map,
                  options: MapOptions(
                    initialCenter: widget.start ?? jijiga,
                    initialZoom: 16,
                    onPositionChanged: _onMapMoved,
                  ),
                  children: [...baseMapLayers(), mapAttribution()],
                ),
                const CentrePin(colour: MusrideColors.navy, label: 'Chosen place'),
                if (showList)
                  Positioned.fill(
                    child: Material(
                      color: theme.colorScheme.surface,
                      child: ListView(
                        children: [
                          if (_searchError != null) ListTile(title: Text(_searchError!)),
                          for (final r in _results)
                            ListTile(
                              leading: const Icon(Icons.place_outlined),
                              title: Text(r.name),
                              subtitle: r.detail == null ? null : Text(r.detail!),
                              onTap: () => _choose(r),
                            ),
                          ListTile(
                            leading: const Icon(Icons.map_outlined),
                            title: const Text('Choose on the map instead'),
                            onTap: () => _focus.unfocus(),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
          MusrideBottomPanel(
            children: [
              Text(
                _name ?? 'Move the map so the pin is on the place',
                style: theme.textTheme.titleMedium,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              const Gap(MusrideSpace.md),
              MusrideButton(
                label: widget.confirmLabel,
                onPressed:
                    () => Navigator.of(context).pop(Place(toPoint(_map.camera.center), _name)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config.dart';
import '../design/components.dart';
import '../design/markers.dart';
import '../design/tokens.g.dart';
import '../models/models.dart';

/// Maps used by both apps: same tiles, same pins, same place picker.

LatLng toLatLng(LatLngPoint p) => LatLng(p.lat, p.lng);
LatLngPoint toPoint(LatLng p) => LatLngPoint(p.latitude, p.longitude);

const jijiga = LatLng(HorideConfig.jijigaLat, HorideConfig.jijigaLng);

/// Each app identifies itself to the tile server (OpenStreetMap's usage policy asks for this).
String _userAgent = 'et.horide';
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
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
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

/// Full-screen map to choose a place by moving the map under a fixed pin.
/// Returns the chosen point and an optional description, or null if cancelled.
class PlacePicker extends StatefulWidget {
  const PlacePicker({super.key, required this.title, required this.confirmLabel, this.start});
  final String title;
  final String confirmLabel;
  final LatLng? start;

  static Future<Place?> open(
    BuildContext context, {
    required String title,
    required String confirmLabel,
    LatLng? start,
  }) {
    return Navigator.of(context).push<Place>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => PlacePicker(title: title, confirmLabel: confirmLabel, start: start),
      ),
    );
  }

  @override
  State<PlacePicker> createState() => _PlacePickerState();
}

class _PlacePickerState extends State<PlacePicker> {
  final _map = MapController();
  final _text = TextEditingController();

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Column(
        children: [
          Expanded(
            child: Stack(
              alignment: Alignment.center,
              children: [
                FlutterMap(
                  mapController: _map,
                  options: MapOptions(initialCenter: widget.start ?? jijiga, initialZoom: 16),
                  children: [...baseMapLayers(), mapAttribution()],
                ),
                const CentrePin(colour: HorideColors.navy, label: 'Chosen place'),
              ],
            ),
          ),
          HorideBottomPanel(
            children: [
              TextField(
                controller: _text,
                maxLength: 200,
                decoration: const InputDecoration(
                  hintText: 'Name or landmark (optional)',
                  counterText: '',
                ),
              ),
              const Gap(HorideSpace.md),
              HorideButton(
                label: widget.confirmLabel,
                onPressed: () => Navigator.of(context).pop(
                  Place(
                    toPoint(_map.camera.center),
                    _text.text.trim().isEmpty ? null : _text.text.trim(),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

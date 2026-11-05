import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:horide_core/horide_core.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

LatLng toLatLng(LatLngPoint p) => LatLng(p.lat, p.lng);
LatLngPoint toPoint(LatLng p) => LatLngPoint(p.latitude, p.longitude);

const jijiga = LatLng(HorideConfig.jijigaLat, HorideConfig.jijigaLng);

/// OpenStreetMap tiles. OSM's public servers are for light use; production needs a tile
/// provider that allows app traffic (OWNER_ACTION_REGISTER OA-20).
List<Widget> baseMapLayers() => [
      TileLayer(
        urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        userAgentPackageName: 'et.horide.passenger',
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

/// Current position if the passenger allows location; null otherwise (the map still works
/// by moving the pin by hand).
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

/// A map pin drawn in Flutter (no image assets needed).
class MapPin extends StatelessWidget {
  const MapPin({super.key, required this.colour, this.label});
  final Color colour;
  final String? label;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 26,
            height: 26,
            decoration: BoxDecoration(
              color: colour,
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 4),
              boxShadow: const [BoxShadow(color: Color(0x4014283E), blurRadius: 6)],
            ),
          ),
          Container(width: 3, height: 14, color: colour),
        ],
      ),
    );
  }
}

/// Full-screen map to choose a place by moving the map under a fixed pin.
/// Returns the chosen point and an optional description, or null if cancelled.
class PlacePicker extends StatefulWidget {
  const PlacePicker({super.key, required this.title, required this.confirmLabel, this.start});
  final String title;
  final String confirmLabel;
  final LatLng? start;

  static Future<Place?> open(BuildContext context, {required String title, required String confirmLabel, LatLng? start}) {
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
                const IgnorePointer(
                  child: Padding(
                    padding: EdgeInsets.only(bottom: 40),
                    child: MapPin(colour: HorideColors.navy, label: 'Chosen place'),
                  ),
                ),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: _text,
                    maxLength: 200,
                    decoration: const InputDecoration(
                      hintText: 'Name or landmark (optional)',
                      counterText: '',
                    ),
                  ),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: () => Navigator.of(context).pop(
                      Place(toPoint(_map.camera.center), _text.text.trim().isEmpty ? null : _text.text.trim()),
                    ),
                    child: Text(widget.confirmLabel),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

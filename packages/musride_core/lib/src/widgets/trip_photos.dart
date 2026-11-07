import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../design/tokens.g.dart';
import '../models/models.dart';

/// The driver's face and the car for one trip, as small JPEGs (ADR-027). Either can be missing:
/// staff have not approved one yet, or the driver never added a car photo.
class TripPhotos {
  const TripPhotos({this.driver, this.vehicle});
  final Uint8List? driver;
  final Uint8List? vehicle;

  static const none = TripPhotos();

  static TripPhotos fromJson(Map<String, dynamic> j) =>
      TripPhotos(driver: _image(j['driver']), vehicle: _image(j['vehicle']));

  static Uint8List? _image(Object? v) {
    if (v is! Map<String, dynamic>) return null;
    final data = v['data'];
    if (data is! String || data.isEmpty) return null;
    try {
      return base64Decode(data);
    } on FormatException {
      return null;
    }
  }
}

/// Round photo of the driver; their initial on green when there is no approved photo.
class DriverPhoto extends StatelessWidget {
  const DriverPhoto({super.key, required this.name, this.photo});
  final String? name;
  final Uint8List? photo;

  @override
  Widget build(BuildContext context) {
    final n = name?.trim() ?? '';
    const size = MusrideSize.driverPhoto;
    return Semantics(
      image: true,
      label: photo == null ? null : 'Photo of ${n.isEmpty ? 'your driver' : n}',
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: MusrideColors.sign,
          border: Border.all(color: MusrideColors.white, width: MusrideStroke.focus),
        ),
        clipBehavior: Clip.antiAlias,
        child:
            photo == null
                ? Center(
                  child: Text(
                    n.isEmpty ? '?' : n[0].toUpperCase(),
                    style: const TextStyle(
                      color: MusrideColors.white,
                      fontSize: MusrideFontSize.titleLarge,
                      fontWeight: MusrideFontWeight.heavy,
                    ),
                  ),
                )
                : Image.memory(
                  photo!,
                  fit: BoxFit.cover,
                  gaplessPlayback: true,
                  errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                ),
      ),
    );
  }
}

/// Photo of the car (or Bajaj); a clean picture of the vehicle type when there is none.
class VehiclePhoto extends StatelessWidget {
  const VehiclePhoto({super.key, required this.category, this.photo, this.description});
  final VehicleCategory category;
  final Uint8List? photo;
  final String? description;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      image: true,
      label: photo == null ? null : 'Photo of the ${description ?? 'vehicle'}',
      child: Container(
        width: MusrideSize.vehiclePhotoWidth,
        height: MusrideSize.vehiclePhotoHeight,
        decoration: BoxDecoration(
          color: MusrideColors.white,
          borderRadius: BorderRadius.circular(MusrideRadius.card),
        ),
        clipBehavior: Clip.antiAlias,
        child:
            photo == null
                ? Icon(
                  category == VehicleCategory.bajaj
                      ? Icons.electric_rickshaw
                      : Icons.directions_car,
                  size: MusrideSize.iconLarge * 2,
                  color: MusrideColors.navy,
                )
                : Image.memory(
                  photo!,
                  fit: BoxFit.cover,
                  gaplessPlayback: true,
                  errorBuilder:
                      (_, __, ___) => const Icon(Icons.directions_car, color: MusrideColors.navy),
                ),
      ),
    );
  }
}

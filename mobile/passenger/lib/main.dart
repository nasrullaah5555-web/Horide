import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:musride_core/musride_core.dart';

import 'app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  configureMaps(appId: 'et.musride.passenger');
  final problem = MusrideConfig.releaseProblem;
  runApp(problem != null ? ConfigErrorApp(problem) : const ProviderScope(child: MusrideApp()));
}

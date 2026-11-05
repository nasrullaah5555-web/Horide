import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:horide_core/horide_core.dart';

import 'app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  configureMaps(appId: 'et.horide.driver');
  final problem = HorideConfig.releaseProblem;
  runApp(problem != null ? ConfigErrorApp(problem) : const ProviderScope(child: HorideApp()));
}

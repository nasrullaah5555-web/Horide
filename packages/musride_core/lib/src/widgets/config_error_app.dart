import 'package:flutter/material.dart';

import '../design/tokens.g.dart';
import '../theme.dart';

/// Shown instead of the app when the build is misconfigured (see MusrideConfig.releaseProblem).
class ConfigErrorApp extends StatelessWidget {
  const ConfigErrorApp(this.problem, {super.key});
  final String problem;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      theme: MusrideTheme.light(),
      home: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(MusrideSpace.xl),
            child: Center(child: Text(problem, textAlign: TextAlign.center)),
          ),
        ),
      ),
    );
  }
}

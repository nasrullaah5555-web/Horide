import 'package:flutter/material.dart';

import '../theme.dart';

/// Shown instead of the app when the build is misconfigured (see HorideConfig.releaseProblem).
class ConfigErrorApp extends StatelessWidget {
  const ConfigErrorApp(this.problem, {super.key});
  final String problem;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      theme: HorideTheme.light(),
      home: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Center(child: Text(problem, textAlign: TextAlign.center)),
          ),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:horide_core/horide_core.dart';

/// Temporary shell: replaced by the full app in the next commit.
class HorideApp extends StatelessWidget {
  const HorideApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Horide Driver',
      theme: HorideTheme.light(),
      darkTheme: HorideTheme.dark(),
      home: const Scaffold(body: Center(child: Text('Horide Driver'))),
    );
  }
}

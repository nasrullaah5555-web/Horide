import 'package:flutter/material.dart';
import 'package:horide_core/horide_core.dart';

/// Shows an API error in plain words. Network errors get the same treatment: the message
/// already explains what happened and what to do.
void showError(BuildContext context, Object error) {
  final message =
      error is ApiException ? error.message : 'Something went wrong. Please try again.';
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}

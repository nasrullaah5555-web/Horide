import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

/// Lets the passenger send a "follow my trip" link the way people in Jijiga and Nairobi
/// actually message: WhatsApp, Telegram, SMS, or copy it anywhere.
Future<void> showShareTripSheet(BuildContext context, String url) {
  final text = 'Follow my Musride trip live: $url';
  Future<void> open(Uri uri) async {
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication) && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('That app is not on this phone. Copy the link instead.')),
      );
    }
  }

  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder:
        (sheet) => SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const ListTile(
                title: Text('Share your trip'),
                subtitle: Text(
                  'They can see the car, plate and where it is until the trip ends. '
                  'No app needed.',
                ),
              ),
              ListTile(
                leading: const Icon(Icons.chat_outlined),
                title: const Text('WhatsApp'),
                onTap: () {
                  Navigator.pop(sheet);
                  open(Uri.https('wa.me', '/', {'text': text}));
                },
              ),
              ListTile(
                leading: const Icon(Icons.send_outlined),
                title: const Text('Telegram'),
                onTap: () {
                  Navigator.pop(sheet);
                  open(
                    Uri.https('t.me', '/share/url', {
                      'url': url,
                      'text': 'Follow my Musride trip live',
                    }),
                  );
                },
              ),
              ListTile(
                leading: const Icon(Icons.sms_outlined),
                title: const Text('Text message (SMS)'),
                onTap: () {
                  Navigator.pop(sheet);
                  open(Uri(scheme: 'sms', queryParameters: {'body': text}));
                },
              ),
              ListTile(
                leading: const Icon(Icons.copy),
                title: const Text('Copy link'),
                onTap: () async {
                  await Clipboard.setData(ClipboardData(text: url));
                  if (sheet.mounted) Navigator.pop(sheet);
                  if (context.mounted) {
                    ScaffoldMessenger.of(
                      context,
                    ).showSnackBar(const SnackBar(content: Text('Link copied')));
                  }
                },
              ),
            ],
          ),
        ),
  );
}

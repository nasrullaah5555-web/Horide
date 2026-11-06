import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../design/components.dart';
import '../design/tokens.g.dart';

/// One message in the in-app inbox (trip updates, payment notes, announcements from Musride).
class InboxItem {
  const InboxItem({
    required this.id,
    required this.title,
    required this.body,
    required this.createdAt,
    required this.read,
  });

  factory InboxItem.fromJson(Map<String, dynamic> j) => InboxItem(
    id: j['id'] as String,
    title: j['title'] as String,
    body: j['body'] as String,
    createdAt: DateTime.parse(j['created_at'] as String),
    read: j['read_at'] != null,
  );

  final String id;
  final String title;
  final String body;
  final DateTime createdAt;
  final bool read;
}

/// The server keeps the latest 50 messages per account (GET /notifications).
Future<({List<InboxItem> items, int unread})> fetchInbox(ApiClient api) async {
  final r = await api.get('/notifications');
  final items =
      (r['notifications'] as List<dynamic>)
          .map((e) => InboxItem.fromJson(e as Map<String, dynamic>))
          .toList();
  return (items: items, unread: (r['unread'] as num).toInt());
}

/// "6 Nov, 16:47" in the phone's own time zone.
String formatInboxTime(DateTime d) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  final l = d.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${l.day} ${months[l.month - 1]}, ${two(l.hour)}:${two(l.minute)}';
}

/// The inbox. Opening it marks everything as read on the server.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<InboxItem>? _items;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final inbox = await fetchInbox(widget.api);
      if (!mounted) return;
      setState(() {
        _items = inbox.items;
        _error = null;
      });
      if (inbox.unread > 0) {
        // Shown as unread this time (bold), read from the next visit.
        await widget.api.post('/notifications/read-all');
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    final theme = Theme.of(context);
    Widget body;
    if (items == null && _error == null) {
      body = const Center(child: CircularProgressIndicator());
    } else if (items == null) {
      body = ListView(
        padding: const EdgeInsets.all(MusrideSpace.lg),
        children: [
          MusrideNotice(text: _error!),
          const Gap(MusrideSpace.md),
          MusrideButton(kind: MusrideButtonKind.secondary, label: 'Try again', onPressed: _load),
        ],
      );
    } else if (items.isEmpty) {
      body = ListView(
        padding: const EdgeInsets.all(MusrideSpace.lg),
        children: const [
          Gap(MusrideSpace.xl),
          Icon(Icons.notifications_none, size: MusrideSize.iconLarge, color: MusrideColors.muted),
          Gap(MusrideSpace.md),
          Text('No notifications yet', textAlign: TextAlign.center),
          Gap(MusrideSpace.xs),
          HintText('Trip updates and messages from Musride will appear here.'),
        ],
      );
    } else {
      body = ListView.separated(
        itemCount: items.length,
        separatorBuilder: (_, __) => const Divider(height: MusrideStroke.hairline),
        itemBuilder: (_, i) {
          final n = items[i];
          return ListTile(
            contentPadding: const EdgeInsets.symmetric(
              horizontal: MusrideSpace.lg,
              vertical: MusrideSpace.xs,
            ),
            leading:
                n.read
                    ? const Icon(Icons.notifications_none)
                    : const Icon(Icons.notifications_active, color: MusrideColors.sign),
            title: Text(
              n.title,
              style: n.read ? null : const TextStyle(fontWeight: MusrideFontWeight.bold),
            ),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(n.body),
                const Gap(MusrideSpace.xs),
                Text(formatInboxTime(n.createdAt), style: theme.textTheme.bodySmall),
              ],
            ),
          );
        },
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: RefreshIndicator(onRefresh: _load, child: body),
    );
  }
}

/// A bell for the app bar or menu that shows how many messages are unread.
class NotificationsBell extends StatefulWidget {
  const NotificationsBell({super.key, required this.api, required this.onOpen});
  final ApiClient api;

  /// Opens the inbox; the bell reloads its count when the inbox closes.
  final Future<void> Function() onOpen;

  @override
  State<NotificationsBell> createState() => _NotificationsBellState();
}

class _NotificationsBellState extends State<NotificationsBell> {
  int _unread = 0;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    try {
      final inbox = await fetchInbox(widget.api);
      if (mounted) setState(() => _unread = inbox.unread);
    } on ApiException {
      // Offline: keep the last count; the connection banner explains.
    }
  }

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: _unread == 0 ? 'Notifications' : 'Notifications, $_unread unread',
      onPressed: () async {
        await widget.onOpen();
        await _refresh();
      },
      icon: Badge(
        isLabelVisible: _unread > 0,
        label: Text('$_unread'),
        backgroundColor: MusrideColors.signal,
        child: const Icon(Icons.notifications_outlined),
      ),
    );
  }
}

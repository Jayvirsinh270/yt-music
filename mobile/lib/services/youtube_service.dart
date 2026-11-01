import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../models/track.dart';

class YouTubeService {
  static const String _defaultHost = 'http://10.0.2.2:5000';
  static const String _prefKeyHost = 'linus_server_host';

  String _serverHost = _defaultHost;

  String get serverHost => _serverHost;

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    _serverHost = prefs.getString(_prefKeyHost) ?? _defaultHost;
  }

  Future<void> setServerHost(String host) async {
    _serverHost = host.trim().replaceAll(RegExp(r'/+$'), '');
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefKeyHost, _serverHost);
  }

  /// Searches YouTube songs through the Linus proxy/cache API
  Future<List<Track>> search(String query, {int limit = 15}) async {
    if (query.trim().isEmpty) return [];

    try {
      final uri = Uri.parse('$_serverHost/api/youtube/search').replace(queryParameters: {
        'q': query.trim(),
        'limit': limit.toString(),
      });

      final response = await http.get(uri).timeout(const Duration(seconds: 10));
      if (response.statusCode != 200) return [];

      final data = json.decode(response.body);
      final results = data['results'] as List<dynamic>? ?? [];

      return results.map((item) {
        final rawId = (item['id'] as String? ?? '').replaceFirst('yt:', '');
        final durSeconds = item['duration'] as int? ?? 0;
        final thumb = (item['thumbnail'] as String? ?? '')
            .isNotEmpty
            ? item['thumbnail'] as String
            : 'https://i.ytimg.com/vi/$rawId/hqdefault.jpg';

        return Track(
          id: 'yt:$rawId',
          title: item['title'] as String? ?? 'Unknown Title',
          artist: item['artist'] as String? ?? 'YouTube Artist',
          album: 'YouTube Music',
          duration: Duration(seconds: durSeconds),
          filePath: '$_serverHost/api/youtube/stream/$rawId',
          thumbnailUrl: thumb,
          source: TrackSource.youtube,
        );
      }).toList();
    } catch (_) {
      return [];
    }
  }

  /// One-tap download of YouTube audio to local storage
  Future<bool> downloadToLocal(Track track) async {
    if (!track.isYouTube) return false;
    final cleanId = track.id.replaceFirst('yt:', '');
    final ytUrl = 'https://www.youtube.com/watch?v=$cleanId';

    try {
      final uri = Uri.parse('$_serverHost/api/download');
      final response = await http.post(
        uri,
        headers: {'Content-Type': 'application/json'},
        body: json.encode({'url': ytUrl, 'media_type': 'audio'}),
      ).timeout(const Duration(seconds: 8));

      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }
}

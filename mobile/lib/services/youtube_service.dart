import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../models/track.dart';

class YouTubeService {
  static const String _prefKeyHost = 'linus_server_host';
  String _serverHost = '';

  String get serverHost => _serverHost;

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    _serverHost = prefs.getString(_prefKeyHost) ?? '';
  }

  Future<void> setServerHost(String host) async {
    _serverHost = host.trim().replaceAll(RegExp(r'/+$'), '');
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefKeyHost, _serverHost);
  }

  /// Multi-tier resilient YouTube search:
  /// 1. Direct YouTube Innertube Web API (0 latency, full catalog, no server required)
  /// 2. Piped / Invidious public music APIs fallback
  /// 3. Linus PC server proxy fallback (if configured)
  Future<List<Track>> search(String query, {int limit = 20}) async {
    final q = query.trim();
    if (q.isEmpty) return [];

    // 1. Try Direct YouTube Innertube Search (fastest, standalone, works everywhere)
    try {
      final results = await _searchInnertube(q, limit: limit);
      if (results.isNotEmpty) return results;
    } catch (e) {
      debugPrint('[YouTubeService] Innertube search error: $e');
    }

    // 2. Try Public Piped Search API
    try {
      final results = await _searchPiped(q);
      if (results.isNotEmpty) return results;
    } catch (e) {
      debugPrint('[YouTubeService] Piped search error: $e');
    }

    // 3. Try Invidious Search API
    try {
      final results = await _searchInvidious(q);
      if (results.isNotEmpty) return results;
    } catch (e) {
      debugPrint('[YouTubeService] Invidious search error: $e');
    }

    // 4. Try local Linus PC server proxy (if user configured their PC's IP)
    if (_serverHost.isNotEmpty) {
      try {
        final uri = Uri.parse('$_serverHost/api/youtube/search').replace(queryParameters: {
          'q': q,
          'limit': limit.toString(),
        });
        final res = await http.get(uri).timeout(const Duration(seconds: 6));
        if (res.statusCode == 200) {
          final data = json.decode(res.body);
          final list = data['results'] as List<dynamic>? ?? [];
          return list.map((item) {
            final rawId = (item['id'] as String? ?? '').replaceFirst('yt:', '');
            return Track(
              id: 'yt:$rawId',
              title: item['title'] as String? ?? 'Unknown Title',
              artist: item['artist'] as String? ?? 'YouTube',
              album: 'YouTube Music',
              duration: Duration(seconds: item['duration'] as int? ?? 0),
              filePath: '$_serverHost/api/youtube/stream/$rawId',
              thumbnailUrl: (item['thumbnail'] as String? ?? '').isNotEmpty
                  ? item['thumbnail'] as String
                  : 'https://i.ytimg.com/vi/$rawId/hqdefault.jpg',
              source: TrackSource.youtube,
            );
          }).toList();
        }
      } catch (e) {
        debugPrint('[YouTubeService] PC server search fallback error: $e');
      }
    }

    return [];
  }

  /// Direct YouTube Innertube API implementation
  Future<List<Track>> _searchInnertube(String query, {int limit = 20}) async {
    final url = Uri.parse('https://www.youtube.com/youtubei/v1/search');
    final payload = {
      'context': {
        'client': {
          'clientName': 'WEB',
          'clientVersion': '2.20240228.01.00',
          'hl': 'en',
          'gl': 'US',
        }
      },
      'query': query,
    };

    final headers = {
      'User-Agent':
          'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
      'Content-Type': 'application/json',
    };

    final response = await http
        .post(url, headers: headers, body: json.encode(payload))
        .timeout(const Duration(seconds: 8));

    if (response.statusCode != 200) return [];

    final data = json.decode(response.body);
    final results = <Track>[];

    final contents = data['contents']?['twoColumnSearchResultsRenderer']?['primaryContents']
            ?['sectionListRenderer']?['contents'] as List<dynamic>? ??
        [];

    for (final section in contents) {
      final items = section['itemSectionRenderer']?['contents'] as List<dynamic>? ?? [];
      for (final item in items) {
        final v = item['videoRenderer'];
        if (v == null) continue;

        final vidId = v['videoId'] as String?;
        if (vidId == null || vidId.isEmpty) continue;

        // Title
        final titleRuns = v['title']?['runs'] as List<dynamic>? ?? [];
        final title = titleRuns.map((r) => r['text'] ?? '').join().trim();

        // Artist / Channel
        final ownerRuns = v['ownerText']?['runs'] as List<dynamic>? ?? [];
        final artist = ownerRuns.map((r) => r['text'] ?? '').join().trim();

        // Duration
        final durStr = v['lengthText']?['simpleText'] as String? ?? '';
        int sec = 0;
        if (durStr.isNotEmpty) {
          final parts = durStr.split(':');
          if (parts.length == 2) {
            sec = (int.tryParse(parts[0]) ?? 0) * 60 + (int.tryParse(parts[1]) ?? 0);
          } else if (parts.length == 3) {
            sec = (int.tryParse(parts[0]) ?? 0) * 3600 +
                (int.tryParse(parts[1]) ?? 0) * 60 +
                (int.tryParse(parts[2]) ?? 0);
          }
        }

        // Thumbnail
        final thumbs = v['thumbnail']?['thumbnails'] as List<dynamic>? ?? [];
        final thumb = thumbs.isNotEmpty
            ? thumbs.last['url'] as String? ?? 'https://i.ytimg.com/vi/$vidId/hqdefault.jpg'
            : 'https://i.ytimg.com/vi/$vidId/hqdefault.jpg';

        results.add(Track(
          id: 'yt:$vidId',
          title: title.isNotEmpty ? title : 'YouTube Song',
          artist: artist.isNotEmpty ? artist : 'YouTube Music',
          album: 'YouTube',
          duration: Duration(seconds: sec),
          filePath: '', // Resolved on-demand when user plays
          thumbnailUrl: thumb,
          source: TrackSource.youtube,
        ));

        if (results.length >= limit) break;
      }
      if (results.length >= limit) break;
    }

    return results;
  }

  /// Piped Public API search fallback
  Future<List<Track>> _searchPiped(String query) async {
    final instances = [
      'https://pipedapi.kavin.rocks',
      'https://api.piped.privacydev.net',
      'https://pipedapi.leptons.xyz',
    ];

    for (final host in instances) {
      try {
        final uri = Uri.parse('$host/search').replace(queryParameters: {
          'q': query,
          'filter': 'music_songs',
        });
        final res = await http.get(uri).timeout(const Duration(seconds: 4));
        if (res.statusCode == 200) {
          final data = json.decode(res.body);
          final items = (data['items'] as List<dynamic>?) ?? [];
          final tracks = <Track>[];
          for (final it in items) {
            final url = it['url'] as String? ?? '';
            final vidId = url.replaceFirst('/watch?v=', '');
            if (vidId.isEmpty) continue;

            tracks.add(Track(
              id: 'yt:$vidId',
              title: it['title'] as String? ?? 'Song',
              artist: it['uploaderName'] as String? ?? 'YouTube',
              album: 'YouTube',
              duration: Duration(seconds: it['duration'] as int? ?? 0),
              filePath: '',
              thumbnailUrl: it['thumbnail'] as String? ?? 'https://i.ytimg.com/vi/$vidId/hqdefault.jpg',
              source: TrackSource.youtube,
            ));
          }
          if (tracks.isNotEmpty) return tracks;
        }
      } catch (_) {
        continue;
      }
    }
    return [];
  }

  /// Invidious API search fallback
  Future<List<Track>> _searchInvidious(String query) async {
    final instances = [
      'https://invidious.nerdvpn.de',
      'https://inv.nadeko.net',
    ];

    for (final host in instances) {
      try {
        final uri = Uri.parse('$host/api/v1/search').replace(queryParameters: {
          'q': query,
          'type': 'video',
        });
        final res = await http.get(uri).timeout(const Duration(seconds: 4));
        if (res.statusCode == 200) {
          final items = (json.decode(res.body) as List<dynamic>?) ?? [];
          final tracks = <Track>[];
          for (final it in items) {
            final vidId = it['videoId'] as String? ?? '';
            if (vidId.isEmpty) continue;

            tracks.add(Track(
              id: 'yt:$vidId',
              title: it['title'] as String? ?? 'Song',
              artist: it['author'] as String? ?? 'YouTube',
              album: 'YouTube',
              duration: Duration(seconds: it['lengthSeconds'] as int? ?? 0),
              filePath: '',
              thumbnailUrl: 'https://i.ytimg.com/vi/$vidId/hqdefault.jpg',
              source: TrackSource.youtube,
            ));
          }
          if (tracks.isNotEmpty) return tracks;
        }
      } catch (_) {
        continue;
      }
    }
    return [];
  }

  /// Resolves a direct audio stream URL for a YouTube video.
  /// 1. Tries local PC server if reachable.
  /// 2. Tries Piped / Invidious direct audio stream extractors.
  Future<String?> resolveStreamUrl(String videoId) async {
    final cleanId = videoId.replaceFirst('yt:', '');

    // 1. Try PC Server proxy if configured
    if (_serverHost.isNotEmpty) {
      final serverStream = '$_serverHost/api/youtube/stream/$cleanId';
      return serverStream;
    }

    // 2. Try Piped API for direct high-quality audio streams
    final pipedInstances = [
      'https://pipedapi.kavin.rocks',
      'https://api.piped.privacydev.net',
      'https://pipedapi.leptons.xyz',
    ];

    for (final host in pipedInstances) {
      try {
        final uri = Uri.parse('$host/streams/$cleanId');
        final res = await http.get(uri).timeout(const Duration(seconds: 5));
        if (res.statusCode == 200) {
          final data = json.decode(res.body);
          final streams = data['audioStreams'] as List<dynamic>? ?? [];
          if (streams.isNotEmpty) {
            // Find best audio stream
            final stream = streams.firstWhere(
              (s) => (s['mimeType'] as String? ?? '').contains('mp4') || (s['mimeType'] as String? ?? '').contains('webm'),
              orElse: () => streams.first,
            );
            final url = stream['url'] as String?;
            if (url != null && url.isNotEmpty) {
              return url;
            }
          }
        }
      } catch (_) {
        continue;
      }
    }

    // 3. Try Invidious API
    final invidiousInstances = [
      'https://invidious.nerdvpn.de',
      'https://inv.nadeko.net',
    ];

    for (final host in invidiousInstances) {
      try {
        final uri = Uri.parse('$host/api/v1/videos/$cleanId');
        final res = await http.get(uri).timeout(const Duration(seconds: 5));
        if (res.statusCode == 200) {
          final data = json.decode(res.body);
          final formats = data['adaptiveFormats'] as List<dynamic>? ?? [];
          for (final fmt in formats) {
            final type = fmt['type'] as String? ?? '';
            final url = fmt['url'] as String? ?? '';
            if (type.contains('audio') && url.isNotEmpty) {
              return url;
            }
          }
        }
      } catch (_) {
        continue;
      }
    }

    // Fallback: return default server stream path
    return _serverHost.isNotEmpty ? '$_serverHost/api/youtube/stream/$cleanId' : null;
  }

  /// Download YouTube track to local Linus storage (requires PC server)
  Future<bool> downloadToLocal(Track track) async {
    if (_serverHost.isEmpty) return false;
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

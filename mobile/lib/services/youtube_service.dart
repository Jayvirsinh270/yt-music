import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../models/track.dart';

class _CachedStream {
  final String url;
  final DateTime expiresAt;
  _CachedStream(this.url, this.expiresAt);
  bool get isValid => DateTime.now().isBefore(expiresAt);
}

class YouTubeService {
  static const String _prefKeyHost = 'linus_server_host';
  String _serverHost = '';

  // In-memory instant stream cache (avoids repeated network calls)
  static final Map<String, _CachedStream> _streamCache = {};

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
  /// 1. Direct YouTube Innertube Web API (fastest, full catalog)
  /// 2. Piped / Invidious fallback APIs
  /// 3. Linus PC server proxy fallback (if configured)
  Future<List<Track>> search(String query, {int limit = 25}) async {
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
        final res = await http.get(uri).timeout(const Duration(seconds: 5));
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

  /// Direct YouTube Innertube search implementation
  Future<List<Track>> _searchInnertube(String query, {int limit = 25}) async {
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
        .timeout(const Duration(seconds: 6));

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
          filePath: '',
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

  /// Ultra-fast stream resolution with zero lag:
  /// Races Innertube Android, iOS, TV, and top mirrors concurrently.
  /// Completes as soon as the first valid audio URL arrives (< 400ms typical).
  Future<String?> resolveStreamUrl(String videoId) async {
    final cleanId = videoId.replaceFirst('yt:', '').trim();
    if (cleanId.isEmpty) return null;

    // 1. Instant Cache Check (0 ms)
    final cached = _streamCache[cleanId];
    if (cached != null && cached.isValid) {
      return cached.url;
    }

    final completer = Completer<String?>();
    int pending = 5;

    void tryComplete(String? url) {
      if (!completer.isCompleted && url != null && url.isNotEmpty) {
        _cacheStreamUrl(cleanId, url);
        completer.complete(url);
      } else {
        pending--;
        if (pending <= 0 && !completer.isCompleted) {
          completer.complete(null);
        }
      }
    }

    // 1. Concurrent Innertube Android client (~200ms)
    _resolveInnertubePlayer(cleanId, clientName: 'ANDROID', clientVersion: '19.09.37')
        .then((url) => tryComplete(url))
        .catchError((_) => tryComplete(null));

    // 2. Concurrent Innertube iOS client
    _resolveInnertubePlayer(cleanId, clientName: 'IOS', clientVersion: '19.29.1')
        .then((url) => tryComplete(url))
        .catchError((_) => tryComplete(null));

    // 3. Concurrent Innertube TV client (direct unthrottled stream)
    _resolveInnertubePlayer(cleanId, clientName: 'TVHTML5_SIMPLY_EMBEDDED', clientVersion: '2.0')
        .then((url) => tryComplete(url))
        .catchError((_) => tryComplete(null));

    // 4. Concurrent Piped fast stream
    _fetchPipedFastStream(cleanId)
        .then((url) => tryComplete(url))
        .catchError((_) => tryComplete(null));

    // 5. Concurrent Invidious fast stream
    _fetchInvidiousFastStream(cleanId)
        .then((url) => tryComplete(url))
        .catchError((_) => tryComplete(null));

    // Global race timeout: 3.5 seconds
    final result = await completer.future.timeout(
      const Duration(milliseconds: 3500),
      onTimeout: () => null,
    );

    if (result != null && result.isNotEmpty) {
      return result;
    }

    // Fallback: PC Server proxy if configured
    if (_serverHost.isNotEmpty) {
      return '$_serverHost/api/youtube/stream/$cleanId';
    }

    return null;
  }

  /// Direct YouTube Official Player API
  Future<String?> _resolveInnertubePlayer(String videoId, {required String clientName, required String clientVersion}) async {
    final url = Uri.parse('https://www.youtube.com/youtubei/v1/player');
    final payload = {
      'context': {
        'client': {
          'clientName': clientName,
          'clientVersion': clientVersion,
          'hl': 'en',
          'gl': 'US',
          if (clientName == 'ANDROID') 'androidSdkVersion': 30,
        }
      },
      'videoId': videoId,
    };

    final headers = {
      'Content-Type': 'application/json',
      'User-Agent': clientName == 'ANDROID'
          ? 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip'
          : clientName == 'IOS'
              ? 'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)'
              : 'Mozilla/5.0 (SmartHub; SMART-TV; U; Linux/SmartTV; Maple2012) AppleWebKit/534.7 (KHTML, like Gecko) SmartTV Safari/534.7',
    };

    final response = await http
        .post(url, headers: headers, body: json.encode(payload))
        .timeout(const Duration(milliseconds: 3200));

    if (response.statusCode != 200) return null;

    final data = json.decode(response.body);
    final streamingData = data['streamingData'];
    if (streamingData == null) return null;

    final adaptiveFormats = streamingData['adaptiveFormats'] as List<dynamic>? ?? [];

    // Filter audio formats
    final audioFormats = adaptiveFormats.where((f) {
      final mime = f['mimeType'] as String? ?? '';
      final directUrl = f['url'] as String? ?? '';
      return mime.startsWith('audio/') && directUrl.isNotEmpty;
    }).toList();

    if (audioFormats.isNotEmpty) {
      // Sort by bitrate desc to get highest quality audio
      audioFormats.sort((a, b) => ((b['bitrate'] as int? ?? 0)).compareTo(a['bitrate'] as int? ?? 0));
      return audioFormats.first['url'] as String?;
    }

    // Direct format fallback (ExoPlayer plays audio directly from MP4 stream)
    final formats = streamingData['formats'] as List<dynamic>? ?? [];
    for (final f in formats) {
      final directUrl = f['url'] as String? ?? '';
      if (directUrl.isNotEmpty) {
        return directUrl;
      }
    }

    return null;
  }

  Future<String?> _fetchPipedFastStream(String videoId) async {
    final pipedInstances = [
      'https://pipedapi.kavin.rocks/streams/$videoId',
      'https://api.piped.privacydev.net/streams/$videoId',
    ];
    for (final ep in pipedInstances) {
      try {
        final res = await http.get(Uri.parse(ep)).timeout(const Duration(milliseconds: 2800));
        if (res.statusCode == 200) {
          final data = json.decode(res.body);
          final audioStreams = data['audioStreams'] as List<dynamic>? ?? [];
          if (audioStreams.isNotEmpty) {
            final url = audioStreams.first['url'] as String?;
            if (url != null && url.isNotEmpty) return url;
          }
        }
      } catch (_) {}
    }
    return null;
  }

  Future<String?> _fetchInvidiousFastStream(String videoId) async {
    final invidiousInstances = [
      'https://invidious.nerdvpn.de/api/v1/videos/$videoId',
      'https://inv.nadeko.net/api/v1/videos/$videoId',
    ];
    for (final ep in invidiousInstances) {
      try {
        final res = await http.get(Uri.parse(ep)).timeout(const Duration(milliseconds: 2800));
        if (res.statusCode == 200) {
          final data = json.decode(res.body);
          final adaptiveFormats = data['adaptiveFormats'] as List<dynamic>? ?? [];
          for (final f in adaptiveFormats) {
            final type = f['type'] as String? ?? '';
            final url = f['url'] as String? ?? '';
            if (type.contains('audio') && url.isNotEmpty) return url;
          }
        }
      } catch (_) {}
    }
    return null;
  }

  void _cacheStreamUrl(String videoId, String url) {
    _streamCache[videoId] = _CachedStream(url, DateTime.now().add(const Duration(hours: 3)));
  }

  /// Background prefetching for next song in queue so it starts with 0s latency
  void prefetchNextTrack(String videoId) {
    final cleanId = videoId.replaceFirst('yt:', '').trim();
    if (_streamCache.containsKey(cleanId) && _streamCache[cleanId]!.isValid) return;
    resolveStreamUrl(cleanId).catchError((_) => null);
  }

  /// High-Fidelity Autoplay Suggestions (YouTube Radio Engine like Linus)
  /// Fetches next related songs directly from YouTube's recommendation graph.
  Future<List<Track>> getRelatedTracks(String videoId, String artist) async {
    final cleanId = videoId.replaceFirst('yt:', '').trim();
    if (cleanId.isEmpty) return [];

    try {
      // 1. Query YouTube Next / Up Next Radio API
      final url = Uri.parse('https://www.youtube.com/youtubei/v1/next');
      final payload = {
        'context': {
          'client': {
            'clientName': 'WEB',
            'clientVersion': '2.20240228.01.00',
            'hl': 'en',
            'gl': 'US',
          }
        },
        'videoId': cleanId,
      };

      final response = await http
          .post(url, headers: {'Content-Type': 'application/json'}, body: json.encode(payload))
          .timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final results = <Track>[];
        final secondaryResults = data['contents']?['twoColumnWatchNextResults']?['secondaryResults']
                ?['secondaryResults']?['results'] as List<dynamic>? ??
            [];

        for (final item in secondaryResults) {
          final v = item['compactVideoRenderer'];
          if (v == null) continue;

          final vidId = v['videoId'] as String?;
          if (vidId == null || vidId.isEmpty || vidId == cleanId) continue;

          final title = v['title']?['simpleText'] as String? ??
              (v['title']?['runs'] as List<dynamic>?)?.map((r) => r['text'] ?? '').join() ??
              'Song';

          final channel = v['shortBylineText']?['runs']?[0]?['text'] as String? ?? artist;

          final durStr = v['lengthText']?['simpleText'] as String? ?? '';
          int sec = 0;
          if (durStr.isNotEmpty) {
            final parts = durStr.split(':');
            if (parts.length == 2) {
              sec = (int.tryParse(parts[0]) ?? 0) * 60 + (int.tryParse(parts[1]) ?? 0);
            }
          }

          final thumbs = v['thumbnail']?['thumbnails'] as List<dynamic>? ?? [];
          final thumb = thumbs.isNotEmpty
              ? thumbs.last['url'] as String? ?? 'https://i.ytimg.com/vi/$vidId/hqdefault.jpg'
              : 'https://i.ytimg.com/vi/$vidId/hqdefault.jpg';

          results.add(Track(
            id: 'yt:$vidId',
            title: title.trim(),
            artist: channel.trim(),
            album: 'YouTube Radio',
            duration: Duration(seconds: sec),
            filePath: '',
            thumbnailUrl: thumb,
            source: TrackSource.youtube,
          ));

          if (results.length >= 15) break;
        }

        if (results.isNotEmpty) return results;
      }
    } catch (e) {
      debugPrint('[YouTubeService] Get related tracks error: $e');
    }

    // 2. Semantic Artist Fallback
    if (artist.isNotEmpty && artist.toLowerCase() != 'youtube') {
      try {
        final fallbackTracks = await search('$artist similar songs', limit: 12);
        return fallbackTracks.where((t) => !t.id.contains(cleanId)).toList();
      } catch (_) {}
    }

    return [];
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

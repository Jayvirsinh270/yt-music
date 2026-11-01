import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:youtube_explode_dart/youtube_explode_dart.dart' as yte;
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

  final yte.YoutubeExplode _ytExplode = yte.YoutubeExplode();

  String get serverHost => _serverHost;

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    _serverHost = prefs.getString(_prefKeyHost) ?? '';
  }

  void dispose() {
    _ytExplode.close();
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

  /// High-reliability stream resolution:
  /// 1. Instant Cache Check (0ms)
  /// 2. Direct Official YouTube Stream via youtube_explode_dart (pure Dart, cipher deciphered, highest bitrate AAC/Opus)
  /// 3. Parallel Fast Public Mirrors Racing (Piped & Invidious)
  /// 4. PC Server proxy fallback if configured
  Future<String?> resolveStreamUrl(String videoId) async {
    final cleanId = videoId.replaceFirst('yt:', '').trim();
    if (cleanId.isEmpty) return null;

    // 1. Instant Cache Check (0 ms)
    final cached = _streamCache[cleanId];
    if (cached != null && cached.isValid) {
      return cached.url;
    }

    // 2. Direct Official Stream via youtube_explode_dart (pure Dart, cipher deciphered, no proxies)
    try {
      final manifest = await _ytExplode.videos.streamsClient.getManifest(cleanId).timeout(const Duration(seconds: 5));
      final audioStreams = manifest.audioOnly;
      if (audioStreams.isNotEmpty) {
        final audioStream = audioStreams.withHighestBitrate();
        final streamUrl = audioStream.url.toString();
        if (streamUrl.isNotEmpty) {
          _cacheStreamUrl(cleanId, streamUrl);
          return streamUrl;
        }
      }
      final muxedStreams = manifest.muxed;
      if (muxedStreams.isNotEmpty) {
        final muxedStream = muxedStreams.withHighestBitrate();
        final streamUrl = muxedStream.url.toString();
        if (streamUrl.isNotEmpty) {
          _cacheStreamUrl(cleanId, streamUrl);
          return streamUrl;
        }
      }
    } catch (e) {
      debugPrint('[YouTubeService] YoutubeExplode stream error: $e');
    }

    // 3. Fallback: Fast Public Mirror Racing
    try {
      final mirrorStream = await _raceFastStreamInstances(cleanId);
      if (mirrorStream != null && mirrorStream.isNotEmpty) {
        _cacheStreamUrl(cleanId, mirrorStream);
        return mirrorStream;
      }
    } catch (_) {}

    // 4. Fallback: PC Server proxy if configured
    if (_serverHost.isNotEmpty) {
      return '$_serverHost/api/youtube/stream/$cleanId';
    }

    return null;
  }

  /// Fast racing across multiple public mirrors simultaneously
  Future<String?> _raceFastStreamInstances(String videoId) async {
    final endpoints = [
      'https://pipedapi.leptons.xyz/streams/$videoId',
      'https://pipedapi.kavin.rocks/streams/$videoId',
      'https://api.piped.privacydev.net/streams/$videoId',
      'https://inv.nadeko.net/api/v1/videos/$videoId',
      'https://invidious.nerdvpn.de/api/v1/videos/$videoId',
      'https://invidious.jing.rocks/api/v1/videos/$videoId',
    ];

    final completer = Completer<String?>();
    int pending = endpoints.length;

    for (final ep in endpoints) {
      http.get(Uri.parse(ep)).timeout(const Duration(seconds: 4)).then((res) {
        if (!completer.isCompleted && res.statusCode == 200) {
          final data = json.decode(res.body);
          // Try Piped structure
          final audioStreams = data['audioStreams'] as List<dynamic>?;
          if (audioStreams != null && audioStreams.isNotEmpty) {
            final url = audioStreams.first['url'] as String?;
            if (url != null && url.isNotEmpty) {
              completer.complete(url);
              return;
            }
          }
          // Try Invidious structure
          final adaptiveFormats = data['adaptiveFormats'] as List<dynamic>?;
          if (adaptiveFormats != null && adaptiveFormats.isNotEmpty) {
            for (final f in adaptiveFormats) {
              final type = f['type'] as String? ?? '';
              final url = f['url'] as String? ?? '';
              if (type.contains('audio') && url.isNotEmpty) {
                completer.complete(url);
                return;
              }
            }
          }
        }
      }).catchError((_) {}).whenComplete(() {
        pending--;
        if (pending <= 0 && !completer.isCompleted) {
          completer.complete(null);
        }
      });
    }

    return completer.future.timeout(const Duration(seconds: 4), onTimeout: () => null);
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

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
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

  // In-memory stream cache (avoids repeated resolution)
  static final Map<String, _CachedStream> _streamCache = {};

  // youtube_explode_dart instance — handles cipher decoding natively
  yte.YoutubeExplode _ytExplode = yte.YoutubeExplode();

  String get serverHost => _serverHost;

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    _serverHost = prefs.getString(_prefKeyHost) ?? '';
  }

  void dispose() {
    try {
      _ytExplode.close();
    } catch (_) {}
  }

  void _ensureYtExplode() {
    // If closed or null, re-initialize
    try {
      // simple access test
      if (_ytExplode.videos.isClosed) {
        _ytExplode = yte.YoutubeExplode();
      }
    } catch (_) {
      _ytExplode = yte.YoutubeExplode();
    }
  }

  Future<void> setServerHost(String host) async {
    _serverHost = host.trim().replaceAll(RegExp(r'/+$'), '');
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefKeyHost, _serverHost);
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  /// Multi-tier resilient YouTube search
  Future<List<Track>> search(String query, {int limit = 25}) async {
    final q = query.trim();
    if (q.isEmpty) return [];

    // 1. Direct Innertube Web API (fastest, standalone, works globally)
    try {
      final results = await _searchInnertube(q, limit: limit);
      if (results.isNotEmpty) return results;
    } catch (e) {
      debugPrint('[YouTubeService] Innertube search error: $e');
    }

    // 2. Direct youtube_explode_dart search fallback
    try {
      _ensureYtExplode();
      final ytResults = await _ytExplode.search.search(q).timeout(const Duration(seconds: 8));
      if (ytResults.isNotEmpty) {
        final list = <Track>[];
        for (final item in ytResults.take(limit)) {
          final vidId = item.id.value;
          list.add(Track(
            id: 'yt:$vidId',
            title: item.title,
            artist: item.author,
            album: 'YouTube Music',
            duration: item.duration ?? Duration.zero,
            filePath: '',
            thumbnailUrl: item.thumbnails.highResUrl.isNotEmpty
                ? item.thumbnails.highResUrl
                : 'https://i.ytimg.com/vi/$vidId/hqdefault.jpg',
            source: TrackSource.youtube,
          ));
        }
        if (list.isNotEmpty) return list;
      }
    } catch (e) {
      debugPrint('[YouTubeService] youtube_explode search error: $e');
    }

    // 3. Piped public API
    try {
      final results = await _searchPiped(q);
      if (results.isNotEmpty) return results;
    } catch (e) {
      debugPrint('[YouTubeService] Piped search error: $e');
    }

    // 4. Invidious public API
    try {
      final results = await _searchInvidious(q);
      if (results.isNotEmpty) return results;
    } catch (e) {
      debugPrint('[YouTubeService] Invidious search error: $e');
    }

    // 5. PC server fallback (if user configured)
    if (_serverHost.isNotEmpty) {
      try {
        final uri = Uri.parse('$_serverHost/api/youtube/search').replace(
          queryParameters: {'q': q, 'limit': limit.toString()},
        );
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
        debugPrint('[YouTubeService] PC server search error: $e');
      }
    }

    return [];
  }

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
        .timeout(const Duration(seconds: 8));

    if (response.statusCode != 200) return [];

    final data = json.decode(response.body);
    final results = <Track>[];

    final contents = data['contents']?['twoColumnSearchResultsRenderer']
            ?['primaryContents']?['sectionListRenderer']?['contents']
        as List<dynamic>? ?? [];

    for (final section in contents) {
      final items = section['itemSectionRenderer']?['contents'] as List<dynamic>? ?? [];
      for (final item in items) {
        final v = item['videoRenderer'];
        if (v == null) continue;

        final vidId = v['videoId'] as String?;
        if (vidId == null || vidId.isEmpty) continue;

        final titleRuns = v['title']?['runs'] as List<dynamic>? ?? [];
        final title = titleRuns.map((r) => r['text'] ?? '').join().trim();

        final ownerRuns = v['ownerText']?['runs'] as List<dynamic>? ?? [];
        final artist = ownerRuns.map((r) => r['text'] ?? '').join().trim();

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

  Future<List<Track>> _searchPiped(String query) async {
    final instances = [
      'https://piped-api.garudalinux.org',
      'https://api.piped.private.coffee',
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

  Future<List<Track>> _searchInvidious(String query) async {
    final instances = [
      'https://inv.tux.pizza',
      'https://invidious.projectsegfau.lt',
      'https://yewtu.be',
      'https://yt.artemislena.eu',
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

  // ── Stream Resolution ──────────────────────────────────────────────────────

  /// Resolves a playable audio stream URL for the given video ID.
  /// 5-Stage Resilient Resolution Pipeline:
  ///   Stage 1: In-memory cache hit (0 ms)
  ///   Stage 2: Direct YouTube Android Innertube API (<300 ms, unciphered direct stream URL)
  ///   Stage 3: youtube_explode_dart (pure Dart, decodes cipher / n-parameter)
  ///   Stage 4: Multi-instance public mirror racing (Invidious / Piped)
  ///   Stage 5: PC Server proxy (if configured)
  Future<String?> resolveStreamUrl(String videoId) async {
    final cleanId = videoId.replaceFirst('yt:', '').trim();
    if (cleanId.isEmpty) return null;

    // Stage 1: In-memory cache hit
    final cached = _streamCache[cleanId];
    if (cached != null && cached.isValid) {
      debugPrint('[YouTubeService] Cache hit for $cleanId');
      return cached.url;
    }

    // Stage 2: Direct YouTube Android Innertube API (direct unciphered googlevideo stream URL)
    try {
      final androidStream = await _resolveInnertubeAndroid(cleanId);
      if (androidStream != null && androidStream.isNotEmpty) {
        _cacheStreamUrl(cleanId, androidStream, ttlMinutes: 55);
        return androidStream;
      }
    } catch (e) {
      debugPrint('[YouTubeService] Stage 2 Innertube Android error: $e');
    }

    // Stage 3: youtube_explode_dart (handles cipher decoding natively)
    try {
      _ensureYtExplode();
      debugPrint('[YouTubeService] Stage 3: Trying youtube_explode_dart for $cleanId');
      final manifest = await _ytExplode.videos.streamsClient
          .getManifest(cleanId)
          .timeout(const Duration(seconds: 15));

      // Prefer audio-only streams (highest bitrate AAC/Opus)
      final audioOnly = manifest.audioOnly;
      if (audioOnly.isNotEmpty) {
        final sorted = audioOnly.toList()
          ..sort((a, b) => b.bitrate.bitsPerSecond.compareTo(a.bitrate.bitsPerSecond));
        final streamUrl = sorted.first.url.toString();
        if (streamUrl.isNotEmpty) {
          debugPrint('[YouTubeService] youtube_explode_dart audio stream resolved');
          _cacheStreamUrl(cleanId, streamUrl, ttlMinutes: 55);
          return streamUrl;
        }
      }

      // Muxed stream fallback
      final muxed = manifest.muxed;
      if (muxed.isNotEmpty) {
        final sorted = muxed.toList()
          ..sort((a, b) => b.bitrate.bitsPerSecond.compareTo(a.bitrate.bitsPerSecond));
        final streamUrl = sorted.first.url.toString();
        if (streamUrl.isNotEmpty) {
          _cacheStreamUrl(cleanId, streamUrl, ttlMinutes: 55);
          return streamUrl;
        }
      }
    } catch (e) {
      debugPrint('[YouTubeService] Stage 3 youtube_explode error: $e');
    }

    // Stage 4: Multi-instance public mirror racing
    try {
      debugPrint('[YouTubeService] Stage 4: Trying public mirrors for $cleanId');
      final mirrorUrl = await _raceMirrors(cleanId);
      if (mirrorUrl != null && mirrorUrl.isNotEmpty) {
        _cacheStreamUrl(cleanId, mirrorUrl, ttlMinutes: 30);
        return mirrorUrl;
      }
    } catch (_) {}

    // Stage 5: PC server fallback
    if (_serverHost.isNotEmpty) {
      debugPrint('[YouTubeService] Stage 5: Using PC server for $cleanId');
      return '$_serverHost/api/youtube/stream/$cleanId';
    }

    debugPrint('[YouTubeService] All 5 resolution stages failed for $cleanId');
    return null;
  }

  /// Direct YouTube Android Innertube player endpoint
  /// Returns unciphered direct audio stream URL for most songs in <300ms
  Future<String?> _resolveInnertubeAndroid(String videoId) async {
    try {
      final url = Uri.parse('https://www.youtube.com/youtubei/v1/player');
      final payload = {
        'context': {
          'client': {
            'clientName': 'ANDROID',
            'clientVersion': '19.09.37',
            'androidSdkVersion': 30,
            'hl': 'en',
            'gl': 'US',
          }
        },
        'videoId': videoId,
      };

      final headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
      };

      final response = await http
          .post(url, headers: headers, body: json.encode(payload))
          .timeout(const Duration(seconds: 5));

      if (response.statusCode != 200) return null;

      final data = json.decode(response.body);
      final streamingData = data['streamingData'];
      if (streamingData == null) return null;

      final List<dynamic> formats = [
        ...(streamingData['adaptiveFormats'] as List<dynamic>? ?? []),
        ...(streamingData['formats'] as List<dynamic>? ?? []),
      ];

      // Filter for audio streams with direct un-ciphered URL
      final audioFormatsWithUrl = formats.where((f) {
        final mime = f['mimeType'] as String? ?? '';
        final streamUrl = f['url'] as String? ?? '';
        return mime.startsWith('audio/') && streamUrl.isNotEmpty;
      }).toList();

      if (audioFormatsWithUrl.isNotEmpty) {
        audioFormatsWithUrl.sort((a, b) {
          final bitA = a['bitrate'] as int? ?? 0;
          final bitB = b['bitrate'] as int? ?? 0;
          return bitB.compareTo(bitA);
        });
        final bestUrl = audioFormatsWithUrl.first['url'] as String?;
        if (bestUrl != null && bestUrl.isNotEmpty) {
          debugPrint('[YouTubeService] Direct Android Innertube audio URL resolved');
          return bestUrl;
        }
      }
    } catch (e) {
      debugPrint('[YouTubeService] Android Innertube error: $e');
    }
    return null;
  }

  /// Fast parallel mirror racing
  Future<String?> _raceMirrors(String videoId) async {
    final endpoints = [
      'https://inv.tux.pizza/api/v1/videos/$videoId',
      'https://invidious.projectsegfau.lt/api/v1/videos/$videoId',
      'https://yewtu.be/api/v1/videos/$videoId',
      'https://yt.artemislena.eu/api/v1/videos/$videoId',
      'https://piped-api.garudalinux.org/streams/$videoId',
      'https://api.piped.private.coffee/streams/$videoId',
      'https://pipedapi.leptons.xyz/streams/$videoId',
    ];

    final completer = Completer<String?>();
    int pending = endpoints.length;

    for (final ep in endpoints) {
      http.get(Uri.parse(ep)).timeout(const Duration(seconds: 4)).then((res) {
        if (!completer.isCompleted && res.statusCode == 200) {
          try {
            final data = json.decode(res.body);
            // Piped format
            final audioStreams = data['audioStreams'] as List<dynamic>?;
            if (audioStreams != null && audioStreams.isNotEmpty) {
              final sorted = List.from(audioStreams)
                ..sort((a, b) => (b['bitrate'] as int? ?? 0).compareTo(a['bitrate'] as int? ?? 0));
              final url = sorted.first['url'] as String?;
              if (url != null && url.isNotEmpty) {
                completer.complete(url);
                return;
              }
            }
            // Invidious format
            final adaptiveFormats = data['adaptiveFormats'] as List<dynamic>?;
            if (adaptiveFormats != null) {
              for (final f in adaptiveFormats) {
                final type = f['type'] as String? ?? '';
                final url = f['url'] as String? ?? '';
                if (type.contains('audio') && url.isNotEmpty) {
                  completer.complete(url);
                  return;
                }
              }
            }
          } catch (_) {}
        }
      }).catchError((_) {}).whenComplete(() {
        pending--;
        if (pending <= 0 && !completer.isCompleted) {
          completer.complete(null);
        }
      });
    }

    return completer.future.timeout(const Duration(seconds: 5), onTimeout: () => null);
  }

  void _cacheStreamUrl(String videoId, String url, {int ttlMinutes = 55}) {
    _streamCache[videoId] =
        _CachedStream(url, DateTime.now().add(Duration(minutes: ttlMinutes)));
  }

  /// Background prefetch next song in queue (zero-gap playback)
  void prefetchNextTrack(String videoId) {
    final cleanId = videoId.replaceFirst('yt:', '').trim();
    final cached = _streamCache[cleanId];
    if (cached != null && cached.isValid) return;
    resolveStreamUrl(cleanId).catchError((_) => null);
  }

  // ── Related Tracks ─────────────────────────────────────────────────────────

  Future<List<Track>> getRelatedTracks(String videoId, String artist) async {
    final cleanId = videoId.replaceFirst('yt:', '').trim();
    if (cleanId.isEmpty) return [];

    try {
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
          .timeout(const Duration(seconds: 8));

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final results = <Track>[];
        final secondaryResults = data['contents']?['twoColumnWatchNextResults']
                ?['secondaryResults']?['secondaryResults']?['results']
            as List<dynamic>? ?? [];

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

    // Artist search fallback
    if (artist.isNotEmpty && artist.toLowerCase() != 'youtube') {
      try {
        final fallback = await search('$artist similar songs', limit: 12);
        return fallback.where((t) => !t.id.contains(cleanId)).toList();
      } catch (_) {}
    }

    return [];
  }

  // ── Standalone Download ────────────────────────────────────────────────────

  /// Download a YouTube track to device's storage.
  /// Does NOT require PC server — completely standalone.
  /// Returns (success, filePath, error).
  Future<({bool success, String? filePath, String? error})> downloadTrackStandalone(
    Track track, {
    void Function(double progress)? onProgress,
  }) async {
    final cleanId = track.id.replaceFirst('yt:', '');
    if (cleanId.isEmpty) return (success: false, filePath: null, error: 'Invalid video ID');

    try {
      // 1. Resolve stream URL
      String? streamUrl;
      String ext = 'mp3';

      try {
        _ensureYtExplode();
        final manifest = await _ytExplode.videos.streamsClient
            .getManifest(cleanId)
            .timeout(const Duration(seconds: 15));

        if (manifest.audioOnly.isNotEmpty) {
          final sorted = manifest.audioOnly.toList()
            ..sort((a, b) => b.bitrate.bitsPerSecond.compareTo(a.bitrate.bitsPerSecond));
          final bestAudio = sorted.first;
          streamUrl = bestAudio.url.toString();
          ext = bestAudio.codec.mimeType.contains('webm') ? 'webm' : 'm4a';
        }
      } catch (e) {
        debugPrint('[YouTubeService] Download manifest via explode error: $e');
      }

      // If explode failed, try resolved stream url
      if (streamUrl == null || streamUrl.isEmpty) {
        streamUrl = await resolveStreamUrl(cleanId);
      }

      if (streamUrl == null || streamUrl.isEmpty) {
        return (success: false, filePath: null, error: 'Could not obtain audio stream');
      }

      // 2. Pick download directory
      final Directory? dir = await _getDownloadDirectory();
      if (dir == null) {
        return (success: false, filePath: null, error: 'Cannot access device storage');
      }

      // 3. Sanitize filename
      final safeName = track.title
          .replaceAll(RegExp(r'[<>:"/\\|?*]'), '_')
          .replaceAll(RegExp(r'\s+'), ' ')
          .trim();
      final safeArtist = track.artist
          .replaceAll(RegExp(r'[<>:"/\\|?*]'), '_')
          .trim();
      final fileName = '$safeName - $safeArtist.$ext';
      final filePath = '${dir.path}/$fileName';
      final file = File(filePath);

      // Skip if already downloaded
      if (await file.exists() && (await file.length()) > 50000) {
        debugPrint('[YouTubeService] Already downloaded: $filePath');
        return (success: true, filePath: filePath, error: null);
      }

      // 4. Download file with progress
      final client = http.Client();
      try {
        final request = http.Request('GET', Uri.parse(streamUrl));
        final response = await client.send(request).timeout(const Duration(seconds: 25));

        if (response.statusCode != 200 && response.statusCode != 206) {
          return (success: false, filePath: null, error: 'Server returned HTTP ${response.statusCode}');
        }

        final contentLength = response.contentLength ?? 0;
        final sink = file.openWrite();
        int downloaded = 0;

        await for (final chunk in response.stream) {
          sink.add(chunk);
          downloaded += chunk.length;
          if (contentLength > 0 && onProgress != null) {
            onProgress(downloaded / contentLength);
          }
        }

        await sink.flush();
        await sink.close();

        debugPrint('[YouTubeService] Downloaded successfully to: $filePath');
        return (success: true, filePath: filePath, error: null);
      } finally {
        client.close();
      }
    } catch (e) {
      debugPrint('[YouTubeService] Download error: $e');
      return (success: false, filePath: null, error: e.toString());
    }
  }

  Future<Directory?> _getDownloadDirectory() async {
    // 1. Try public Download folder if writable
    try {
      final extDir = await getExternalStorageDirectory();
      if (extDir != null) {
        final parts = extDir.path.split('/Android');
        final basePath = parts.isNotEmpty ? parts.first : extDir.path;
        final publicDownload = Directory('$basePath/Download/Linus');
        await publicDownload.create(recursive: true);
        final testFile = File('${publicDownload.path}/.probe');
        await testFile.writeAsString('ok');
        await testFile.delete();
        return publicDownload;
      }
    } catch (_) {
      // Scoped storage blocked public download folder
    }

    // 2. App-specific external storage (publicly accessible by media scanners, zero permissions needed)
    try {
      final extDir = await getExternalStorageDirectory();
      if (extDir != null) {
        final musicDir = Directory('${extDir.path}/Music');
        await musicDir.create(recursive: true);
        return musicDir;
      }
    } catch (_) {}

    // 3. Fallback: app documents directory
    try {
      final docDir = await getApplicationDocumentsDirectory();
      final dir = Directory('${docDir.path}/Linus_Music');
      await dir.create(recursive: true);
      return dir;
    } catch (_) {}

    return null;
  }

  /// Legacy server-based download (kept for backwards compat)
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

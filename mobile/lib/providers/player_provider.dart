import 'dart:async';
import 'dart:convert';
import 'package:audio_service/audio_service.dart';
import 'package:flutter/foundation.dart';
import 'package:just_audio/just_audio.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/track.dart';
import '../services/audio_handler.dart';
import '../services/local_audio_service.dart';
import '../services/recommendation_engine.dart';
import '../services/youtube_service.dart';

enum PlaybackRepeatMode { off, all, one }

class PlayerProvider extends ChangeNotifier {
  final LinusAudioHandler _audioHandler;
  final RecommendationEngine _recEngine;
  final LocalAudioService _localAudioService;
  final YouTubeService _ytService = YouTubeService();

  final StreamController<String> _errorController = StreamController<String>.broadcast();
  Stream<String> get errorStream => _errorController.stream;

  // Local Tracks
  List<Track> _deviceTracks = [];
  bool _isLoadingTracks = true;
  bool _hasPermission = false;
  TrackSortType _currentSort = TrackSortType.title;

  // YouTube Tracks (Separated)
  List<Track> _youtubeTracks = [];
  bool _isLoadingYouTube = false;

  Track? _currentTrack;
  final List<Track> _queue = [];
  final List<Track> _history = [];
  final List<Track> _favorites = [];

  bool _isPlaying = false;
  bool _isBuffering = false;
  Duration _position = Duration.zero;
  Duration _duration = Duration.zero;

  bool _isShuffle = false;
  PlaybackRepeatMode _repeatMode = PlaybackRepeatMode.off;

  DateTime? _trackStartTime;
  Duration _accumulatedPlayed = Duration.zero;

  // Sleep Timer
  Timer? _sleepTimer;
  DateTime? _sleepTimerEnd;
  int? _sleepTimerMinutes;

  PlayerProvider(this._audioHandler, this._recEngine, this._localAudioService) {
    _initListeners();
    _loadFavorites();
    _ytService.init();
    scanDeviceTracks();
    searchYouTube('Trending Music 2026');
  }

  // Local tracks getters
  List<Track> get deviceTracks => List.unmodifiable(_deviceTracks);
  bool get isLoadingTracks => _isLoadingTracks;
  bool get hasPermission => _hasPermission;
  TrackSortType get currentSort => _currentSort;

  // YouTube tracks getters
  List<Track> get youtubeTracks => List.unmodifiable(_youtubeTracks);
  bool get isLoadingYouTube => _isLoadingYouTube;
  YouTubeService get ytService => _ytService;

  // Playback getters
  Track? get currentTrack => _currentTrack;
  List<Track> get queue => List.unmodifiable(_queue);
  List<Track> get favorites => List.unmodifiable(_favorites);
  List<Track> get history => List.unmodifiable(_history);
  bool get isPlaying => _isPlaying;
  bool get isBuffering => _isBuffering;
  Duration get position => _position;
  Duration get duration => _duration;
  bool get isShuffle => _isShuffle;
  PlaybackRepeatMode get repeatMode => _repeatMode;
  double get volume => _audioHandler.volume;

  // Sleep Timer Getters
  bool get hasActiveSleepTimer => _sleepTimerEnd != null && DateTime.now().isBefore(_sleepTimerEnd!);
  int? get sleepTimerRemainingMinutes {
    if (!hasActiveSleepTimer) return null;
    return _sleepTimerEnd!.difference(DateTime.now()).inMinutes + 1;
  }

  bool isFavorite(String trackId) => _favorites.any((t) => t.id == trackId);

  // Scan or re-scan device for local storage audio files
  Future<void> scanDeviceTracks({TrackSortType? sortType}) async {
    _isLoadingTracks = true;
    if (sortType != null) _currentSort = sortType;
    notifyListeners();

    try {
      final tracks = await _localAudioService.loadTracks(sortType: _currentSort);
      _deviceTracks = tracks;
      _hasPermission = tracks.isNotEmpty || await _localAudioService.requestPermissions();
    } catch (_) {
      _deviceTracks = [];
    } finally {
      _isLoadingTracks = false;
      notifyListeners();
    }
  }

  // YouTube Dedicated Search
  Future<void> searchYouTube(String query) async {
    if (query.trim().isEmpty) return;
    _isLoadingYouTube = true;
    notifyListeners();

    try {
      final results = await _ytService.search(query);
      _youtubeTracks = results;
    } catch (_) {
      _youtubeTracks = [];
    } finally {
      _isLoadingYouTube = false;
      notifyListeners();
    }
  }

  // One-tap Download YouTube Track to Local Storage
  Future<bool> downloadToLocal(Track track) async {
    final success = await _ytService.downloadToLocal(track);
    if (success) {
      // rescan local files after a moment to reflect download
      Future.delayed(const Duration(seconds: 4), () => scanDeviceTracks());
    }
    return success;
  }

  LocalAudioService get localAudioService => _localAudioService;

  Future<bool> requestPermission() async {
    final granted = await _localAudioService.requestPermissions();
    if (granted) {
      await scanDeviceTracks();
    }
    return granted;
  }

  Future<void> playAll({bool shuffle = false, bool fromLocal = true}) async {
    final sourceList = fromLocal ? _deviceTracks : _youtubeTracks;
    if (sourceList.isEmpty) return;
    final list = List<Track>.from(sourceList);
    if (shuffle) {
      list.shuffle();
    }
    await playTrack(list.first, newQueue: list);
  }

  void _initListeners() {
    _audioHandler.onTrackCompleted = () {
      _handleTrackEnd();
    };

    _audioHandler.onSkipNext = () {
      skipNext();
    };

    _audioHandler.onSkipPrevious = () {
      skipPrevious();
    };

    _audioHandler.onPlaybackError = (track, message) {
      _isBuffering = false;
      _errorController.add("Playback error: ${track.title}. Skipping...");
      notifyListeners();
      skipNext();
    };

    _audioHandler.positionStream.listen((pos) {
      _position = pos;
      notifyListeners();
    });

    _audioHandler.durationStream.listen((dur) {
      if (dur != null) {
        _duration = dur;
        notifyListeners();
      }
    });

    _audioHandler.playbackState.listen((state) {
      final isStateBuffering = state.processingState == AudioProcessingState.buffering ||
          state.processingState == AudioProcessingState.loading;
      if (_isBuffering != isStateBuffering) {
        _isBuffering = isStateBuffering;
        notifyListeners();
      }
    });

    _audioHandler.playerStateStream.listen((state) {
      _isPlaying = state.playing;
      final isPlayerBuffering = state.processingState == ProcessingState.buffering ||
          state.processingState == ProcessingState.loading;
      if (_isBuffering != isPlayerBuffering && !isPlayerBuffering) {
        _isBuffering = false;
      }
      notifyListeners();
    });
  }

  Future<void> _loadFavorites() async {
    final prefs = await SharedPreferences.getInstance();
    final favList = prefs.getStringList('linus_favorites') ?? [];
    for (final item in favList) {
      try {
        _favorites.add(Track.fromJson(jsonDecode(item)));
      } catch (_) {}
    }
    notifyListeners();
  }

  Future<void> toggleFavorite(Track track) async {
    final exists = _favorites.any((t) => t.id == track.id);
    if (exists) {
      _favorites.removeWhere((t) => t.id == track.id);
    } else {
      _favorites.insert(0, track);
    }
    notifyListeners();

    final prefs = await SharedPreferences.getInstance();
    final favStrings = _favorites.map((t) => jsonEncode(t.toJson())).toList();
    await prefs.setStringList('linus_favorites', favStrings);
  }

  void _recordListeningMetric() {
    if (_currentTrack != null && _trackStartTime != null) {
      final played = DateTime.now().difference(_trackStartTime!) + _accumulatedPlayed;
      _recEngine.recordPlay(
        track: _currentTrack!,
        playedDuration: played,
        totalDuration: _duration,
      );
    }
    _accumulatedPlayed = Duration.zero;
    _trackStartTime = DateTime.now();
  }

  Future<void> playTrack(Track track, {List<Track>? newQueue}) async {
    _recordListeningMetric();

    _currentTrack = track;
    if (newQueue != null) {
      _queue.clear();
      _queue.addAll(newQueue.where((t) => t.id != track.id));
      if (_isShuffle) {
        _queue.shuffle();
      }
    }

    _trackStartTime = DateTime.now();
    _isBuffering = true;
    notifyListeners();

    Track trackToPlay = track;
    if (track.isYouTube &&
        (track.filePath.isEmpty ||
            !track.filePath.startsWith('http') ||
            track.filePath.contains('10.0.2.2'))) {
      final streamUrl = await _ytService.resolveStreamUrl(track.id.replaceFirst('yt:', ''));
      if (streamUrl != null && streamUrl.isNotEmpty) {
        trackToPlay = Track(
          id: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration: track.duration,
          filePath: streamUrl,
          thumbnailUrl: track.thumbnailUrl,
          source: TrackSource.youtube,
        );
        _currentTrack = trackToPlay;
        notifyListeners();
      }
    }

    await _audioHandler.playTrack(trackToPlay);

  }

  void playNext(Track track) {
    _queue.removeWhere((t) => t.id == track.id);
    _queue.insert(0, track);
    notifyListeners();
  }

  void addToQueue(Track track) {
    _queue.removeWhere((t) => t.id == track.id);
    _queue.add(track);
    notifyListeners();
  }

  void removeFromQueue(int index) {
    if (index >= 0 && index < _queue.length) {
      _queue.removeAt(index);
      notifyListeners();
    }
  }

  void reorderQueue(int oldIndex, int newIndex) {
    if (oldIndex < newIndex) {
      newIndex -= 1;
    }
    final item = _queue.removeAt(oldIndex);
    _queue.insert(newIndex, item);
    notifyListeners();
  }

  Future<void> skipNext() async {
    if (_currentTrack != null) {
      _history.insert(0, _currentTrack!);
    }

    if (_queue.isNotEmpty) {
      final nextTrack = _queue.removeAt(0);
      await playTrack(nextTrack);
    } else if (_currentTrack != null) {
      final nextAutoplay = await _recEngine.getNextAutoplayTrack(
        _currentTrack!,
        {..._history.map((t) => t.id), _currentTrack!.id},
      );
      if (nextAutoplay != null) {
        await playTrack(nextAutoplay);
      }
    }
  }

  Future<void> skipPrevious() async {
    if (_position.inSeconds > 3) {
      await seek(Duration.zero);
      return;
    }

    if (_history.isNotEmpty) {
      final prevTrack = _history.removeAt(0);
      if (_currentTrack != null) {
        _queue.insert(0, _currentTrack!);
      }
      await playTrack(prevTrack);
    }
  }

  Future<void> _handleTrackEnd() async {
    if (_repeatMode == PlaybackRepeatMode.one && _currentTrack != null) {
      await seek(Duration.zero);
      await _audioHandler.play();
    } else {
      await skipNext();
    }
  }

  Future<void> togglePlayPause() async {
    if (_isPlaying) {
      await _audioHandler.pause();
    } else {
      await _audioHandler.play();
    }
  }

  Future<void> seek(Duration position) async {
    await _audioHandler.seek(position);
  }

  void toggleShuffle() {
    _isShuffle = !_isShuffle;
    if (_isShuffle) {
      _queue.shuffle();
    }
    notifyListeners();
  }

  void toggleRepeat() {
    if (_repeatMode == PlaybackRepeatMode.off) {
      _repeatMode = PlaybackRepeatMode.all;
    } else if (_repeatMode == PlaybackRepeatMode.all) {
      _repeatMode = PlaybackRepeatMode.one;
    } else {
      _repeatMode = PlaybackRepeatMode.off;
    }
    notifyListeners();
  }

  Future<void> setVolume(double val) async {
    await _audioHandler.setVolume(val.clamp(0.0, 1.0));
    notifyListeners();
  }

  // Sleep Timer Implementation
  void setSleepTimer(int minutes) {
    cancelSleepTimer();
    _sleepTimerMinutes = minutes;
    _sleepTimerEnd = DateTime.now().add(Duration(minutes: minutes));

    _sleepTimer = Timer(Duration(minutes: minutes), () async {
      await _audioHandler.pause();
      cancelSleepTimer();
    });
    notifyListeners();
  }

  void cancelSleepTimer() {
    _sleepTimer?.cancel();
    _sleepTimer = null;
    _sleepTimerEnd = null;
    _sleepTimerMinutes = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _sleepTimer?.cancel();
    _errorController.close();
    super.dispose();
  }
}

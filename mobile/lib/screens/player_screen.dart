import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:on_audio_query/on_audio_query.dart';
import 'package:provider/provider.dart';
import '../models/track.dart';
import '../providers/player_provider.dart';

class PlayerScreen extends StatefulWidget {
  const PlayerScreen({super.key});

  @override
  State<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends State<PlayerScreen> with TickerProviderStateMixin {
  double? _dragValue;
  late AnimationController _artworkAnimController;
  late Animation<double> _artworkScaleAnim;
  bool _prevPlaying = false;

  @override
  void initState() {
    super.initState();
    _artworkAnimController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
      lowerBound: 0.88,
      upperBound: 1.0,
      value: 0.92,
    );
    _artworkScaleAnim = _artworkAnimController;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        final isPlaying = context.read<PlayerProvider>().isPlaying;
        if (isPlaying) {
          _artworkAnimController.forward();
        }
      }
    });
  }

  @override
  void dispose() {
    _artworkAnimController.dispose();
    super.dispose();
  }

  String _formatDuration(Duration d) {
    final m = d.inMinutes;
    final s = d.inSeconds % 60;
    return '$m:${s.toString().padLeft(2, '0')}';
  }

  Future<void> _showDownloadDialog(BuildContext context, Track track) async {
    double progressValue = 0.0;
    String statusText = 'Connecting & buffering...';
    StateSetter? dialogSetState;

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (dialogCtx) => StatefulBuilder(
        builder: (ctx, setDlgState) {
          dialogSetState = setDlgState;
          return AlertDialog(
            backgroundColor: const Color(0xFF131520),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            title: Row(children: [
              const Icon(Icons.download_rounded, color: Color(0xFF00E5FF), size: 22),
              const SizedBox(width: 10),
              const Expanded(
                child: Text('Downloading Song', style: TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold)),
              ),
            ]),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  track.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: Colors.white.withOpacity(0.8), fontSize: 13, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 16),
                ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: LinearProgressIndicator(
                    value: progressValue > 0 ? progressValue : null,
                    backgroundColor: Colors.white12,
                    valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF00E5FF)),
                    minHeight: 6,
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  statusText,
                  style: TextStyle(color: Colors.white.withOpacity(0.55), fontSize: 12),
                ),
              ],
            ),
          );
        },
      ),
    );

    final player = context.read<PlayerProvider>();
    final success = await player.downloadToLocal(
      track,
      onProgress: (p) {
        progressValue = p;
        statusText = '${(p * 100).toStringAsFixed(0)}% downloaded';
        dialogSetState?.call(() {});
      },
    );

    if (context.mounted) {
      Navigator.of(context, rootNavigator: true).pop();

      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(success
            ? '✓ "${track.title}" downloaded to your device!'
            : '✗ Download failed. Please try again.'),
        behavior: SnackBarBehavior.floating,
        backgroundColor: success ? const Color(0xFF1DB954) : Colors.redAccent,
        duration: const Duration(seconds: 3),
      ));
    }
  }

  void _showSleepTimerSheet(BuildContext context, PlayerProvider player) {
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF131520),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (_) => _SleepTimerSheet(player: player),
    );
  }

  void _showQueueSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0E1018),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (_) => DraggableScrollableSheet(
        initialChildSize: 0.82,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        expand: false,
        builder: (_, sc) => _QueueSheet(scrollController: sc),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final player = context.watch<PlayerProvider>();
    final track = player.currentTrack;

    // Sync artwork animation with play state
    if (player.isPlaying != _prevPlaying) {
      _prevPlaying = player.isPlaying;
      if (player.isPlaying) {
        _artworkAnimController.forward();
      } else {
        _artworkAnimController.reverse();
      }
    }

    if (track == null) {
      return Scaffold(
        backgroundColor: const Color(0xFF080A0F),
        appBar: AppBar(backgroundColor: Colors.transparent, elevation: 0),
        body: const Center(
          child: Text('No track playing', style: TextStyle(color: Colors.white70)),
        ),
      );
    }

    final isYt = track.isYouTube;
    final accentColor = isYt ? const Color(0xFFFF1744) : const Color(0xFF00E5FF);
    final totalMs = player.duration.inMilliseconds.toDouble();
    final currentMs = (_dragValue ?? player.position.inMilliseconds.toDouble())
        .clamp(0.0, totalMs > 0 ? totalMs : 1.0);

    return Scaffold(
      backgroundColor: const Color(0xFF080A0F),
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              accentColor.withOpacity(0.2),
              const Color(0xFF080A0F),
              const Color(0xFF080A0F),
            ],
            stops: const [0.0, 0.4, 1.0],
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              // ── Header ───────────────────────────────────────────────────
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 4, 4, 0),
                child: Row(
                  children: [
                    IconButton(
                      icon: const Icon(Icons.keyboard_arrow_down_rounded, size: 34, color: Colors.white),
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                    const Spacer(),
                    Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'NOW PLAYING',
                          style: TextStyle(
                            fontSize: 9,
                            letterSpacing: 2.5,
                            fontWeight: FontWeight.bold,
                            color: Colors.white.withOpacity(0.4),
                          ),
                        ),
                        const SizedBox(height: 4),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
                          decoration: BoxDecoration(
                            color: accentColor.withOpacity(0.13),
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(color: accentColor.withOpacity(0.35)),
                          ),
                          child: Text(
                            isYt ? 'YouTube Stream' : 'Local Music',
                            style: TextStyle(
                              fontSize: 10.5,
                              fontWeight: FontWeight.bold,
                              color: accentColor,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const Spacer(),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        IconButton(
                          icon: Icon(
                            Icons.timer_outlined,
                            color: player.hasActiveSleepTimer ? accentColor : Colors.white54,
                            size: 21,
                          ),
                          onPressed: () => _showSleepTimerSheet(context, player),
                        ),
                        IconButton(
                          icon: const Icon(Icons.queue_music_rounded, color: Colors.white54, size: 21),
                          onPressed: () => _showQueueSheet(context),
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              // ── Artwork ───────────────────────────────────────────────────
              Expanded(
                flex: 5,
                child: Center(
                  child: AnimatedBuilder(
                    animation: _artworkScaleAnim,
                    builder: (_, child) => Transform.scale(
                      scale: _artworkScaleAnim.value,
                      child: child,
                    ),
                    child: Hero(
                      tag: 'artwork_${track.id}',
                      child: Container(
                        width: MediaQuery.of(context).size.width * 0.80,
                        height: MediaQuery.of(context).size.width * 0.80,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(24),
                          boxShadow: [
                            BoxShadow(
                              color: accentColor.withOpacity(0.32),
                              blurRadius: 44,
                              offset: const Offset(0, 20),
                            ),
                            BoxShadow(
                              color: Colors.black.withOpacity(0.7),
                              blurRadius: 24,
                              offset: const Offset(0, 10),
                            ),
                          ],
                        ),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(24),
                          child: _artworkWidget(track, accentColor),
                        ),
                      ),
                    ),
                  ),
                ),
              ),

              const SizedBox(height: 22),

              // ── Title, Artist & Action Buttons ────────────────────────────
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 28),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            track.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 22,
                              fontWeight: FontWeight.bold,
                              color: Colors.white,
                              letterSpacing: -0.5,
                            ),
                          ),
                          const SizedBox(height: 5),
                          Text(
                            track.artist,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 15,
                              color: Colors.white.withOpacity(0.5),
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (isYt)
                      IconButton(
                        icon: const Icon(Icons.download_rounded, size: 26),
                        color: Colors.white60,
                        tooltip: 'Download to device',
                        onPressed: () => _showDownloadDialog(context, track),
                      ),
                    IconButton(
                      icon: Icon(
                        player.isFavorite(track.id)
                            ? Icons.favorite_rounded
                            : Icons.favorite_border_rounded,
                        size: 26,
                      ),
                      color: player.isFavorite(track.id)
                          ? const Color(0xFFFF1744)
                          : Colors.white60,
                      onPressed: () => player.toggleFavorite(track),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 22),

              // ── Scrubber ──────────────────────────────────────────────────
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Column(
                  children: [
                    SliderTheme(
                      data: SliderTheme.of(context).copyWith(
                        trackHeight: 3.5,
                        thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 7),
                        overlayShape: const RoundSliderOverlayShape(overlayRadius: 18),
                        activeTrackColor: accentColor,
                        inactiveTrackColor: Colors.white.withOpacity(0.1),
                        thumbColor: Colors.white,
                        overlayColor: accentColor.withOpacity(0.18),
                      ),
                      child: Slider(
                        min: 0,
                        max: totalMs > 0 ? totalMs : 1.0,
                        value: currentMs,
                        onChanged: (v) => setState(() => _dragValue = v),
                        onChangeEnd: (v) {
                          player.seek(Duration(milliseconds: v.toInt()));
                          setState(() => _dragValue = null);
                        },
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            _formatDuration(Duration(milliseconds: currentMs.toInt())),
                            style: TextStyle(color: Colors.white.withOpacity(0.38), fontSize: 11.5),
                          ),
                          Text(
                            '-${_formatDuration(Duration(milliseconds: (totalMs - currentMs).toInt().clamp(0, 99999999)))}',
                            style: TextStyle(color: Colors.white.withOpacity(0.38), fontSize: 11.5),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 8),

              // ── Playback Controls ─────────────────────────────────────────
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 28),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    // Shuffle
                    _CtrlBtn(
                      icon: Icons.shuffle_rounded,
                      color: player.isShuffle ? accentColor : Colors.white30,
                      size: 25,
                      onTap: () { HapticFeedback.lightImpact(); player.toggleShuffle(); },
                    ),
                    // Skip Previous
                    _CtrlBtn(
                      icon: Icons.skip_previous_rounded,
                      color: Colors.white,
                      size: 42,
                      onTap: () { HapticFeedback.lightImpact(); player.skipPrevious(); },
                    ),
                    // Play / Pause
                    GestureDetector(
                      onTap: () { HapticFeedback.mediumImpact(); player.togglePlayPause(); },
                      child: Container(
                        width: 72,
                        height: 72,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: Colors.white,
                          boxShadow: [
                            BoxShadow(
                              color: Colors.white.withOpacity(0.28),
                              blurRadius: 22,
                              offset: const Offset(0, 5),
                            ),
                          ],
                        ),
                        child: player.isBuffering
                            ? Padding(
                                padding: const EdgeInsets.all(22),
                                child: CircularProgressIndicator(color: accentColor, strokeWidth: 3),
                              )
                            : Icon(
                                player.isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
                                size: 42,
                                color: Colors.black,
                              ),
                      ),
                    ),
                    // Skip Next
                    _CtrlBtn(
                      icon: Icons.skip_next_rounded,
                      color: Colors.white,
                      size: 42,
                      onTap: () { HapticFeedback.lightImpact(); player.skipNext(); },
                    ),
                    // Repeat
                    _CtrlBtn(
                      icon: player.repeatMode == PlaybackRepeatMode.one
                          ? Icons.repeat_one_rounded
                          : Icons.repeat_rounded,
                      color: player.repeatMode != PlaybackRepeatMode.off ? accentColor : Colors.white30,
                      size: 25,
                      onTap: () { HapticFeedback.lightImpact(); player.toggleRepeat(); },
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 28),
            ],
          ),
        ),
      ),
    );
  }

  Widget _artworkWidget(Track track, Color accentColor) {
    if (track.audioId != null) {
      return QueryArtworkWidget(
        id: track.audioId!,
        type: ArtworkType.AUDIO,
        artworkWidth: double.infinity,
        artworkHeight: double.infinity,
        artworkFit: BoxFit.cover,
        nullArtworkWidget: _artworkPlaceholder(accentColor),
      );
    }
    if (track.thumbnailUrl.isNotEmpty) {
      return CachedNetworkImage(
        imageUrl: track.thumbnailUrl,
        fit: BoxFit.cover,
        placeholder: (_, __) => _artworkPlaceholder(accentColor),
        errorWidget: (_, __, ___) => _artworkPlaceholder(accentColor),
      );
    }
    return _artworkPlaceholder(accentColor);
  }

  Widget _artworkPlaceholder(Color accent) => Container(
    color: accent.withOpacity(0.08),
    child: Center(
      child: Icon(Icons.music_note_rounded, size: 90, color: accent.withOpacity(0.3)),
    ),
  );
}

// ── Helper Widgets ──────────────────────────────────────────────────────────

class _CtrlBtn extends StatelessWidget {
  final IconData icon;
  final Color color;
  final double size;
  final VoidCallback onTap;
  const _CtrlBtn({required this.icon, required this.color, required this.size, required this.onTap});

  @override
  Widget build(BuildContext context) => GestureDetector(
    behavior: HitTestBehavior.opaque,
    onTap: onTap,
    child: Padding(
      padding: const EdgeInsets.all(6),
      child: Icon(icon, color: color, size: size),
    ),
  );
}

// ── Sleep Timer Sheet ────────────────────────────────────────────────────────

class _SleepTimerSheet extends StatelessWidget {
  final PlayerProvider player;
  const _SleepTimerSheet({required this.player});

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: 12),
          Container(
            width: 42, height: 4,
            decoration: BoxDecoration(color: Colors.white20, borderRadius: BorderRadius.circular(2)),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 18),
            child: Text(
              'Sleep Timer',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
            ),
          ),
          ...[15, 30, 45, 60].map((mins) => ListTile(
            leading: const Icon(Icons.timer_outlined, color: Colors.white70),
            title: Text('$mins Minutes', style: const TextStyle(color: Colors.white)),
            onTap: () { player.setSleepTimer(mins); Navigator.pop(context); },
          )),
          if (player.hasActiveSleepTimer)
            ListTile(
              leading: const Icon(Icons.timer_off_outlined, color: Color(0xFFFF1744)),
              title: const Text('Turn Off Timer', style: TextStyle(color: Color(0xFFFF1744))),
              onTap: () { player.cancelSleepTimer(); Navigator.pop(context); },
            ),
          const SizedBox(height: 20),
        ],
      ),
    );
  }
}

// ── Queue Sheet ───────────────────────────────────────────────────────────────

class _QueueSheet extends StatelessWidget {
  final ScrollController scrollController;
  const _QueueSheet({required this.scrollController});

  @override
  Widget build(BuildContext context) {
    return Consumer<PlayerProvider>(
      builder: (context, player, _) {
        final current = player.currentTrack;
        final queue = player.queue;
        final suggestions = player.suggestedTracks;
        final isYt = current?.isYouTube ?? false;
        final accentColor = isYt ? const Color(0xFFFF1744) : const Color(0xFF00E5FF);

        return Column(
          children: [
            const SizedBox(height: 12),
            Container(
              width: 42, height: 4,
              decoration: BoxDecoration(color: Colors.white20, borderRadius: BorderRadius.circular(2)),
            ),

            // Header
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 14, 12),
              child: Row(
                children: [
                  const Text(
                    'Queue & Up Next',
                    style: TextStyle(fontSize: 19, fontWeight: FontWeight.bold, color: Colors.white),
                  ),
                  const Spacer(),
                  // Autoplay toggle
                  GestureDetector(
                    onTap: () => player.toggleAutoplay(),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        color: player.autoplay
                            ? const Color(0xFF1DB954).withOpacity(0.15)
                            : Colors.white.withOpacity(0.06),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: player.autoplay
                              ? const Color(0xFF1DB954).withOpacity(0.4)
                              : Colors.white12,
                        ),
                      ),
                      child: Row(mainAxisSize: MainAxisSize.min, children: [
                        Icon(
                          Icons.all_inclusive_rounded,
                          size: 14,
                          color: player.autoplay ? const Color(0xFF1DB954) : Colors.grey,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          player.autoplay ? 'Auto ON' : 'Auto OFF',
                          style: TextStyle(
                            fontSize: 10.5,
                            fontWeight: FontWeight.bold,
                            color: player.autoplay ? const Color(0xFF1DB954) : Colors.grey,
                          ),
                        ),
                      ]),
                    ),
                  ),
                  if (queue.isNotEmpty) ...[
                    const SizedBox(width: 6),
                    TextButton(
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 6),
                        minimumSize: Size.zero,
                      ),
                      onPressed: () => player.clearQueue(),
                      child: Text('Clear', style: TextStyle(color: Colors.white38, fontSize: 12)),
                    ),
                  ],
                ],
              ),
            ),

            Divider(color: Colors.white.withOpacity(0.07), height: 1),

            // Content
            Expanded(
              child: ListView(
                controller: scrollController,
                padding: const EdgeInsets.only(bottom: 30),
                children: [
                  // Now Playing
                  if (current != null) ...[
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                      child: Text(
                        'NOW PLAYING',
                        style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 1.5, color: accentColor),
                      ),
                    ),
                    _NowPlayingCard(track: current, accentColor: accentColor, isPlaying: player.isPlaying),
                  ],

                  // Up Next label
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
                    child: Row(children: [
                      Text(
                        'Up Next',
                        style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.white.withOpacity(0.85)),
                      ),
                      const SizedBox(width: 8),
                      Text('(${queue.length})', style: TextStyle(color: Colors.white38, fontSize: 13)),
                    ]),
                  ),

                  if (queue.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                      child: Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.04),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: Colors.white.withOpacity(0.07)),
                        ),
                        child: Row(children: [
                          const Icon(Icons.auto_awesome, color: Color(0xFF1DB954), size: 20),
                          const SizedBox(width: 12),
                          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            const Text('Endless Flow Active', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
                            const SizedBox(height: 2),
                            Text(
                              player.autoplay ? 'Autoplay streams similar tracks continuously.' : 'Add songs to continue.',
                              style: TextStyle(color: Colors.white38, fontSize: 11),
                            ),
                          ])),
                        ]),
                      ),
                    )
                  else
                    ReorderableListView.builder(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      itemCount: queue.length,
                      onReorder: (o, n) => player.reorderQueue(o, n),
                      itemBuilder: (_, i) {
                        final t = queue[i];
                        return Dismissible(
                          key: ValueKey('${t.id}_$i'),
                          direction: DismissDirection.endToStart,
                          background: Container(
                            alignment: Alignment.centerRight,
                            padding: const EdgeInsets.only(right: 20),
                            decoration: BoxDecoration(
                              color: Colors.red.withOpacity(0.65),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: const Icon(Icons.delete_outline, color: Colors.white),
                          ),
                          onDismissed: (_) => player.removeFromQueue(i),
                          child: _QueueItem(
                            track: t,
                            onTap: () => player.playTrack(t),
                            onRemove: () => player.removeFromQueue(i),
                          ),
                        );
                      },
                    ),

                  // Smart Suggestions
                  if (suggestions.isNotEmpty) ...[
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 24, 20, 8),
                      child: Row(children: [
                        const Icon(Icons.auto_awesome, color: Color(0xFF7C4DFF), size: 15),
                        const SizedBox(width: 8),
                        const Text('Smart Picks', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.white)),
                        const Spacer(),
                        Text('Based on vibe', style: TextStyle(color: Colors.white30, fontSize: 11)),
                      ]),
                    ),
                    ListView.builder(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      itemCount: suggestions.length.clamp(0, 10),
                      itemBuilder: (_, i) {
                        final t = suggestions[i];
                        return _QueueItem(
                          track: t,
                          onTap: () => player.playTrack(t),
                          trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                            IconButton(
                              icon: const Icon(Icons.playlist_play_rounded, size: 20, color: Colors.white54),
                              onPressed: () {
                                player.playNext(t);
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(content: Text('Playing "${t.title}" next'), behavior: SnackBarBehavior.floating, duration: const Duration(seconds: 2)),
                                );
                              },
                              padding: EdgeInsets.zero,
                              constraints: const BoxConstraints(minWidth: 32),
                            ),
                            IconButton(
                              icon: const Icon(Icons.add_rounded, size: 20, color: Color(0xFF7C4DFF)),
                              onPressed: () {
                                player.addSuggestedToQueue(t);
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(content: Text('Added "${t.title}" to queue'), behavior: SnackBarBehavior.floating, duration: const Duration(seconds: 2)),
                                );
                              },
                              padding: EdgeInsets.zero,
                              constraints: const BoxConstraints(minWidth: 32),
                            ),
                          ]),
                        );
                      },
                    ),
                  ],
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

class _NowPlayingCard extends StatelessWidget {
  final Track track;
  final Color accentColor;
  final bool isPlaying;
  const _NowPlayingCard({required this.track, required this.accentColor, required this.isPlaying});

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: accentColor.withOpacity(0.07),
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: accentColor.withOpacity(0.22)),
    ),
    child: Row(children: [
      ClipRRect(
        borderRadius: BorderRadius.circular(10),
        child: SizedBox(width: 46, height: 46,
          child: track.audioId != null
              ? QueryArtworkWidget(id: track.audioId!, type: ArtworkType.AUDIO, artworkWidth: 46, artworkHeight: 46, artworkFit: BoxFit.cover, nullArtworkWidget: const Icon(Icons.music_note, color: Colors.white54))
              : track.thumbnailUrl.isNotEmpty
                  ? CachedNetworkImage(imageUrl: track.thumbnailUrl, fit: BoxFit.cover, errorWidget: (_, __, ___) => const Icon(Icons.music_note, color: Colors.white54))
                  : const Icon(Icons.music_note, color: Colors.white54),
        ),
      ),
      const SizedBox(width: 12),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(track.title, maxLines: 1, overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13.5)),
        Text(track.artist, maxLines: 1, overflow: TextOverflow.ellipsis,
            style: TextStyle(color: Colors.white38, fontSize: 12)),
      ])),
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(color: accentColor.withOpacity(0.18), borderRadius: BorderRadius.circular(8)),
        child: Icon(isPlaying ? Icons.graphic_eq_rounded : Icons.pause_rounded, color: accentColor, size: 16),
      ),
    ]),
  );
}

class _QueueItem extends StatelessWidget {
  final Track track;
  final VoidCallback onTap;
  final VoidCallback? onRemove;
  final Widget? trailing;
  const _QueueItem({required this.track, required this.onTap, this.onRemove, this.trailing});

  @override
  Widget build(BuildContext context) => ListTile(
    dense: true,
    contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 2),
    onTap: onTap,
    leading: ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: SizedBox(width: 42, height: 42,
        child: track.audioId != null
            ? QueryArtworkWidget(id: track.audioId!, type: ArtworkType.AUDIO, artworkWidth: 42, artworkHeight: 42, artworkFit: BoxFit.cover, nullArtworkWidget: const Icon(Icons.music_note, color: Colors.white54))
            : track.thumbnailUrl.isNotEmpty
                ? CachedNetworkImage(imageUrl: track.thumbnailUrl, fit: BoxFit.cover, errorWidget: (_, __, ___) => const Icon(Icons.music_note, color: Colors.white54))
                : const Icon(Icons.music_note, color: Colors.white54),
      ),
    ),
    title: Text(track.title, maxLines: 1, overflow: TextOverflow.ellipsis,
        style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600)),
    subtitle: Text(track.artist, maxLines: 1, overflow: TextOverflow.ellipsis,
        style: TextStyle(color: Colors.white38, fontSize: 11.5)),
    trailing: trailing ?? (onRemove != null
        ? Row(mainAxisSize: MainAxisSize.min, children: [
            IconButton(
              icon: const Icon(Icons.close_rounded, color: Colors.white24, size: 17),
              onPressed: onRemove,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 28),
            ),
            const Icon(Icons.drag_handle_rounded, color: Colors.white20, size: 18),
          ])
        : null),
  );
}

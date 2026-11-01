import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:on_audio_query/on_audio_query.dart';
import 'package:provider/provider.dart';
import '../models/track.dart';
import '../providers/player_provider.dart';
import '../widgets/track_tile.dart';

class PlayerScreen extends StatefulWidget {
  const PlayerScreen({super.key});

  @override
  State<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends State<PlayerScreen> {
  double? _dragValue;

  String _formatDuration(Duration duration) {
    final minutes = duration.inMinutes;
    final seconds = duration.inSeconds % 60;
    return '$minutes:${seconds.toString().padLeft(2, '0')}';
  }

  void _showSleepTimerSheet(BuildContext context) {
    final player = context.read<PlayerProvider>();
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1E2430),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 12),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.grey.shade600,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text(
                  'Sleep Timer',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
              ),
              ListTile(
                leading: const Icon(Icons.timer_outlined, color: Colors.white70),
                title: const Text('15 Minutes', style: TextStyle(color: Colors.white)),
                onTap: () {
                  player.setSleepTimer(15);
                  Navigator.pop(context);
                },
              ),
              ListTile(
                leading: const Icon(Icons.timer_outlined, color: Colors.white70),
                title: const Text('30 Minutes', style: TextStyle(color: Colors.white)),
                onTap: () {
                  player.setSleepTimer(30);
                  Navigator.pop(context);
                },
              ),
              ListTile(
                leading: const Icon(Icons.timer_outlined, color: Colors.white70),
                title: const Text('45 Minutes', style: TextStyle(color: Colors.white)),
                onTap: () {
                  player.setSleepTimer(45);
                  Navigator.pop(context);
                },
              ),
              ListTile(
                leading: const Icon(Icons.timer_outlined, color: Colors.white70),
                title: const Text('1 Hour', style: TextStyle(color: Colors.white)),
                onTap: () {
                  player.setSleepTimer(60);
                  Navigator.pop(context);
                },
              ),
              if (player.hasActiveSleepTimer)
                ListTile(
                  leading: const Icon(Icons.timer_off_outlined, color: Colors.redAccent),
                  title: const Text('Turn Off Timer', style: TextStyle(color: Colors.redAccent)),
                  onTap: () {
                    player.cancelSleepTimer();
                    Navigator.pop(context);
                  },
                ),
              const SizedBox(height: 16),
            ],
          ),
        );
      },
    );
  }

  void _showQueueSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1E2430),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        return Consumer<PlayerProvider>(
          builder: (context, player, child) {
            return SafeArea(
              child: Column(
                children: [
                  const SizedBox(height: 12),
                  Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.grey.shade600,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        const Text(
                          'Up Next Queue',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            color: Colors.white,
                          ),
                        ),
                        const Spacer(),
                        Text(
                          '${player.queue.length} tracks',
                          style: TextStyle(color: Colors.grey.shade400),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: player.queue.isEmpty
                        ? Center(
                            child: Text(
                              'Queue is empty.\nAutoplay will choose next track!',
                              textAlign: TextAlign.center,
                              style: TextStyle(color: Colors.grey.shade400),
                            ),
                          )
                        : ReorderableListView.builder(
                            itemCount: player.queue.length,
                            onReorder: (oldIndex, newIndex) =>
                                player.reorderQueue(oldIndex, newIndex),
                            itemBuilder: (context, index) {
                              final track = player.queue[index];
                              return Dismissible(
                                key: ValueKey(track.id + index.toString()),
                                direction: DismissDirection.endToStart,
                                background: Container(
                                  color: Colors.redAccent,
                                  alignment: Alignment.centerRight,
                                  padding: const EdgeInsets.only(right: 20),
                                  child: const Icon(Icons.delete, color: Colors.white),
                                ),
                                onDismissed: (_) => player.removeFromQueue(index),
                                child: TrackTile(
                                  track: track,
                                  onTap: () => player.playTrack(track),
                                ),
                              );
                            },
                          ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final player = context.watch<PlayerProvider>();
    final track = player.currentTrack;

    if (track == null) {
      return Scaffold(
        appBar: AppBar(),
        body: const Center(child: Text('No track playing')),
      );
    }

    final isFav = player.isFavorite(track.id);
    final totalDuration = player.duration.inMilliseconds.toDouble();
    final currentPos = (_dragValue ?? player.position.inMilliseconds.toDouble())
        .clamp(0.0, totalDuration > 0 ? totalDuration : 1.0);

    final isYt = track.isYouTube;
    final accentColor = isYt ? const Color(0xFFFF334B) : const Color(0xFF2DD4BF);

    return Scaffold(
      backgroundColor: const Color(0xFF10141D),
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              accentColor.withOpacity(0.18),
              const Color(0xFF10141D),
            ],
            stops: const [0.0, 0.45],
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              // Header with swipe down
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.keyboard_arrow_down_rounded, size: 36, color: Colors.white),
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                    Column(
                      children: [
                        const Text(
                          'NOW PLAYING',
                          style: TextStyle(
                            fontSize: 10,
                            letterSpacing: 1.5,
                            fontWeight: FontWeight.bold,
                            color: Colors.grey,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: accentColor.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: accentColor.withOpacity(0.3)),
                          ),
                          child: Text(
                            isYt ? 'YouTube Stream' : 'Local Storage',
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                              color: accentColor,
                            ),
                          ),
                        ),
                      ],
                    ),
                    Row(
                      children: [
                        IconButton(
                          icon: Icon(
                            Icons.timer_outlined,
                            color: player.hasActiveSleepTimer ? accentColor : Colors.white70,
                          ),
                          onPressed: () => _showSleepTimerSheet(context),
                        ),
                        IconButton(
                          icon: const Icon(Icons.queue_music_rounded, color: Colors.white70),
                          onPressed: () => _showQueueSheet(context),
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              const Spacer(),

              // Album Artwork with Shadow
              Center(
                child: Hero(
                  tag: 'artwork_${track.id}',
                  child: Container(
                    width: MediaQuery.of(context).size.width * 0.78,
                    height: MediaQuery.of(context).size.width * 0.78,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(22),
                      boxShadow: [
                        BoxShadow(
                          color: accentColor.withOpacity(0.25),
                          blurRadius: 35,
                          offset: const Offset(0, 12),
                        ),
                        BoxShadow(
                          color: Colors.black.withOpacity(0.6),
                          blurRadius: 20,
                          offset: const Offset(0, 8),
                        ),
                      ],
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(22),
                      child: track.audioId != null
                          ? QueryArtworkWidget(
                              id: track.audioId!,
                              type: ArtworkType.AUDIO,
                              artworkWidth: double.infinity,
                              artworkHeight: double.infinity,
                              artworkFit: BoxFit.cover,
                              nullArtworkWidget: Container(
                                color: const Color(0xFF161B26),
                                child: const Icon(Icons.music_note, size: 80, color: Colors.white24),
                              ),
                            )
                          : track.thumbnailUrl.isNotEmpty
                              ? CachedNetworkImage(
                                  imageUrl: track.thumbnailUrl,
                                  fit: BoxFit.cover,
                                  placeholder: (_, __) => Container(
                                    color: const Color(0xFF161B26),
                                    child: const Center(child: CircularProgressIndicator(strokeWidth: 2)),
                                  ),
                                  errorWidget: (_, __, ___) => Container(
                                    color: const Color(0xFF161B26),
                                    child: const Icon(Icons.music_note, size: 80, color: Colors.white24),
                                  ),
                                )
                              : Container(
                                  color: const Color(0xFF161B26),
                                  child: const Icon(Icons.music_note, size: 80, color: Colors.white24),
                                ),
                    ),
                  ),
                ),
              ),

              const Spacer(),

              // Title & Artist & Favorite
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
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
                              fontSize: 21,
                              fontWeight: FontWeight.bold,
                              color: Colors.white,
                              letterSpacing: -0.3,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            track.artist,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 15,
                              color: Colors.grey.shade400,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (isYt)
                      IconButton(
                        tooltip: 'Download to Local',
                        icon: const Icon(Icons.download_rounded, color: Colors.white70),
                        onPressed: () async {
                          final ok = await player.downloadToLocal(track);
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text(ok
                                    ? 'Downloading "${track.title}" to local storage...'
                                    : 'Download failed. Is server connected?'),
                              ),
                            );
                          }
                        },
                      ),
                    IconButton(
                      icon: Icon(
                        isFav ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                        color: isFav ? Colors.redAccent : Colors.white70,
                        size: 28,
                      ),
                      onPressed: () => player.toggleFavorite(track),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 14),

              // Scrub Slider
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: SliderTheme(
                  data: SliderTheme.of(context).copyWith(
                    trackHeight: 4,
                    thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6),
                    overlayShape: const RoundSliderOverlayShape(overlayRadius: 14),
                    activeTrackColor: accentColor,
                    inactiveTrackColor: Colors.white12,
                    thumbColor: Colors.white,
                  ),
                  child: Slider(
                    min: 0.0,
                    max: totalDuration > 0 ? totalDuration : 1.0,
                    value: currentPos,
                    onChanged: (val) {
                      setState(() {
                        _dragValue = val;
                      });
                    },
                    onChangeEnd: (val) {
                      player.seek(Duration(milliseconds: val.toInt()));
                      setState(() {
                        _dragValue = null;
                      });
                    },
                  ),
                ),
              ),

              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      _formatDuration(Duration(milliseconds: currentPos.toInt())),
                      style: TextStyle(color: Colors.grey.shade500, fontSize: 12),
                    ),
                    Text(
                      '-${_formatDuration(Duration(milliseconds: (totalDuration - currentPos).toInt().clamp(0, 99999999)))}',
                      style: TextStyle(color: Colors.grey.shade500, fontSize: 12),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 14),

              // Primary Playback Controls
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    IconButton(
                      icon: Icon(
                        Icons.shuffle_rounded,
                        color: player.isShuffle ? accentColor : Colors.grey,
                        size: 24,
                      ),
                      onPressed: () => player.toggleShuffle(),
                    ),
                    IconButton(
                      icon: const Icon(Icons.skip_previous_rounded, color: Colors.white, size: 40),
                      onPressed: () => player.skipPrevious(),
                    ),
                    Container(
                      width: 70,
                      height: 70,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.white,
                        boxShadow: [
                          BoxShadow(
                            color: Colors.white.withOpacity(0.25),
                            blurRadius: 18,
                            offset: const Offset(0, 4),
                          ),
                        ],
                      ),
                      child: player.isBuffering
                          ? const Padding(
                              padding: EdgeInsets.all(22),
                              child: CircularProgressIndicator(color: Colors.black, strokeWidth: 3),
                            )
                          : IconButton(
                              icon: Icon(
                                player.isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
                                size: 40,
                                color: Colors.black,
                              ),
                              onPressed: () => player.togglePlayPause(),
                            ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.skip_next_rounded, color: Colors.white, size: 40),
                      onPressed: () => player.skipNext(),
                    ),
                    IconButton(
                      icon: Icon(
                        player.repeatMode == PlaybackRepeatMode.one
                            ? Icons.repeat_one_rounded
                            : Icons.repeat_rounded,
                        color: player.repeatMode != PlaybackRepeatMode.off ? accentColor : Colors.grey,
                        size: 24,
                      ),
                      onPressed: () => player.toggleRepeat(),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 20),
            ],
          ),
        ),
      ),
    );
  }
}

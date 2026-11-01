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
      isScrollControlled: true,
      backgroundColor: const Color(0xFF131722),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return DraggableScrollableSheet(
          initialChildSize: 0.78,
          minChildSize: 0.5,
          maxChildSize: 0.94,
          expand: false,
          builder: (context, scrollController) {
            return Consumer<PlayerProvider>(
              builder: (context, player, child) {
                final current = player.currentTrack;
                final queue = player.queue;
                final suggestions = player.suggestedTracks;
                final isYt = current?.isYouTube ?? false;
                final accentColor = isYt ? const Color(0xFFFF334B) : const Color(0xFF2DD4BF);

                return Column(
                  children: [
                    const SizedBox(height: 10),
                    Container(
                      width: 42,
                      height: 4,
                      decoration: BoxDecoration(
                        color: Colors.white24,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                    // Header Bar with Autoplay & Clear
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 14, 16, 12),
                      child: Row(
                        children: [
                          const Text(
                            'Playing & Up Next',
                            style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                              color: Colors.white,
                              letterSpacing: -0.3,
                            ),
                          ),
                          const Spacer(),
                          // Infinity Autoplay Button
                          GestureDetector(
                            onTap: () => player.toggleAutoplay(),
                            child: AnimatedContainer(
                              duration: const Duration(milliseconds: 200),
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                              decoration: BoxDecoration(
                                color: player.autoplay
                                    ? const Color(0xFF10B981).withOpacity(0.18)
                                    : Colors.white.withOpacity(0.06),
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(
                                  color: player.autoplay
                                      ? const Color(0xFF10B981).withOpacity(0.5)
                                      : Colors.white12,
                                ),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    Icons.all_inclusive_rounded,
                                    size: 16,
                                    color: player.autoplay
                                        ? const Color(0xFF10B981)
                                        : Colors.grey,
                                  ),
                                  const SizedBox(width: 5),
                                  Text(
                                    player.autoplay ? 'Autoplay: ON' : 'Autoplay: OFF',
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.bold,
                                      color: player.autoplay
                                          ? const Color(0xFF10B981)
                                          : Colors.grey,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          if (queue.isNotEmpty) ...[
                            const SizedBox(width: 8),
                            TextButton(
                              style: TextButton.styleFrom(
                                padding: const EdgeInsets.symmetric(horizontal: 8),
                                minimumSize: Size.zero,
                                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              ),
                              onPressed: () => player.clearQueue(),
                              child: const Text(
                                'Clear',
                                style: TextStyle(color: Colors.grey, fontSize: 13),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    const Divider(color: Colors.white10, height: 1),

                    // Scrollable content
                    Expanded(
                      child: ListView(
                        controller: scrollController,
                        padding: const EdgeInsets.only(bottom: 30),
                        children: [
                          // Now Playing Card
                          if (current != null) ...[
                            Padding(
                              padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                              child: Text(
                                'NOW PLAYING',
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold,
                                  letterSpacing: 1.2,
                                  color: accentColor,
                                ),
                              ),
                            ),
                            Container(
                              margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: accentColor.withOpacity(0.08),
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(color: accentColor.withOpacity(0.25)),
                              ),
                              child: Row(
                                children: [
                                  ClipRRect(
                                    borderRadius: BorderRadius.circular(10),
                                    child: SizedBox(
                                      width: 48,
                                      height: 48,
                                      child: current.audioId != null
                                          ? QueryArtworkWidget(
                                              id: current.audioId!,
                                              type: ArtworkType.AUDIO,
                                              artworkWidth: 48,
                                              artworkHeight: 48,
                                              artworkFit: BoxFit.cover,
                                              nullArtworkWidget: const Icon(Icons.music_note, color: Colors.white54),
                                            )
                                          : current.thumbnailUrl.isNotEmpty
                                              ? CachedNetworkImage(
                                                  imageUrl: current.thumbnailUrl,
                                                  fit: BoxFit.cover,
                                                  errorWidget: (_, __, ___) => const Icon(Icons.music_note, color: Colors.white54),
                                                )
                                              : const Icon(Icons.music_note, color: Colors.white54),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          current.title,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(
                                            color: Colors.white,
                                            fontWeight: FontWeight.bold,
                                            fontSize: 14,
                                          ),
                                        ),
                                        const SizedBox(height: 2),
                                        Text(
                                          current.artist,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: TextStyle(
                                            color: Colors.grey.shade400,
                                            fontSize: 12,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                    decoration: BoxDecoration(
                                      color: accentColor.withOpacity(0.2),
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Icon(Icons.graphic_eq_rounded, color: accentColor, size: 16),
                                        const SizedBox(width: 4),
                                        Text(
                                          player.isPlaying ? 'Playing' : 'Paused',
                                          style: TextStyle(
                                            color: accentColor,
                                            fontSize: 10,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],

                          // Up Next Queue Section
                          Padding(
                            padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
                            child: Row(
                              children: [
                                const Text(
                                  'Up Next in Queue',
                                  style: TextStyle(
                                    fontSize: 15,
                                    fontWeight: FontWeight.bold,
                                    color: Colors.white,
                                    letterSpacing: -0.3,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  '(${queue.length})',
                                  style: TextStyle(color: Colors.grey.shade400, fontSize: 13),
                                ),
                              ],
                            ),
                          ),

                          if (queue.isEmpty)
                            Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                              child: Container(
                                padding: const EdgeInsets.all(16),
                                decoration: BoxDecoration(
                                  color: Colors.white.withOpacity(0.04),
                                  borderRadius: BorderRadius.circular(14),
                                  border: Border.all(color: Colors.white.withOpacity(0.06)),
                                ),
                                child: Row(
                                  children: [
                                    const Icon(Icons.auto_awesome, color: Color(0xFF10B981), size: 22),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          const Text(
                                            'Endless Flow Active',
                                            style: TextStyle(
                                              color: Colors.white,
                                              fontWeight: FontWeight.bold,
                                              fontSize: 13,
                                            ),
                                          ),
                                          const SizedBox(height: 2),
                                          Text(
                                            player.autoplay
                                                ? 'Autoplay will seamlessly stream similar calm tracks without stopping.'
                                                : 'Add songs below to continue playing.',
                                            style: TextStyle(
                                              color: Colors.grey.shade400,
                                              fontSize: 11.5,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            )
                          else
                            ReorderableListView.builder(
                              shrinkWrap: true,
                              physics: const NeverScrollableScrollPhysics(),
                              itemCount: queue.length,
                              onReorder: (oldIndex, newIndex) => player.reorderQueue(oldIndex, newIndex),
                              itemBuilder: (context, index) {
                                final track = queue[index];
                                return Dismissible(
                                  key: ValueKey(track.id + index.toString()),
                                  direction: DismissDirection.endToStart,
                                  background: Container(
                                    alignment: Alignment.centerRight,
                                    padding: const EdgeInsets.only(right: 20),
                                    color: Colors.redAccent.withOpacity(0.8),
                                    child: const Icon(Icons.delete_outline_rounded, color: Colors.white),
                                  ),
                                  onDismissed: (_) => player.removeFromQueue(index),
                                  child: ListTile(
                                    dense: true,
                                    contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 2),
                                    leading: ClipRRect(
                                      borderRadius: BorderRadius.circular(8),
                                      child: SizedBox(
                                        width: 42,
                                        height: 42,
                                        child: track.audioId != null
                                            ? QueryArtworkWidget(
                                                id: track.audioId!,
                                                type: ArtworkType.AUDIO,
                                                artworkWidth: 42,
                                                artworkHeight: 42,
                                                artworkFit: BoxFit.cover,
                                                nullArtworkWidget: const Icon(Icons.music_note, color: Colors.white54),
                                              )
                                            : track.thumbnailUrl.isNotEmpty
                                                ? CachedNetworkImage(
                                                    imageUrl: track.thumbnailUrl,
                                                    fit: BoxFit.cover,
                                                    errorWidget: (_, __, ___) => const Icon(Icons.music_note, color: Colors.white54),
                                                  )
                                                : const Icon(Icons.music_note, color: Colors.white54),
                                      ),
                                    ),
                                    title: Text(
                                      track.title,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
                                    ),
                                    subtitle: Text(
                                      track.artist,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(color: Colors.grey.shade400, fontSize: 11.5),
                                    ),
                                    trailing: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        IconButton(
                                          icon: const Icon(Icons.close_rounded, color: Colors.white54, size: 18),
                                          onPressed: () => player.removeFromQueue(index),
                                        ),
                                        const Icon(Icons.drag_handle_rounded, color: Colors.white38, size: 20),
                                      ],
                                    ),
                                    onTap: () => player.playTrack(track),
                                  ),
                                );
                              },
                            ),

                          // Linus Smart Suggestions Section
                          if (suggestions.isNotEmpty) ...[
                            Padding(
                              padding: const EdgeInsets.fromLTRB(20, 24, 20, 8),
                              child: Row(
                                children: [
                                  const Icon(Icons.auto_awesome, color: Color(0xFF38BDF8), size: 16),
                                  const SizedBox(width: 8),
                                  const Text(
                                    'Linus Smart Recommendations',
                                    style: TextStyle(
                                      fontSize: 15,
                                      fontWeight: FontWeight.bold,
                                      color: Colors.white,
                                      letterSpacing: -0.3,
                                    ),
                                  ),
                                  const Spacer(),
                                  Text(
                                    'Based on vibe',
                                    style: TextStyle(color: Colors.grey.shade500, fontSize: 11),
                                  ),
                                ],
                              ),
                            ),
                            ListView.builder(
                              shrinkWrap: true,
                              physics: const NeverScrollableScrollPhysics(),
                              itemCount: suggestions.length.clamp(0, 10),
                              itemBuilder: (context, index) {
                                final track = suggestions[index];
                                return ListTile(
                                  dense: true,
                                  contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 2),
                                  leading: ClipRRect(
                                    borderRadius: BorderRadius.circular(8),
                                    child: SizedBox(
                                      width: 42,
                                      height: 42,
                                      child: track.thumbnailUrl.isNotEmpty
                                          ? CachedNetworkImage(
                                              imageUrl: track.thumbnailUrl,
                                              fit: BoxFit.cover,
                                              errorWidget: (_, __, ___) => const Icon(Icons.music_note, color: Colors.white54),
                                            )
                                          : const Icon(Icons.music_note, color: Colors.white54),
                                    ),
                                  ),
                                  title: Text(
                                    track.title,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
                                  ),
                                  subtitle: Text(
                                    track.artist,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(color: Colors.grey.shade400, fontSize: 11.5),
                                  ),
                                  trailing: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      IconButton(
                                        tooltip: 'Play Next',
                                        icon: const Icon(Icons.playlist_play_rounded, color: Colors.white70, size: 22),
                                        onPressed: () {
                                          player.playNext(track);
                                          ScaffoldMessenger.of(context).showSnackBar(
                                            SnackBar(
                                              content: Text('Playing "${track.title}" next'),
                                              duration: const Duration(seconds: 2),
                                              behavior: SnackBarBehavior.floating,
                                            ),
                                          );
                                        },
                                      ),
                                      IconButton(
                                        tooltip: 'Add to Queue',
                                        icon: const Icon(Icons.add_rounded, color: Color(0xFF38BDF8), size: 22),
                                        onPressed: () {
                                          player.addSuggestedToQueue(track);
                                          ScaffoldMessenger.of(context).showSnackBar(
                                            SnackBar(
                                              content: Text('Added "${track.title}" to queue'),
                                              duration: const Duration(seconds: 2),
                                              behavior: SnackBarBehavior.floating,
                                            ),
                                          );
                                        },
                                      ),
                                    ],
                                  ),
                                  onTap: () => player.playTrack(track),
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

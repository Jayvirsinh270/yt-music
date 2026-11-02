import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:on_audio_query/on_audio_query.dart';
import 'package:provider/provider.dart';
import '../providers/player_provider.dart';
import '../screens/player_screen.dart';

class MiniPlayer extends StatelessWidget {
  const MiniPlayer({super.key});

  @override
  Widget build(BuildContext context) {
    final player = context.watch<PlayerProvider>();
    final track = player.currentTrack;
    if (track == null) return const SizedBox.shrink();

    final isYt = track.isYouTube;
    final accentColor = isYt ? const Color(0xFFFF1744) : const Color(0xFF00E5FF);
    final progress = player.duration.inMilliseconds > 0
        ? (player.position.inMilliseconds / player.duration.inMilliseconds).clamp(0.0, 1.0)
        : 0.0;

    return GestureDetector(
      onTap: () => Navigator.of(context).push(
        PageRouteBuilder(
          pageBuilder: (_, a, __) => const PlayerScreen(),
          transitionDuration: const Duration(milliseconds: 380),
          transitionsBuilder: (_, anim, __, child) => SlideTransition(
            position: Tween<Offset>(begin: const Offset(0, 1), end: Offset.zero)
                .animate(CurvedAnimation(parent: anim, curve: Curves.easeOutQuart)),
            child: FadeTransition(opacity: anim, child: child),
          ),
        ),
      ),
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: const Color(0xFF151820),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: Colors.white.withOpacity(0.08)),
          boxShadow: [
            BoxShadow(color: Colors.black.withOpacity(0.5), blurRadius: 20, offset: const Offset(0, 4)),
            BoxShadow(color: accentColor.withOpacity(0.08), blurRadius: 24, offset: const Offset(0, 2)),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Progress bar at top
            ClipRRect(
              borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
              child: LinearProgressIndicator(
                value: progress,
                backgroundColor: Colors.white.withOpacity(0.06),
                valueColor: AlwaysStoppedAnimation<Color>(accentColor),
                minHeight: 2,
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 8, 6, 10),
              child: Row(
                children: [
                  // Artwork
                  Hero(
                    tag: 'artwork_${track.id}',
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: SizedBox(
                        width: 44, height: 44,
                        child: track.audioId != null
                            ? QueryArtworkWidget(
                                id: track.audioId!, type: ArtworkType.AUDIO,
                                artworkWidth: 44, artworkHeight: 44, artworkFit: BoxFit.cover,
                                nullArtworkWidget: _defaultArt(accentColor),
                              )
                            : track.thumbnailUrl.isNotEmpty
                                ? CachedNetworkImage(
                                    imageUrl: track.thumbnailUrl, fit: BoxFit.cover,
                                    errorWidget: (_, __, ___) => _defaultArt(accentColor),
                                  )
                                : _defaultArt(accentColor),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  // Title & Artist
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          track.title, maxLines: 1, overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13.5),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          track.artist, maxLines: 1, overflow: TextOverflow.ellipsis,
                          style: TextStyle(color: Colors.grey.shade500, fontSize: 11.5),
                        ),
                      ],
                    ),
                  ),
                  // Controls
                  if (player.isBuffering)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      child: SizedBox(
                        width: 22, height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2, color: accentColor),
                      ),
                    )
                  else
                    IconButton(
                      icon: Icon(player.isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded, size: 30),
                      color: Colors.white,
                      onPressed: () => player.togglePlayPause(),
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                    ),
                  IconButton(
                    icon: const Icon(Icons.skip_next_rounded, size: 26, color: Colors.white70),
                    onPressed: () => player.skipNext(),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 36, minHeight: 40),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _defaultArt(Color accent) => Container(
    color: accent.withOpacity(0.15),
    child: Icon(Icons.music_note_rounded, color: accent.withOpacity(0.7), size: 22),
  );
}

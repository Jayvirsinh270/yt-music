import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/track.dart';
import '../providers/player_provider.dart';
import '../widgets/track_tile.dart';

class YouTubeScreen extends StatefulWidget {
  const YouTubeScreen({super.key});

  @override
  State<YouTubeScreen> createState() => _YouTubeScreenState();
}

class _YouTubeScreenState extends State<YouTubeScreen> {
  final TextEditingController _searchController = TextEditingController();
  String _activeChip = 'Trending';

  final List<Map<String, String>> _vibeChips = [
    {'label': 'Trending', 'query': 'Trending Music 2026'},
    {'label': 'Lofi Chill', 'query': 'Lofi hip hop beats chill study'},
    {'label': 'Pop Hits', 'query': 'Top Global Pop Hits'},
    {'label': 'Bollywood', 'query': 'Latest Bollywood Hits Hindi songs'},
    {'label': 'EDM', 'query': 'Electronic EDM party dance'},
    {'label': 'Acoustic', 'query': 'Acoustic peaceful guitar songs'},
    {'label': 'Rock', 'query': 'Rock classics alternative'},
  ];

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchSubmitted(String query) {
    if (query.trim().isNotEmpty) {
      context.read<PlayerProvider>().searchYouTube(query.trim());
      setState(() {
        _activeChip = '';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final player = context.watch<PlayerProvider>();
    final ytTracks = player.youtubeTracks;
    final ytColor = const Color(0xFFFF334B);

    return Scaffold(
      backgroundColor: const Color(0xFF10141D),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Top Header
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: ytColor.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(
                      Icons.play_circle_fill_rounded,
                      color: Color(0xFFFF334B),
                      size: 26,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'YouTube Music',
                          style: TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.bold,
                            color: Colors.white,
                            letterSpacing: -0.5,
                          ),
                        ),
                        Text(
                          'Instant stream • Zero ads',
                          style: TextStyle(
                            fontSize: 12,
                            color: Colors.grey.shade400,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: ytColor.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: ytColor.withOpacity(0.3)),
                    ),
                    child: const Text(
                      'ONLINE',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFFFF334B),
                        letterSpacing: 0.8,
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // Search Bar
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: TextField(
                controller: _searchController,
                onSubmitted: _onSearchSubmitted,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  hintText: 'Search YouTube Music...',
                  hintStyle: TextStyle(color: Colors.grey.shade500, fontSize: 14),
                  prefixIcon: const Icon(Icons.search, color: Colors.grey),
                  suffixIcon: _searchController.text.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear, color: Colors.grey),
                          onPressed: () {
                            _searchController.clear();
                            setState(() {});
                          },
                        )
                      : null,
                  filled: true,
                  fillColor: const Color(0xFF161B26),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
            ),

            // Quick Vibe Chips
            SizedBox(
              height: 48,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                itemCount: _vibeChips.length,
                itemBuilder: (context, index) {
                  final chip = _vibeChips[index];
                  final isSelected = _activeChip == chip['label'];
                  return Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(chip['label']!),
                      selected: isSelected,
                      selectedColor: ytColor.withOpacity(0.2),
                      backgroundColor: const Color(0xFF161B26),
                      labelStyle: TextStyle(
                        color: isSelected ? ytColor : Colors.grey.shade400,
                        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                        fontSize: 12,
                      ),
                      side: BorderSide(
                        color: isSelected ? ytColor.withOpacity(0.5) : Colors.white10,
                      ),
                      onSelected: (selected) {
                        if (selected) {
                          setState(() {
                            _activeChip = chip['label']!;
                            _searchController.clear();
                          });
                          context.read<PlayerProvider>().searchYouTube(chip['query']!);
                        }
                      },
                    ),
                  );
                },
              ),
            ),

            // YouTube Tracks Feed
            Expanded(
              child: player.isLoadingYouTube
                  ? const Center(
                      child: CircularProgressIndicator(color: Color(0xFFFF334B)),
                    )
                  : ytTracks.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(Icons.music_off_rounded, size: 48, color: Colors.grey.shade600),
                              const SizedBox(height: 12),
                              Text(
                                'No YouTube results found',
                                style: TextStyle(color: Colors.grey.shade400),
                              ),
                            ],
                          ),
                        )
                      : RefreshIndicator(
                          onRefresh: () async {
                            await player.searchYouTube(_activeChip.isNotEmpty
                                ? _vibeChips.firstWhere((c) => c['label'] == _activeChip)['query']!
                                : 'Trending Music 2026');
                          },
                          color: ytColor,
                          child: ListView.builder(
                            padding: const EdgeInsets.only(bottom: 90, top: 4),
                            itemCount: ytTracks.length,
                            itemBuilder: (context, index) {
                              final track = ytTracks[index];
                              final isCurrent = player.currentTrack?.id == track.id;
                              return TrackTile(
                                track: track,
                                isCurrent: isCurrent,
                                onTap: () => player.playTrack(track, newQueue: ytTracks),
                              );
                            },
                          ),
                        ),
            ),
          ],
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/track.dart';
import '../providers/player_provider.dart';
import '../services/local_audio_service.dart';
import '../widgets/track_tile.dart';

class SearchScreen extends StatefulWidget {
  final LocalAudioService localAudioService;

  const SearchScreen({super.key, required this.localAudioService});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final TextEditingController _controller = TextEditingController();
  String _searchQuery = '';
  bool _searchYouTube = true; // Toggle: true for YouTube, false for Local Storage

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onSearchChanged(String query) {
    setState(() {
      _searchQuery = query.trim();
    });
    if (_searchYouTube && query.trim().isNotEmpty) {
      context.read<PlayerProvider>().searchYouTube(query.trim());
    }
  }

  @override
  Widget build(BuildContext context) {
    final player = context.watch<PlayerProvider>();
    final allLocalTracks = player.deviceTracks;
    final ytColor = const Color(0xFFFF334B);
    final localColor = Theme.of(context).colorScheme.primary;

    // Filter results
    final List<Track> results;
    if (_searchQuery.isEmpty) {
      results = [];
    } else if (_searchYouTube) {
      results = player.youtubeTracks;
    } else {
      results = widget.localAudioService.searchTracks(allLocalTracks, _searchQuery);
    }

    return Scaffold(
      backgroundColor: const Color(0xFF080A0F),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Title Header
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 16, 20, 8),
              child: Text(
                'Search',
                style: TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                  letterSpacing: -0.5,
                ),
              ),
            ),

            // Separated Source Toggle
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              child: Container(
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(
                  color: const Color(0xFF161B26),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.white10),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: GestureDetector(
                        onTap: () {
                          setState(() {
                            _searchYouTube = true;
                          });
                          if (_searchQuery.isNotEmpty) {
                            player.searchYouTube(_searchQuery);
                          }
                        },
                        child: Container(
                          height: 36,
                          decoration: BoxDecoration(
                            color: _searchYouTube ? ytColor : Colors.transparent,
                            borderRadius: BorderRadius.circular(9),
                          ),
                          alignment: Alignment.center,
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(
                                Icons.play_circle_fill_rounded,
                                size: 16,
                                color: _searchYouTube ? Colors.white : Colors.grey,
                              ),
                              const SizedBox(width: 6),
                              Text(
                                'YouTube Music',
                                style: TextStyle(
                                  color: _searchYouTube ? Colors.white : Colors.grey,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 12.5,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    Expanded(
                      child: GestureDetector(
                        onTap: () {
                          setState(() {
                            _searchYouTube = false;
                          });
                        },
                        child: Container(
                          height: 36,
                          decoration: BoxDecoration(
                            color: !_searchYouTube ? localColor : Colors.transparent,
                            borderRadius: BorderRadius.circular(9),
                          ),
                          alignment: Alignment.center,
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(
                                Icons.folder_rounded,
                                size: 16,
                                color: !_searchYouTube ? const Color(0xFF10141D) : Colors.grey,
                              ),
                              const SizedBox(width: 6),
                              Text(
                                'Local Storage',
                                style: TextStyle(
                                  color: !_searchYouTube ? const Color(0xFF10141D) : Colors.grey,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 12.5,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // Search Input Field
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 8),
              child: TextField(
                controller: _controller,
                onChanged: _onSearchChanged,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  hintText: _searchYouTube
                      ? 'Search YouTube Music online...'
                      : 'Search Local Storage songs, artists...',
                  hintStyle: TextStyle(color: Colors.grey.shade500, fontSize: 14),
                  prefixIcon: const Icon(Icons.search, color: Colors.grey),
                  suffixIcon: _controller.text.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear, color: Colors.grey),
                          onPressed: () {
                            _controller.clear();
                            _onSearchChanged('');
                          },
                        )
                      : null,
                  filled: true,
                  fillColor: const Color(0xFF161B26),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide.none,
                  ),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                ),
              ),
            ),

            // Content Area
            if (_searchQuery.isEmpty)
              Expanded(
                child: Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        _searchYouTube ? Icons.youtube_searched_for_rounded : Icons.search_rounded,
                        size: 52,
                        color: Colors.grey.shade700,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        _searchYouTube
                            ? 'Type to search millions of YouTube songs'
                            : 'Type to search your offline device files',
                        style: TextStyle(color: Colors.grey.shade500, fontSize: 14),
                      ),
                    ],
                  ),
                ),
              )
            else if (_searchYouTube && player.isLoadingYouTube)
              const Expanded(
                child: Center(
                  child: CircularProgressIndicator(color: Color(0xFFFF334B)),
                ),
              )
            else if (results.isEmpty)
              Expanded(
                child: Center(
                  child: Text(
                    'No songs found for "$_searchQuery"',
                    style: TextStyle(color: Colors.grey.shade500, fontSize: 14),
                  ),
                ),
              )
            else
              Expanded(
                child: ListView.builder(
                  padding: const EdgeInsets.only(bottom: 150, top: 4),
                  itemCount: results.length,
                  itemBuilder: (context, index) {
                    final track = results[index];
                    final isCurrent = player.currentTrack?.id == track.id;
                    return TrackTile(
                      track: track,
                      isCurrent: isCurrent,
                      onTap: () => player.playTrack(track, newQueue: results),
                    );
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}

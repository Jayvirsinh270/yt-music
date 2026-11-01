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
  String _activeChip = 'Lofi Chill';

  final List<Map<String, String>> _vibeChips = [
    {'label': 'Lofi Chill', 'query': 'Lofi hip hop beats chill study relax'},
    {'label': 'Deep Piano', 'query': 'Peaceful calm piano solo relaxing'},
    {'label': 'Acoustic', 'query': 'Acoustic peaceful guitar gentle songs'},
    {'label': 'Sleep Ambient', 'query': 'Deep sleep ambient peaceful soundscape'},
    {'label': 'Bollywood Calm', 'query': 'Bollywood acoustic unplugged calm romantic songs'},
    {'label': 'Pop Chill', 'query': 'Chill acoustic pop songs mellow'},
    {'label': 'Jazz Cafe', 'query': 'Coffee shop jazz cafe calm instrumental'},
    {'label': 'Trending', 'query': 'Trending Global Music Hits 2026'},
  ];

  final List<Map<String, dynamic>> _quickVibes = [
    {
      'title': 'Acoustic Sanctuary',
      'subtitle': 'Gentle guitar & quiet melody',
      'icon': Icons.music_note_rounded,
      'gradient': [Color(0xFF312E81), Color(0xFF1E1B4B)],
      'accent': Color(0xFF818CF8),
      'query': 'Acoustic calm peaceful guitar songs',
    },
    {
      'title': 'Rainy Cafe Lofi',
      'subtitle': 'Warm beats & soft rain',
      'icon': Icons.water_drop_rounded,
      'gradient': [Color(0xFF064E3B), Color(0xFF022C22)],
      'accent': Color(0xFF34D399),
      'query': 'Lofi hip hop beats soft rain cafe chill',
    },
    {
      'title': 'Midnight Ambient',
      'subtitle': 'Deep sleep & cosmic tranquility',
      'icon': Icons.nightlight_round,
      'gradient': [Color(0xFF4C1D95), Color(0xFF2E1065)],
      'accent': Color(0xFFA78BFA),
      'query': 'Deep sleep ambient peaceful relaxation soundscape',
    },
    {
      'title': 'Deep Focus Piano',
      'subtitle': 'Minimalist keys & solace',
      'icon': Icons.piano_rounded,
      'gradient': [Color(0xFF1E293B), Color(0xFF0F172A)],
      'accent': Color(0xFF38BDF8),
      'query': 'Peaceful solo piano relax focus study',
    },
    {
      'title': 'Sunset Chill R&B',
      'subtitle': 'Mellow groove & slow soul',
      'icon': Icons.wb_twilight_rounded,
      'gradient': [Color(0xFF831843), Color(0xFF500724)],
      'accent': Color(0xFFF472B6),
      'query': 'Slow mellow chill r&b soul relax',
    },
    {
      'title': 'Ocean Soundscapes',
      'subtitle': 'Gentle waves & nature peace',
      'icon': Icons.waves_rounded,
      'gradient': [Color(0xFF0F766E), Color(0xFF134E4A)],
      'accent': Color(0xFF2DD4BF),
      'query': 'Ocean waves nature sounds calm relaxation',
    },
  ];

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  String _getGreeting() {
    final hour = DateTime.now().hour;
    if (hour >= 5 && hour < 12) return 'Quiet Morning ☕';
    if (hour >= 12 && hour < 17) return 'Peaceful Afternoon 🌿';
    if (hour >= 17 && hour < 21) return 'Golden Sunset 🌅';
    return 'Late Night Sanctuary 🌙';
  }

  String _getGreetingSubtitle() {
    final hour = DateTime.now().hour;
    if (hour >= 5 && hour < 12) return 'Gentle acoustic notes & mindful morning peace';
    if (hour >= 12 && hour < 17) return 'Calm focus soundscapes & soothing rhythms';
    if (hour >= 17 && hour < 21) return 'Twilight soul & warm relaxing melodies';
    return 'Lofi dreamscapes, sleep ambient & starry tranquility';
  }

  void _onSearchSubmitted(String query) {
    if (query.trim().isNotEmpty) {
      context.read<PlayerProvider>().searchYouTube(query.trim());
      setState(() {
        _activeChip = '';
      });
    }
  }

  void _playVibe(Map<String, dynamic> vibe) {
    final query = vibe['query'] as String;
    setState(() {
      _activeChip = vibe['title'] as String;
      _searchController.clear();
    });
    final player = context.read<PlayerProvider>();
    player.searchYouTube(query).then((_) {
      if (player.youtubeTracks.isNotEmpty) {
        player.playTrack(player.youtubeTracks.first, newQueue: player.youtubeTracks);
      }
    });
  }

  void _showServerDialog(BuildContext context) {
    final player = context.read<PlayerProvider>();
    final controller = TextEditingController(text: player.ytService.serverHost);
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF161B26),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text('Linus Server Connection',
            style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '✨ Direct Cloud Streaming is active! You can play YouTube music anywhere with zero PC required.\n\nOptional: Enter your PC IP to sync local downloads wirelessly over Wi-Fi:',
              style: TextStyle(color: Colors.grey, fontSize: 13, height: 1.4),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: controller,
              style: const TextStyle(color: Colors.white, fontSize: 14),
              decoration: InputDecoration(
                hintText: 'e.g. http://192.168.1.15:5000',
                hintStyle: TextStyle(color: Colors.grey.shade600),
                filled: true,
                fillColor: const Color(0xFF10141D),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            child: const Text('Cancel', style: TextStyle(color: Colors.grey)),
            onPressed: () => Navigator.pop(ctx),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFFF334B),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            child: const Text('Save Settings', style: TextStyle(color: Colors.white)),
            onPressed: () {
              player.ytService.setServerHost(controller.text);
              Navigator.pop(ctx);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Connection preferences saved!')),
              );
            },
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final player = context.watch<PlayerProvider>();
    final ytTracks = player.youtubeTracks;
    final ytColor = const Color(0xFFFF334B);

    return Scaffold(
      backgroundColor: const Color(0xFF0C0E14), // Ultra calm obsidian
      body: SafeArea(
        child: RefreshIndicator(
          color: ytColor,
          backgroundColor: const Color(0xFF161B26),
          onRefresh: () async {
            final activeQ = _activeChip.isNotEmpty
                ? (_vibeChips.firstWhere((c) => c['label'] == _activeChip, orElse: () => _vibeChips.first)['query'])
                : 'Lofi chill study beats calm';
            await player.searchYouTube(activeQ!);
          },
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
            slivers: [
              // Top Calm Header & Controls
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 16, 10),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(9),
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [Color(0xFFFF334B), Color(0xFFFF6B6B)],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          borderRadius: BorderRadius.circular(14),
                          boxShadow: [
                            BoxShadow(
                              color: ytColor.withOpacity(0.35),
                              blurRadius: 12,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: const Icon(
                          Icons.play_arrow_rounded,
                          color: Colors.white,
                          size: 24,
                        ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _getGreeting(),
                              style: const TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.bold,
                                color: Colors.white,
                                letterSpacing: -0.4,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              _getGreetingSubtitle(),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 12,
                                color: Colors.grey.shade400,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.06),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: Colors.white.withOpacity(0.1)),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              width: 6,
                              height: 6,
                              decoration: const BoxDecoration(
                                color: Color(0xFF10B981), // Emerald online pulse
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 6),
                            const Text(
                              'DIRECT',
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                                color: Colors.white70,
                                letterSpacing: 0.6,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 4),
                      IconButton(
                        tooltip: 'Settings',
                        icon: const Icon(Icons.tune_rounded, color: Colors.white70, size: 21),
                        onPressed: () => _showServerDialog(context),
                      ),
                    ],
                  ),
                ),
              ),

              // Apple Music Glassmorphic Search Bar
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
                  child: Container(
                    decoration: BoxDecoration(
                      color: const Color(0xFF161B26).withOpacity(0.9),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: Colors.white.withOpacity(0.08)),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withOpacity(0.3),
                          blurRadius: 10,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: TextField(
                      controller: _searchController,
                      onSubmitted: _onSearchSubmitted,
                      style: const TextStyle(color: Colors.white, fontSize: 15),
                      decoration: InputDecoration(
                        hintText: 'Search songs, calm vibes, artists...',
                        hintStyle: TextStyle(color: Colors.grey.shade500, fontSize: 14),
                        prefixIcon: const Icon(Icons.search_rounded, color: Colors.grey),
                        suffixIcon: _searchController.text.isNotEmpty
                            ? IconButton(
                                icon: const Icon(Icons.clear_rounded, color: Colors.grey, size: 20),
                                onPressed: () {
                                  _searchController.clear();
                                  setState(() {});
                                },
                              )
                            : null,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                        border: InputBorder.none,
                      ),
                    ),
                  ),
                ),
              ),

              // Apple Music Style: Featured Editorial Hero Card
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(18, 8, 18, 16),
                  child: Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(22),
                      gradient: const LinearGradient(
                        colors: [Color(0xFF2E1065), Color(0xFF1E1B4B), Color(0xFF0F172A)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFF6366F1).withOpacity(0.25),
                          blurRadius: 24,
                          offset: const Offset(0, 10),
                        ),
                      ],
                      border: Border.all(color: Colors.white.withOpacity(0.12)),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  const Icon(Icons.auto_awesome, color: Color(0xFFA78BFA), size: 14),
                                  const SizedBox(width: 6),
                                  Text(
                                    'CURATED CALM MIX',
                                    style: TextStyle(
                                      fontSize: 10,
                                      fontWeight: FontWeight.bold,
                                      letterSpacing: 1.2,
                                      color: const Color(0xFFA78BFA).withOpacity(0.9),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              const Text(
                                'Mindful Soundscapes',
                                style: TextStyle(
                                  fontSize: 21,
                                  fontWeight: FontWeight.bold,
                                  color: Colors.white,
                                  letterSpacing: -0.4,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'Infinite gentle flow, acoustic calm & zero distractions',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: Colors.grey.shade300,
                                  height: 1.3,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 14),
                        GestureDetector(
                          onTap: () {
                            player.searchYouTube('Mindful soundscapes lofi chill acoustic').then((_) {
                              if (player.youtubeTracks.isNotEmpty) {
                                player.playTrack(player.youtubeTracks.first, newQueue: player.youtubeTracks);
                              }
                            });
                          },
                          child: Container(
                            width: 52,
                            height: 52,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              gradient: const LinearGradient(
                                colors: [Color(0xFFFF334B), Color(0xFFFF6B6B)],
                              ),
                              boxShadow: [
                                BoxShadow(
                                  color: ytColor.withOpacity(0.5),
                                  blurRadius: 16,
                                  offset: const Offset(0, 6),
                                ),
                              ],
                            ),
                            child: const Icon(
                              Icons.play_arrow_rounded,
                              color: Colors.white,
                              size: 32,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),

              // Spotify Style: 2x3 Quick Mood Grid
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 18),
                  child: Row(
                    children: [
                      const Text(
                        'Calm Vibes',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                          letterSpacing: -0.3,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'Tap to listen instantly',
                        style: TextStyle(
                          fontSize: 12,
                          color: Colors.grey.shade400,
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              SliverPadding(
                padding: const EdgeInsets.fromLTRB(18, 10, 18, 16),
                sliver: SliverGrid(
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    mainAxisSpacing: 10,
                    crossAxisSpacing: 10,
                    childAspectRatio: 2.3,
                  ),
                  delegate: SliverChildBuilderDelegate(
                    (context, index) {
                      final vibe = _quickVibes[index];
                      final isSelected = _activeChip == vibe['title'];
                      final accent = vibe['accent'] as Color;

                      return GestureDetector(
                        onTap: () => _playVibe(vibe),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(14),
                            gradient: LinearGradient(
                              colors: vibe['gradient'] as List<Color>,
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                            ),
                            border: Border.all(
                              color: isSelected ? accent : Colors.white.withOpacity(0.08),
                              width: isSelected ? 1.5 : 1,
                            ),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withOpacity(0.25),
                                blurRadius: 8,
                                offset: const Offset(0, 3),
                              ),
                            ],
                          ),
                          child: Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.all(7),
                                decoration: BoxDecoration(
                                  color: Colors.white.withOpacity(0.12),
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Icon(
                                  vibe['icon'] as IconData,
                                  color: accent,
                                  size: 19,
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Text(
                                      vibe['title'] as String,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.bold,
                                        fontSize: 12.5,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      vibe['subtitle'] as String,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        color: Colors.white.withOpacity(0.6),
                                        fontSize: 10,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                    childCount: _quickVibes.length,
                  ),
                ),
              ),

              // Horizontal Vibe Filter Chips
              SliverToBoxAdapter(
                child: SizedBox(
                  height: 44,
                  child: ListView.builder(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 18),
                    itemCount: _vibeChips.length,
                    itemBuilder: (context, index) {
                      final chip = _vibeChips[index];
                      final isSelected = _activeChip == chip['label'];
                      return Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: FilterChip(
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
                            color: isSelected ? ytColor.withOpacity(0.6) : Colors.white10,
                          ),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                          onSelected: (selected) {
                            if (selected) {
                              setState(() {
                                _activeChip = chip['label']!;
                                _searchController.clear();
                              });
                              player.searchYouTube(chip['query']!);
                            }
                          },
                        ),
                      );
                    },
                  ),
                ),
              ),

              // Section Header: Available Music
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 18, 20, 8),
                  child: Row(
                    children: [
                      const Text(
                        'Up Next & Recommendations',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                          letterSpacing: -0.3,
                        ),
                      ),
                      const Spacer(),
                      if (ytTracks.isNotEmpty)
                        Text(
                          '${ytTracks.length} tracks',
                          style: TextStyle(color: Colors.grey.shade500, fontSize: 12),
                        ),
                    ],
                  ),
                ),
              ),

              // Track Feed List
              if (player.isLoadingYouTube)
                const SliverFillRemaining(
                  hasScrollBody: false,
                  child: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        CircularProgressIndicator(color: Color(0xFFFF334B), strokeWidth: 2.8),
                        SizedBox(height: 14),
                        Text(
                          'Tuning into calm soundwaves...',
                          style: TextStyle(color: Colors.grey, fontSize: 13),
                        ),
                      ],
                    ),
                  ),
                )
              else if (ytTracks.isEmpty)
                SliverFillRemaining(
                  hasScrollBody: false,
                  child: Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.music_off_rounded, size: 50, color: Colors.grey.shade600),
                        const SizedBox(height: 12),
                        const Text(
                          'No peaceful tracks found',
                          style: TextStyle(color: Colors.white70, fontSize: 15),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Try searching for another artist or calm vibe',
                          style: TextStyle(color: Colors.grey.shade500, fontSize: 12),
                        ),
                        const SizedBox(height: 12),
                        ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: ytColor,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          ),
                          icon: const Icon(Icons.refresh_rounded, color: Colors.white, size: 18),
                          label: const Text('Refresh Chill Mix', style: TextStyle(color: Colors.white)),
                          onPressed: () {
                            player.searchYouTube('Lofi chill study beats calm');
                          },
                        ),
                      ],
                    ),
                  ),
                )
              else
                SliverPadding(
                  padding: const EdgeInsets.only(bottom: 96),
                  sliver: SliverList(
                    delegate: SliverChildBuilderDelegate(
                      (context, index) {
                        final track = ytTracks[index];
                        final isCurrent = player.currentTrack?.id == track.id;
                        return TrackTile(
                          track: track,
                          isCurrent: isCurrent,
                          onTap: () => player.playTrack(track, newQueue: ytTracks),
                        );
                      },
                      childCount: ytTracks.length,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

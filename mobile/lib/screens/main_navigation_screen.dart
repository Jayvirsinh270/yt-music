import 'package:flutter/material.dart';
import '../services/local_audio_service.dart';
import '../services/recommendation_engine.dart';
import '../widgets/mini_player.dart';
import 'favorites_history_screen.dart';
import 'home_screen.dart';
import 'search_screen.dart';
import 'youtube_screen.dart';

class MainNavigationScreen extends StatefulWidget {
  final LocalAudioService localAudioService;
  final RecommendationEngine recEngine;

  const MainNavigationScreen({
    super.key,
    required this.localAudioService,
    required this.recEngine,
  });

  @override
  State<MainNavigationScreen> createState() => _MainNavigationScreenState();
}

class _MainNavigationScreenState extends State<MainNavigationScreen> {
  int _currentIndex = 0;

  @override
  Widget build(BuildContext context) {
    final screens = [
      const YouTubeScreen(),
      HomeScreen(
        localAudioService: widget.localAudioService,
        recEngine: widget.recEngine,
      ),
      SearchScreen(localAudioService: widget.localAudioService),
      FavoritesHistoryScreen(recEngine: widget.recEngine),
    ];

    return Scaffold(
      backgroundColor: const Color(0xFF10141D),
      body: Stack(
        children: [
          IndexedStack(
            index: _currentIndex,
            children: screens,
          ),
          const Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: MiniPlayer(),
          ),
        ],
      ),
      bottomNavigationBar: NavigationBarTheme(
        data: NavigationBarThemeData(
          indicatorColor: Theme.of(context).colorScheme.primary.withOpacity(0.2),
          labelTextStyle: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.selected)) {
              return TextStyle(
                color: Theme.of(context).colorScheme.primary,
                fontWeight: FontWeight.bold,
                fontSize: 11,
              );
            }
            return const TextStyle(color: Colors.grey, fontSize: 11);
          }),
        ),
        child: NavigationBar(
          selectedIndex: _currentIndex,
          backgroundColor: const Color(0xFF161B26),
          elevation: 8,
          height: 64,
          onDestinationSelected: (index) {
            setState(() {
              _currentIndex = index;
            });
          },
          destinations: const [
            NavigationDestination(
              icon: Icon(Icons.play_circle_outline_rounded, color: Colors.grey),
              selectedIcon: Icon(Icons.play_circle_fill_rounded, color: Color(0xFFFF334B)),
              label: 'YouTube',
            ),
            NavigationDestination(
              icon: Icon(Icons.folder_outlined, color: Colors.grey),
              selectedIcon: Icon(Icons.folder_rounded, color: Color(0xFF2DD4BF)),
              label: 'Local',
            ),
            NavigationDestination(
              icon: Icon(Icons.search_outlined, color: Colors.grey),
              selectedIcon: Icon(Icons.search_rounded),
              label: 'Search',
            ),
            NavigationDestination(
              icon: Icon(Icons.favorite_outline_rounded, color: Colors.grey),
              selectedIcon: Icon(Icons.favorite_rounded),
              label: 'Library',
            ),
          ],
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

  final List<_NavItem> _navItems = const [
    _NavItem(icon: Icons.play_circle_outline_rounded, activeIcon: Icons.play_circle_fill_rounded, label: 'YouTube', activeColor: Color(0xFFFF1744)),
    _NavItem(icon: Icons.folder_outlined, activeIcon: Icons.folder_rounded, label: 'Local', activeColor: Color(0xFF00E5FF)),
    _NavItem(icon: Icons.search_outlined, activeIcon: Icons.search_rounded, label: 'Search', activeColor: Color(0xFF7C4DFF)),
    _NavItem(icon: Icons.library_music_outlined, activeIcon: Icons.library_music_rounded, label: 'Library', activeColor: Color(0xFFFF6B6B)),
  ];

  @override
  Widget build(BuildContext context) {
    final screens = [
      const YouTubeScreen(),
      HomeScreen(localAudioService: widget.localAudioService, recEngine: widget.recEngine),
      SearchScreen(localAudioService: widget.localAudioService),
      FavoritesHistoryScreen(recEngine: widget.recEngine),
    ];

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
        systemNavigationBarColor: Color(0xFF080A0F),
        systemNavigationBarIconBrightness: Brightness.light,
      ),
      child: Scaffold(
        backgroundColor: const Color(0xFF080A0F),
        body: Stack(
          children: [
            // Main screens
            IndexedStack(index: _currentIndex, children: screens),

            // Mini player floating above nav
            const Positioned(
              left: 0,
              right: 0,
              bottom: 72,
              child: MiniPlayer(),
            ),

            // Floating pill nav bar
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: _buildFloatingNavBar(context),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFloatingNavBar(BuildContext context) {
    return Container(
      height: 72,
      decoration: BoxDecoration(
        color: const Color(0xFF0D0F15),
        border: Border(
          top: BorderSide(color: Colors.white.withOpacity(0.07), width: 0.5),
        ),
      ),
      child: Row(
        children: List.generate(_navItems.length, (i) => _buildNavTab(i)),
      ),
    );
  }

  Widget _buildNavTab(int index) {
    final item = _navItems[index];
    final isSelected = _currentIndex == index;
    return Expanded(
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () {
          if (_currentIndex != index) {
            HapticFeedback.lightImpact();
            setState(() => _currentIndex = index);
          }
        },
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                decoration: BoxDecoration(
                  color: isSelected ? item.activeColor.withOpacity(0.15) : Colors.transparent,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Icon(
                  isSelected ? item.activeIcon : item.icon,
                  color: isSelected ? item.activeColor : Colors.grey.shade600,
                  size: 24,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                item.label,
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                  color: isSelected ? item.activeColor : Colors.grey.shade600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavItem {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final Color activeColor;
  const _NavItem({required this.icon, required this.activeIcon, required this.label, required this.activeColor});
}

# Contributing to Linus Music Player

Thank you for your interest in contributing! This document explains how to get the project running locally and how to submit changes.

## Getting Started

### Prerequisites

- Python 3.10 or newer
- [ffmpeg](https://ffmpeg.org/download.html) installed and on your `PATH`
- (Optional) Flutter SDK for Android app work

### Local Setup

```bash
# 1. Fork and clone the repository
git clone https://github.com/Jayvirsinh270/yt-music.git
cd yt-music

# 2. Create a virtual environment
python -m venv .venv
source .venv/bin/activate  # Windows: .\.venv\Scripts\Activate.ps1

# 3. Install dependencies
pip install -r requirements.txt

# 4. (Optional) Copy the example env file
cp .env.example .env

# 5. Run the app
python main.py
```

The app opens at `http://127.0.0.1:5000`.

## Project Structure

| File / Folder | Purpose |
|---|---|
| `main.py` | Entry point — starts Flask server |
| `web_app.py` | All Flask routes and API endpoints |
| `db_store.py` | SQLite database layer |
| `downloader.py` | yt-dlp download manager + YouTube search/stream |
| `library_service.py` | Music library scanning and indexing |
| `lyrics_provider.py` | Lyrics fetch, search, and storage |
| `lyrics_aligner.py` | Forced lyrics-to-audio alignment |
| `recommendation_engine.py` | CMI recommendation engine |
| `smart_playlists.py` | Rule-based dynamic playlists |
| `quotes_store.py` | Quotes / mood widgets |
| `discord_rpc.py` | Discord Rich Presence integration |
| `templates/` | Jinja2 HTML templates |
| `static/` | CSS, JavaScript, and media assets |
| `mobile/` | Flutter Android companion app |

## Making Changes

1. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feature/my-feature-name
   ```

2. **Make your changes** and test them locally.

3. **Run the tests** before submitting:
   ```bash
   python -m pytest tests/ -v
   ```

4. **Commit** with a clear message:
   ```bash
   git commit -m "feat: add podcast RSS feed support"
   ```
   We use [Conventional Commits](https://www.conventionalcommits.org/) style.

5. **Open a pull request** with:
   - A clear description of what changed and why
   - Screenshots or a short video if the change affects the UI

## Coding Guidelines

- Keep backend logic in dedicated modules (e.g., new source = new `*_provider.py`)
- All API routes go in `web_app.py` with clear docstrings
- Use `db_store.py` for all persistent data — no raw file I/O for state
- Frontend JS is vanilla — no framework dependencies please
- Test new features with a real music library and YouTube tracks

## Reporting Bugs

Open a GitHub Issue with:
- OS and Python version
- Steps to reproduce
- Expected vs actual behavior
- Any relevant error logs from the terminal

## Feature Requests

Open a GitHub Issue tagged `enhancement` with a clear description of the use case and proposed behavior.

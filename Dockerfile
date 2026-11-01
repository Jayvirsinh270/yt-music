# ─────────────────────────────────────────────────────────────────
# Linus Music Player — Dockerfile
# Multi-stage build: keeps final image lean
# ─────────────────────────────────────────────────────────────────

# Stage 1: dependency installer
FROM python:3.12-slim AS builder

WORKDIR /app

# Install system build deps for yt-dlp and mutagen
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 2: runtime image
FROM python:3.12-slim AS runtime

WORKDIR /app

# Install runtime-only system packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy installed Python packages from builder
COPY --from=builder /install /usr/local

# Copy application source
COPY . .

# Create directories that the app expects at runtime
RUN mkdir -p downloads stream_cache lyrics_cache static/wallpapers static/videos static/live_wallpapers

# Expose the default port
EXPOSE 5000

# Health check so Docker / compose knows the app is live
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/api/health')"

# Default environment
ENV LINUS_HOST=0.0.0.0
ENV LINUS_PORT=5000

# Run the app
CMD ["python", "main.py"]

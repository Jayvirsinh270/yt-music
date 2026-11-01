import os
import sys
import webbrowser
from threading import Timer

# Load .env file if present (optional — all settings have sensible defaults)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # python-dotenv is optional; defaults still apply

from web_app import app


if __name__ == "__main__":
    # Default to 127.0.0.1 for local security; allow --lan flag or LINUS_HOST for network access
    host = os.environ.get("LINUS_HOST", "0.0.0.0" if "--lan" in sys.argv else "127.0.0.1")
    port = int(os.environ.get("LINUS_PORT", 5000))
    Timer(1.0, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()
    app.run(host=host, port=port, debug=False)
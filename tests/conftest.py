import os
import sys
import threading
from pathlib import Path
import pytest

# Ensure repository root is on sys.path for test discovery on all OS/CI runners
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

# ---------------------------------------------------------------------------
# Import the REAL db_store eagerly at conftest load time.

# This must happen before test_downloader.py or test_smart_playlists.py can
# insert their stubs, because conftest is loaded first by pytest.
# We stash the real module so the autouse fixture can patch it reliably.
# ---------------------------------------------------------------------------
import db_store as _real_db_store


@pytest.fixture(autouse=True, scope="session")
def temp_db(tmp_path_factory):
    """Redirect all db_store operations to a temporary database."""
    tmp = tmp_path_factory.mktemp("db")
    db_path = tmp / "test_linus.db"

    original_path = _real_db_store.DB_PATH

    # Point the real module at the temp DB and reset the thread-local connection
    _real_db_store.DB_PATH = db_path
    _real_db_store._local = threading.local()

    # Ensure the real module is discoverable by name for test_db_store imports
    sys.modules["db_store"] = _real_db_store

    # Initialise schema in the temp DB
    _real_db_store.init_db()

    yield db_path

    # Teardown: restore original path
    _real_db_store.DB_PATH = original_path
    _real_db_store._local = threading.local()


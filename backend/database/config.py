import os
from pathlib import Path

# Anchored strictly to the backend directory, independent of CWD
BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"
DEFAULT_DB_PATH = DATA_DIR / "itms.db"

# Ensure data directory exists
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Async database URL (default to SQLite + aiosqlite)
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite+aiosqlite:///{DEFAULT_DB_PATH.as_posix()}")

def get_sync_database_url(url: str | None = None) -> str:
    """Return synchronous database URL (e.g. for Alembic or sync scripts)."""
    target = url or DATABASE_URL
    if target.startswith("sqlite+aiosqlite://"):
        return target.replace("sqlite+aiosqlite://", "sqlite://")
    return target

def get_db_file_path(url: str | None = None) -> Path:
    """Extract Path object from a sqlite URL."""
    target = url or DATABASE_URL
    for prefix in ("sqlite+aiosqlite://", "sqlite://"):
        if target.startswith(prefix):
            target = target[len(prefix):]
            break
    return Path(target)

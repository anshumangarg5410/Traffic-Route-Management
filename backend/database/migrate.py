import logging
import sqlite3
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config

from backend.database.config import (
    BACKEND_DIR,
    DATABASE_URL,
    DEFAULT_DB_PATH,
    get_db_file_path,
)

logger = logging.getLogger("itms.database.migrate")


def verify_and_enable_wal(db_path: Path) -> str:
    """
    Establish and verify WAL mode on the SQLite database header.
    Aborts with fatal exit if WAL mode cannot be established (e.g. non-POSIX FS).
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    try:
        cursor = conn.cursor()
        cursor.execute("PRAGMA journal_mode = WAL;")
        result = cursor.fetchone()
        journal_mode = result[0].lower() if result else ""
        if journal_mode != "wal":
            logger.critical(
                "CRITICAL: Failed to establish SQLite WAL journal mode on %s. Got: '%s'. Aborting startup.",
                db_path,
                journal_mode,
            )
            cursor.close()
            conn.close()
            sys.exit(1)

        # Connection sanity checks
        cursor.execute("PRAGMA foreign_keys = ON;")
        cursor.execute("PRAGMA busy_timeout = 5000;")
        cursor.close()
        logger.info("Successfully established and verified PRAGMA journal_mode=WAL on %s", db_path)
        return journal_mode
    finally:
        conn.close()


def run_migrations(target_db_path: Path | None = None, alembic_ini_path: Path | None = None) -> None:
    """
    Execute database migrations:
    1. Pre-startup WAL verification and establishment on physical file.
    2. Alembic upgrade to head.
    """
    project_root = BACKEND_DIR.parent
    ini_file = alembic_ini_path or (project_root / "alembic.ini")

    if not ini_file.exists():
        raise FileNotFoundError(f"Alembic configuration not found at {ini_file}")

    db_file = target_db_path or get_db_file_path(DATABASE_URL)

    # 1. Establish and verify WAL
    verify_and_enable_wal(db_file)

    # 2. Run Alembic upgrade
    alembic_cfg = Config(str(ini_file))
    # If custom target db file provided, override sqlalchemy.url in config
    if target_db_path:
        alembic_cfg.set_main_option(
            "sqlalchemy.url", f"sqlite+aiosqlite:///{target_db_path.resolve().as_posix()}"
        )

    logger.info("Running Alembic migrations on %s using %s...", db_file, ini_file)
    command.upgrade(alembic_cfg, "head")
    logger.info("Database migrations completed successfully.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    run_migrations()

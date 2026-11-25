from collections.abc import AsyncGenerator
from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from backend.database.config import DATABASE_URL


def setup_engine_pragmas(engine: AsyncEngine) -> None:
    """Register connection-level PRAGMAs on a given AsyncEngine's sync_engine."""
    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragmas(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys = ON;")
        cursor.execute("PRAGMA busy_timeout = 5000;")
        cursor.close()


def setup_immediate_begin_listener(engine: AsyncEngine) -> None:
    """Register BEGIN IMMEDIATE listener on sync_engine."""
    @event.listens_for(engine.sync_engine, "begin")
    def set_sqlite_immediate_begin(conn):
        conn.exec_driver_sql("BEGIN IMMEDIATE")


# 1. Standard Async Engine: ordinary deferred transactions (reads, bookmarks, logs, observations)
engine = create_async_engine(DATABASE_URL, echo=False)
setup_engine_pragmas(engine)

async_session_factory = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

# 2. Dedicated Critical-Write Async Engine: targets same DB, issues BEGIN IMMEDIATE on begin
critical_engine = create_async_engine(DATABASE_URL, echo=False)
setup_engine_pragmas(critical_engine)
setup_immediate_begin_listener(critical_engine)

critical_session_factory = async_sessionmaker(
    bind=critical_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


def create_engine_and_factories(db_url: str):
    """Factory helper used for testing isolated databases."""
    test_engine = create_async_engine(db_url, echo=False)
    setup_engine_pragmas(test_engine)
    test_async_session_factory = async_sessionmaker(
        bind=test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )

    test_critical_engine = create_async_engine(db_url, echo=False)
    setup_engine_pragmas(test_critical_engine)
    setup_immediate_begin_listener(test_critical_engine)
    test_critical_session_factory = async_sessionmaker(
        bind=test_critical_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )

    return (
        test_engine,
        test_async_session_factory,
        test_critical_engine,
        test_critical_session_factory,
    )


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for standard operations (deferred transactions)."""
    async with async_session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def get_critical_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for critical write operations (BEGIN IMMEDIATE write-lock reservation)."""
    async with critical_session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

import asyncio
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
import uuid

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from backend.database.base import Base
from backend.database.config import (
    BACKEND_DIR,
    DATABASE_URL,
    DEFAULT_DB_PATH,
    get_db_file_path,
    get_sync_database_url,
)
from backend.database.migrate import run_migrations, verify_and_enable_wal
from backend.database.models import (
    ActiveModelDeployment,
    AuditLog,
    DataQualityEvent,
    IngestionRejection,
    MLJobLog,
    MLTrainingJob,
    ModelRegistry,
    RefreshToken,
    RouteSearchHistory,
    SavedRoute,
    SSETicket,
    SystemCoordination,
    TrafficIngestionBatch,
    TrafficObservation,
    User,
    WorkerDeploymentStatus,
)
from backend.database.session import (
    async_session_factory,
    create_engine_and_factories,
    critical_engine,
    critical_session_factory,
    engine,
    get_critical_db,
    get_db,
    setup_engine_pragmas,
    setup_immediate_begin_listener,
)


def run_async(coro):
    """Run an async coroutine synchronously in tests."""
    return asyncio.run(coro)


class TestDatabaseConfig:
    def test_default_paths_and_anchors(self):
        assert DEFAULT_DB_PATH.name == "itms.db"
        assert DEFAULT_DB_PATH.parent.name == "data"
        assert BACKEND_DIR.name == "backend"
        assert DEFAULT_DB_PATH.is_absolute()

    def test_sync_url_conversion(self):
        async_url = "sqlite+aiosqlite:///path/to/db.sqlite"
        sync_url = get_sync_database_url(async_url)
        assert sync_url == "sqlite:///path/to/db.sqlite"

    def test_db_file_path_extraction(self):
        file_path = get_db_file_path("sqlite+aiosqlite:///tmp/test.db")
        assert file_path == Path("/tmp/test.db")


class TestSchemaCompleteness:
    def test_all_16_tables_registered_in_metadata(self):
        expected_tables = {
            "system_coordination",
            "users",
            "refresh_tokens",
            "sse_tickets",
            "saved_routes",
            "route_search_history",
            "traffic_ingestion_batches",
            "traffic_observations",
            "data_quality_events",
            "ingestion_rejections",
            "ml_training_jobs",
            "ml_job_logs",
            "model_registry",
            "active_model_deployment",
            "worker_deployment_status",
            "audit_logs",
        }
        actual_tables = set(Base.metadata.tables.keys())
        assert expected_tables.issubset(actual_tables), f"Missing tables: {expected_tables - actual_tables}"
        assert len(actual_tables) == 16

    def test_tables_exist_in_migrated_database(self):
        db_path = get_db_file_path(DATABASE_URL)
        assert db_path.exists(), f"Database file does not exist at {db_path}"

        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
        tables = {row[0] for row in cursor.fetchall()}
        conn.close()

        expected_tables = {
            "system_coordination",
            "users",
            "refresh_tokens",
            "sse_tickets",
            "saved_routes",
            "route_search_history",
            "traffic_ingestion_batches",
            "traffic_observations",
            "data_quality_events",
            "ingestion_rejections",
            "ml_training_jobs",
            "ml_job_logs",
            "model_registry",
            "active_model_deployment",
            "worker_deployment_status",
            "audit_logs",
            "alembic_version",
        }
        assert expected_tables.issubset(tables)


class TestPragmasAndWALMode:
    def test_wal_journal_mode(self):
        db_path = get_db_file_path(DATABASE_URL)
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        cursor.execute("PRAGMA journal_mode;")
        result = cursor.fetchone()
        conn.close()
        assert result is not None
        assert result[0].lower() == "wal"

    def test_standard_engine_pragmas(self):
        async def check_pragmas():
            async with engine.connect() as conn:
                fk = await conn.scalar(text("PRAGMA foreign_keys;"))
                timeout = await conn.scalar(text("PRAGMA busy_timeout;"))
                return fk, timeout

        fk, timeout = run_async(check_pragmas())
        assert fk == 1, "Foreign keys pragma must be ON (1)"
        assert timeout == 5000, "Busy timeout must be 5000 ms"

    def test_critical_engine_pragmas(self):
        async def check_pragmas():
            async with critical_engine.connect() as conn:
                fk = await conn.scalar(text("PRAGMA foreign_keys;"))
                timeout = await conn.scalar(text("PRAGMA busy_timeout;"))
                return fk, timeout

        fk, timeout = run_async(check_pragmas())
        assert fk == 1, "Foreign keys pragma must be ON (1)"
        assert timeout == 5000, "Busy timeout must be 5000 ms"

    def test_foreign_key_enforcement(self):
        async def insert_invalid_fk():
            async with async_session_factory() as session:
                async with session.begin():
                    # Insert saved route for non-existent user
                    bad_route = SavedRoute(
                        id=str(uuid.uuid4()),
                        user_id="non-existent-user-id",
                        title="Work Route",
                        origin_name="Sector 17",
                        origin_lat=30.74,
                        origin_lon=76.78,
                        destination_name="Sector 35",
                        destination_lat=30.72,
                        destination_lon=76.76,
                        preferred_criteria="{}",
                        created_at=datetime.now(timezone.utc),
                    )
                    session.add(bad_route)

        with pytest.raises(IntegrityError):
            run_async(insert_invalid_fk())


class TestDualEngineAndTransactions:
    def test_dual_engine_shared_visibility(self):
        user_id = f"test-user-{uuid.uuid4().hex[:8]}"

        async def write_with_standard_read_with_critical():
            # 1. Write via standard session
            async with async_session_factory() as session:
                async with session.begin():
                    user = User(
                        id=user_id,
                        email=f"{user_id}@example.com",
                        password_hash="argon2id$mockhash",
                        full_name="Dual Engine Test",
                        role="user",
                        is_active=1,
                        token_version=1,
                        created_at=datetime.now(timezone.utc),
                        updated_at=datetime.now(timezone.utc),
                    )
                    session.add(user)

            # 2. Read via critical session
            async with critical_session_factory() as session:
                async with session.begin():
                    fetched = await session.get(User, user_id)
                    assert fetched is not None
                    assert fetched.id == user_id
                    # Clean up
                    await session.delete(fetched)

        run_async(write_with_standard_read_with_critical())

    def test_critical_engine_begin_immediate_execution(self):
        async def check_critical_begin():
            async with critical_session_factory() as session:
                async with session.begin():
                    # Verify immediate transaction starts smoothly
                    count = await session.scalar(select(func.count(SystemCoordination.lock_name)))
                    assert count >= 1

        run_async(check_critical_begin())


class TestConstraintsAndIntegrity:
    def test_user_role_check_constraint(self):
        async def insert_invalid_role():
            async with async_session_factory() as session:
                async with session.begin():
                    bad_user = User(
                        id=f"invalid-role-{uuid.uuid4().hex[:6]}",
                        email=f"invalid-role-{uuid.uuid4().hex[:6]}@test.com",
                        password_hash="hash",
                        full_name="Bad Role",
                        role="superadmin",  # Invalid role
                        is_active=1,
                        token_version=1,
                        created_at=datetime.now(timezone.utc),
                        updated_at=datetime.now(timezone.utc),
                    )
                    session.add(bad_user)

        with pytest.raises(IntegrityError):
            run_async(insert_invalid_role())

    def test_user_is_active_check_constraint(self):
        async def insert_invalid_is_active():
            async with async_session_factory() as session:
                async with session.begin():
                    bad_user = User(
                        id=f"invalid-active-{uuid.uuid4().hex[:6]}",
                        email=f"invalid-active-{uuid.uuid4().hex[:6]}@test.com",
                        password_hash="hash",
                        full_name="Bad Active",
                        role="user",
                        is_active=2,  # Invalid: only 0 or 1 allowed
                        token_version=1,
                        created_at=datetime.now(timezone.utc),
                        updated_at=datetime.now(timezone.utc),
                    )
                    session.add(bad_user)

        with pytest.raises(IntegrityError):
            run_async(insert_invalid_is_active())

    def test_traffic_observation_nullable_counts_and_uniqueness(self):
        obs_id_1 = str(uuid.uuid4())
        obs_id_2 = str(uuid.uuid4())
        source = f"sensor-{uuid.uuid4().hex[:6]}"
        obs_time = datetime(2026, 11, 24, 12, 0, 0, tzinfo=timezone.utc)

        async def test_observations():
            async with async_session_factory() as session:
                async with session.begin():
                    # Valid observation with NULL count (offline sensor) and NULL speed
                    obs1 = TrafficObservation(
                        id=obs_id_1,
                        batch_id=None,
                        source_identifier=source,
                        data_source="REAL_SENSOR",
                        approach_direction="north",
                        lane_index=0,
                        sampling_interval_s=60,
                        raw_vehicle_count=None,
                        raw_speed_kmh=None,
                        quality_tag="VALID",
                        observed_at=obs_time,
                        ingested_at=datetime.now(timezone.utc),
                    )
                    session.add(obs1)

            # Test duplicate unique composite key
            async with async_session_factory() as session:
                async with session.begin():
                    obs2 = TrafficObservation(
                        id=obs_id_2,
                        batch_id=None,
                        source_identifier=source,
                        data_source="REAL_SENSOR",
                        approach_direction="north",
                        lane_index=0,
                        sampling_interval_s=60,
                        raw_vehicle_count=10,
                        raw_speed_kmh=45.0,
                        quality_tag="VALID",
                        observed_at=obs_time,  # Identical composite key
                        ingested_at=datetime.now(timezone.utc),
                    )
                    session.add(obs2)

        # First insert succeeds, second fails with IntegrityError
        with pytest.raises(IntegrityError):
            run_async(test_observations())

        # Cleanup obs1
        async def cleanup():
            async with async_session_factory() as session:
                async with session.begin():
                    obs = await session.get(TrafficObservation, obs_id_1)
                    if obs:
                        await session.delete(obs)

        run_async(cleanup())

    def test_single_active_model_partial_unique_index(self):
        user_id = f"test-trainer-{uuid.uuid4().hex[:6]}"
        job_id = f"test-job-{uuid.uuid4().hex[:6]}"
        m1_id = f"model-1-{uuid.uuid4().hex[:6]}"
        m2_id = f"model-2-{uuid.uuid4().hex[:6]}"
        m3_id = f"model-3-{uuid.uuid4().hex[:6]}"

        now = datetime.now(timezone.utc)

        async def setup_models():
            async with async_session_factory() as session:
                async with session.begin():
                    # 1. Create trainer user
                    trainer = User(
                        id=user_id,
                        email=f"{user_id}@test.com",
                        password_hash="hash",
                        full_name="Trainer",
                        role="admin",
                        is_active=1,
                        token_version=1,
                        created_at=now,
                        updated_at=now,
                    )
                    session.add(trainer)

                    # 2. Create job
                    job = MLTrainingJob(
                        id=job_id,
                        triggered_by=user_id,
                        status="COMPLETED",
                        dataset_name="traffic_volume",
                        dataset_version="v1.0",
                        hyperparameters="{}",
                        random_seed=42,
                        created_at=now,
                    )
                    session.add(job)

                    # 3. Model 1 (inactive)
                    model1 = ModelRegistry(
                        id=m1_id,
                        job_id=job_id,
                        dataset_identity="traffic_volume",
                        dataset_version="v1.0",
                        feature_names="[]",
                        feature_schema_version="1.0.0",
                        training_config="{}",
                        random_seed=42,
                        evaluation_metrics="{}",
                        model_framework_version="{}",
                        artifact_path="/tmp/m1.pkl",
                        artifact_checksum_sha256="abc1",
                        is_active=0,
                        trained_by=user_id,
                        trained_at=now,
                    )
                    # 4. Model 2 (active)
                    model2 = ModelRegistry(
                        id=m2_id,
                        job_id=job_id,
                        dataset_identity="traffic_volume",
                        dataset_version="v1.0",
                        feature_names="[]",
                        feature_schema_version="1.0.0",
                        training_config="{}",
                        random_seed=42,
                        evaluation_metrics="{}",
                        model_framework_version="{}",
                        artifact_path="/tmp/m2.pkl",
                        artifact_checksum_sha256="abc2",
                        is_active=1,
                        trained_by=user_id,
                        trained_at=now,
                    )
                    session.add_all([model1, model2])

            # Now try to insert model3 also as active (is_active = 1) -> must fail!
            async with async_session_factory() as session:
                async with session.begin():
                    model3 = ModelRegistry(
                        id=m3_id,
                        job_id=job_id,
                        dataset_identity="traffic_volume",
                        dataset_version="v1.0",
                        feature_names="[]",
                        feature_schema_version="1.0.0",
                        training_config="{}",
                        random_seed=42,
                        evaluation_metrics="{}",
                        model_framework_version="{}",
                        artifact_path="/tmp/m3.pkl",
                        artifact_checksum_sha256="abc3",
                        is_active=1,  # Second active model violates partial unique index!
                        trained_by=user_id,
                        trained_at=now,
                    )
                    session.add(model3)

        with pytest.raises(IntegrityError):
            run_async(setup_models())

        # Cleanup
        async def cleanup():
            async with async_session_factory() as session:
                async with session.begin():
                    for mid in [m1_id, m2_id, m3_id]:
                        m = await session.get(ModelRegistry, mid)
                        if m:
                            await session.delete(m)
                    j = await session.get(MLTrainingJob, job_id)
                    if j:
                        await session.delete(j)
                    u = await session.get(User, user_id)
                    if u:
                        await session.delete(u)

        run_async(cleanup())

    def test_active_model_deployment_singleton_constraint(self):
        async def insert_bad_singleton():
            async with async_session_factory() as session:
                async with session.begin():
                    bad_deployment = ActiveModelDeployment(
                        id=2,  # Check constraint requires id = 1
                        model_id="model-placeholder",
                        target_version=1,
                        deployed_at=datetime.now(timezone.utc),
                        deployed_by="user-placeholder",
                    )
                    session.add(bad_deployment)

        with pytest.raises(IntegrityError):
            run_async(insert_bad_singleton())

    def test_ml_job_logs_cascade_and_seq_uniqueness(self):
        user_id = f"test-user-{uuid.uuid4().hex[:6]}"
        job_id = f"test-job-{uuid.uuid4().hex[:6]}"
        now = datetime.now(timezone.utc)

        async def run_cascade_test():
            async with async_session_factory() as session:
                async with session.begin():
                    user = User(
                        id=user_id,
                        email=f"{user_id}@test.com",
                        password_hash="hash",
                        full_name="User",
                        role="user",
                        is_active=1,
                        token_version=1,
                        created_at=now,
                        updated_at=now,
                    )
                    session.add(user)
                    job = MLTrainingJob(
                        id=job_id,
                        triggered_by=user_id,
                        status="RUNNING",
                        dataset_name="dataset",
                        dataset_version="v1",
                        hyperparameters="{}",
                        random_seed=123,
                        created_at=now,
                    )
                    session.add(job)
                    log1 = MLJobLog(
                        job_id=job_id,
                        seq=1,
                        level="INFO",
                        message="Training started",
                        logged_at=now,
                    )
                    log2 = MLJobLog(
                        job_id=job_id,
                        seq=2,
                        level="INFO",
                        message="Epoch 1 complete",
                        logged_at=now,
                    )
                    session.add_all([log1, log2])

            # Verify logs were created
            async with async_session_factory() as session:
                logs = (
                    await session.scalars(select(MLJobLog).where(MLJobLog.job_id == job_id))
                ).all()
                assert len(logs) == 2

            # Delete the job -> cascade must delete the logs
            async with async_session_factory() as session:
                async with session.begin():
                    job = await session.get(MLTrainingJob, job_id)
                    await session.delete(job)

            # Verify logs were cascadingly deleted
            async with async_session_factory() as session:
                logs_after = (
                    await session.scalars(select(MLJobLog).where(MLJobLog.job_id == job_id))
                ).all()
                assert len(logs_after) == 0

            # Cleanup user
            async with async_session_factory() as session:
                async with session.begin():
                    u = await session.get(User, user_id)
                    if u:
                        await session.delete(u)

        run_async(run_cascade_test())

    def test_system_coordination_seed(self):
        async def verify_seed():
            async with async_session_factory() as session:
                rec = await session.get(SystemCoordination, "startup_recovery")
                assert rec is not None
                assert rec.lock_name == "startup_recovery"

        run_async(verify_seed())


class TestFastAPIDependencies:
    def test_get_db_generator(self):
        async def test_gen():
            gen = get_db()
            session = await anext(gen)
            assert session is not None
            # Verify can execute query
            res = await session.scalar(select(func.count(SystemCoordination.lock_name)))
            assert res >= 1
            await gen.aclose()

        run_async(test_gen())

    def test_get_critical_db_generator(self):
        async def test_gen():
            gen = get_critical_db()
            session = await anext(gen)
            assert session is not None
            res = await session.scalar(select(func.count(SystemCoordination.lock_name)))
            assert res >= 1
            await gen.aclose()

        run_async(test_gen())


class TestMigrationRunner:
    def test_verify_and_enable_wal_on_temp_file(self, tmp_path):
        temp_db = tmp_path / "temp_itms.db"
        mode = verify_and_enable_wal(temp_db)
        assert mode == "wal"

        conn = sqlite3.connect(str(temp_db))
        c = conn.cursor()
        c.execute("PRAGMA journal_mode;")
        assert c.fetchone()[0].lower() == "wal"
        conn.close()

    def test_run_migrations_on_temp_database(self, tmp_path):
        temp_db = tmp_path / "migrated_test.db"
        run_migrations(target_db_path=temp_db)

        conn = sqlite3.connect(str(temp_db))
        c = conn.cursor()
        c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
        tables = [r[0] for r in c.fetchall()]
        conn.close()

        assert "users" in tables
        assert "model_registry" in tables
        assert "alembic_version" in tables

    def test_migration_downgrade_and_reupgrade_cycle(self, tmp_path):
        from alembic import command
        from alembic.config import Config
        temp_db = tmp_path / "downgrade_cycle.db"
        run_migrations(target_db_path=temp_db)

        # Downgrade to base
        project_root = BACKEND_DIR.parent
        alembic_cfg = Config(str(project_root / "alembic.ini"))
        alembic_cfg.set_main_option(
            "sqlalchemy.url", f"sqlite+aiosqlite:///{temp_db.resolve().as_posix()}"
        )
        command.downgrade(alembic_cfg, "base")

        conn = sqlite3.connect(str(temp_db))
        c = conn.cursor()
        c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
        tables_after_downgrade = [r[0] for r in c.fetchall()]
        conn.close()
        # Only alembic_version table remains after downgrade to base
        assert tables_after_downgrade == ["alembic_version"]

        # Re-upgrade to head
        command.upgrade(alembic_cfg, "head")
        conn = sqlite3.connect(str(temp_db))
        c = conn.cursor()
        c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
        tables_after_reupgrade = [r[0] for r in c.fetchall()]
        conn.close()
        assert "users" in tables_after_reupgrade
        assert "active_model_deployment" in tables_after_reupgrade
        assert len(tables_after_reupgrade) == 17


class TestConcurrencyAndLocking:
    def test_concurrent_immediate_writers_waiting_and_release(self, tmp_path):
        import time
        from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
        from sqlalchemy import event, text

        temp_db = tmp_path / "concurrent_writers.db"
        run_migrations(target_db_path=temp_db)
        url = f"sqlite+aiosqlite:///{temp_db.resolve().as_posix()}"

        eng1 = create_async_engine(url)
        setup_engine_pragmas(eng1)
        setup_immediate_begin_listener(eng1)
        factory1 = async_sessionmaker(eng1, class_=AsyncSession)

        eng2 = create_async_engine(url)
        setup_engine_pragmas(eng2)
        setup_immediate_begin_listener(eng2)
        factory2 = async_sessionmaker(eng2, class_=AsyncSession)

        events = []

        async def writer1():
            async with factory1() as session:
                async with session.begin():
                    await session.execute(text("SELECT 1"))
                    events.append("w1_acquired")
                    await asyncio.sleep(0.3)
                    events.append("w1_releasing")
            events.append("w1_committed")

        async def writer2():
            await asyncio.sleep(0.05)  # Let writer 1 acquire first
            events.append("w2_attempting")
            t0 = time.time()
            async with factory2() as session:
                async with session.begin():
                    await session.execute(text("SELECT 1"))
                    elapsed = time.time() - t0
                    events.append(f"w2_acquired_at_{elapsed:.2f}s")
            events.append("w2_committed")

        async def run_scenario():
            await asyncio.gather(writer1(), writer2())
            await eng1.dispose()
            await eng2.dispose()

        run_async(run_scenario())

        # Assert sequence: w1 acquires -> w2 attempts -> w1 releases & commits -> w2 acquires & commits
        assert events[0] == "w1_acquired"
        assert events[1] == "w2_attempting"
        assert events[2] == "w1_releasing"
        assert events[3] == "w1_committed"
        assert events[4].startswith("w2_acquired_at_")
        assert events[5] == "w2_committed"

    def test_concurrent_immediate_writers_busy_timeout_expiration(self, tmp_path):
        from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
        from sqlalchemy import event, text
        from sqlalchemy.exc import OperationalError

        temp_db = tmp_path / "busy_timeout.db"
        run_migrations(target_db_path=temp_db)
        url = f"sqlite+aiosqlite:///{temp_db.resolve().as_posix()}"

        eng1 = create_async_engine(url)
        setup_engine_pragmas(eng1)
        setup_immediate_begin_listener(eng1)
        factory1 = async_sessionmaker(eng1, class_=AsyncSession)

        # eng2 configured with short 100ms busy_timeout
        eng2 = create_async_engine(url)
        @event.listens_for(eng2.sync_engine, "connect")
        def set_short_timeout(conn, rec):
            c = conn.cursor()
            c.execute("PRAGMA busy_timeout = 100;")
            c.close()
        setup_immediate_begin_listener(eng2)
        factory2 = async_sessionmaker(eng2, class_=AsyncSession)

        events = []
        timeout_raised = False

        async def writer1():
            async with factory1() as session:
                async with session.begin():
                    await session.execute(text("SELECT 1"))
                    events.append("w1_holding_lock")
                    await asyncio.sleep(0.4)
            events.append("w1_committed")

        async def writer2():
            await asyncio.sleep(0.05)
            nonlocal timeout_raised
            events.append("w2_attempting")
            try:
                async with factory2() as session:
                    async with session.begin():
                        await session.execute(text("SELECT 1"))
                        events.append("w2_unexpectedly_acquired")
            except OperationalError:
                timeout_raised = True
                events.append("w2_timeout_database_locked")

        async def run_scenario():
            await asyncio.gather(writer1(), writer2())
            await eng1.dispose()
            await eng2.dispose()

        run_async(run_scenario())

        assert timeout_raised is True
        assert "w2_timeout_database_locked" in events

    def test_deferred_reader_not_blocked_by_immediate_writer(self, tmp_path):
        import time
        from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
        from sqlalchemy import text

        temp_db = tmp_path / "reader_writer_wal.db"
        run_migrations(target_db_path=temp_db)
        url = f"sqlite+aiosqlite:///{temp_db.resolve().as_posix()}"

        writer_eng = create_async_engine(url)
        setup_engine_pragmas(writer_eng)
        setup_immediate_begin_listener(writer_eng)
        writer_factory = async_sessionmaker(writer_eng, class_=AsyncSession)

        reader_eng = create_async_engine(url)
        setup_engine_pragmas(reader_eng)
        # reader does NOT use setup_immediate_begin_listener (deferred begin)
        reader_factory = async_sessionmaker(reader_eng, class_=AsyncSession)

        events = []

        async def writer():
            async with writer_factory() as session:
                async with session.begin():
                    await session.execute(text("SELECT 1"))
                    events.append("writer_holding_lock")
                    await asyncio.sleep(0.3)
            events.append("writer_committed")

        async def reader():
            await asyncio.sleep(0.05)  # Ensure writer holds lock
            events.append("reader_reading")
            t0 = time.time()
            async with reader_factory() as session:
                async with session.begin():
                    res = await session.scalar(text("SELECT count(*) FROM system_coordination"))
                    read_time = time.time() - t0
                    events.append(f"reader_completed_in_{read_time:.3f}s_count_{res}")

        async def run_scenario():
            await asyncio.gather(writer(), reader())
            await writer_eng.dispose()
            await reader_eng.dispose()

        run_async(run_scenario())

        assert events[0] == "writer_holding_lock"
        assert events[1] == "reader_reading"
        # Reader completes before writer commits!
        assert events[2].startswith("reader_completed_in_")
        assert events[3] == "writer_committed"

    def test_standard_deferred_read_and_blocked_write_unblocking(self, tmp_path):
        import time
        from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
        from sqlalchemy import text

        temp_db = tmp_path / "deferred_write_unblock.db"
        run_migrations(target_db_path=temp_db)
        url = f"sqlite+aiosqlite:///{temp_db.resolve().as_posix()}"

        std_engine = create_async_engine(url)
        setup_engine_pragmas(std_engine)
        std_factory = async_sessionmaker(std_engine, class_=AsyncSession)

        crit_engine = create_async_engine(url)
        setup_engine_pragmas(crit_engine)
        setup_immediate_begin_listener(crit_engine)
        crit_factory = async_sessionmaker(crit_engine, class_=AsyncSession)

        timeline = []

        async def standard_worker():
            async with std_factory() as session:
                async with session.begin():
                    # 1. Deferred read
                    r1 = await session.scalar(text("SELECT count(*) FROM users"))
                    timeline.append(f"std_read_users_{r1}")
                    await asyncio.sleep(0.08)  # Let critical acquire lock
                    timeline.append("std_attempting_write")
                    t0 = time.time()
                    now = datetime.now(timezone.utc)
                    u = User(
                        id=f"std-u-{uuid.uuid4().hex[:6]}",
                        email=f"u-{uuid.uuid4().hex[:6]}@test.com",
                        password_hash="h",
                        full_name="U",
                        role="user",
                        is_active=1,
                        token_version=1,
                        created_at=now,
                        updated_at=now,
                    )
                    session.add(u)
                    await session.flush()
                    elapsed = time.time() - t0
                    timeline.append(f"std_write_flushed_after_{elapsed:.2f}s")
            timeline.append("std_committed")

        async def critical_worker():
            await asyncio.sleep(0.04)  # Let std start and read first
            async with crit_factory() as session:
                async with session.begin():
                    await session.execute(text("SELECT 1"))
                    timeline.append("crit_write_lock_acquired")
                    await asyncio.sleep(0.25)
                    timeline.append("crit_committing")
            timeline.append("crit_committed")

        async def run_scenario():
            await asyncio.gather(standard_worker(), critical_worker())
            await std_engine.dispose()
            await crit_engine.dispose()

        run_async(run_scenario())

        assert timeline[0] == "std_read_users_0"
        assert timeline[1] == "crit_write_lock_acquired"
        assert timeline[2] == "std_attempting_write"
        assert timeline[3] == "crit_committing"
        # The unblock occurs upon critical engine COMMIT; standard flush and critical post-commit can interleave
        assert "crit_committed" in timeline[4:6]
        assert any(item.startswith("std_write_flushed_after_") for item in timeline[4:6])
        assert timeline[6] == "std_committed"



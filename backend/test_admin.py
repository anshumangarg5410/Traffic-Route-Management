import asyncio
from datetime import datetime, timedelta, timezone
import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.admin.audit import ALLOWED_ACTIONS, create_audit_record
from backend.api.main import app
from backend.auth.config import COOKIE_NAME, CSRF_COOKIE_NAME, CSRF_HEADER_NAME
from backend.auth.csrf import generate_csrf_token
from backend.auth.jwt import create_access_token
from backend.auth.security import hash_password
from backend.database.migrate import run_migrations
from backend.database.models import (
    ActiveModelDeployment,
    AuditLog,
    DataQualityEvent,
    IngestionRejection,
    MLJobLog,
    MLTrainingJob,
    ModelRegistry,
    RouteSearchHistory,
    SavedRoute,
    TrafficIngestionBatch,
    TrafficObservation,
    User,
    WorkerDeploymentStatus,
)
from backend.database.session import (
    get_critical_db,
    get_db,
    setup_engine_pragmas,
    setup_immediate_begin_listener,
)


def run_async(coro):
    return asyncio.run(coro)


@pytest.fixture
def admin_test_env(tmp_path):
    """Isolated database fixture configured for standard and critical-write engines."""
    temp_db = tmp_path / "test_admin.db"
    run_migrations(target_db_path=temp_db)
    url = f"sqlite+aiosqlite:///{temp_db.resolve().as_posix()}"

    test_std_engine = create_async_engine(url)
    setup_engine_pragmas(test_std_engine)
    test_std_factory = async_sessionmaker(
        test_std_engine, class_=AsyncSession, expire_on_commit=False
    )

    test_crit_engine = create_async_engine(url)
    setup_engine_pragmas(test_crit_engine)
    setup_immediate_begin_listener(test_crit_engine)
    test_crit_factory = async_sessionmaker(
        test_crit_engine, class_=AsyncSession, expire_on_commit=False
    )

    async def override_get_db():
        async with test_std_factory() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()

    async def override_get_critical_db():
        async with test_crit_factory() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_critical_db] = override_get_critical_db

    # Provision baseline seed users
    now = datetime.now(timezone.utc)
    admin_id_1 = f"adm-1-{uuid.uuid4().hex[:6]}"
    admin_id_2 = f"adm-2-{uuid.uuid4().hex[:6]}"
    user_id_1 = f"usr-1-{uuid.uuid4().hex[:6]}"
    user_id_2 = f"usr-2-{uuid.uuid4().hex[:6]}"

    async def seed_users():
        async with test_crit_factory() as session:
            async with session.begin():
                session.add_all([
                    User(
                        id=admin_id_1,
                        email="admin1@test.com",
                        password_hash=hash_password("AdminPass123!"),
                        full_name="Primary Admin",
                        role="admin",
                        is_active=1,
                        token_version=1,
                        created_at=now,
                        updated_at=now,
                    ),
                    User(
                        id=admin_id_2,
                        email="admin2@test.com",
                        password_hash=hash_password("AdminPass123!"),
                        full_name="Secondary Admin",
                        role="admin",
                        is_active=1,
                        token_version=1,
                        created_at=now,
                        updated_at=now,
                    ),
                    User(
                        id=user_id_1,
                        email="alice@test.com",
                        password_hash=hash_password("UserPass123!"),
                        full_name="Alice User",
                        role="user",
                        is_active=1,
                        token_version=1,
                        created_at=now - timedelta(days=2),
                        updated_at=now - timedelta(days=2),
                    ),
                    User(
                        id=user_id_2,
                        email="bob_inactive@test.com",
                        password_hash=hash_password("UserPass123!"),
                        full_name="Bob Suspended",
                        role="user",
                        is_active=0,
                        token_version=1,
                        created_at=now - timedelta(days=5),
                        updated_at=now - timedelta(days=5),
                    ),
                ])

    run_async(seed_users())

    client = TestClient(app)

    yield {
        "client": client,
        "crit_factory": test_crit_factory,
        "std_factory": test_std_factory,
        "admin_id_1": admin_id_1,
        "admin_id_2": admin_id_2,
        "user_id_1": user_id_1,
        "user_id_2": user_id_2,
        "admin_token": create_access_token(admin_id_1, "admin", 1),
        "admin_token_2": create_access_token(admin_id_2, "admin", 1),
        "normal_token": create_access_token(user_id_1, "user", 1),
    }

    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_critical_db, None)
    run_async(test_std_engine.dispose())
    run_async(test_crit_engine.dispose())


# ============================================================================
# 1. Authorization Enforcement Tests
# ============================================================================

class TestAdminAuthorization:
    def test_unauthenticated_requests_return_401(self, admin_test_env):
        client = admin_test_env["client"]
        endpoints = [
            ("GET", "/api/v1/admin/overview"),
            ("GET", "/api/v1/admin/users"),
            ("GET", f"/api/v1/admin/users/{admin_test_env['user_id_1']}"),
            ("PUT", f"/api/v1/admin/users/{admin_test_env['user_id_1']}/role"),
            ("PUT", f"/api/v1/admin/users/{admin_test_env['user_id_1']}/status"),
            ("GET", "/api/v1/admin/traffic/batches"),
            ("GET", "/api/v1/admin/traffic/quality"),
            ("GET", "/api/v1/admin/models"),
            ("GET", "/api/v1/admin/models/jobs"),
            ("GET", "/api/v1/admin/system/workers"),
            ("GET", "/api/v1/admin/audit-logs"),
        ]
        for method, path in endpoints:
            if method == "GET":
                resp = client.get(path)
            else:
                resp = client.put(path, json={})
            assert resp.status_code == 401, f"{method} {path} expected 401, got {resp.status_code}"

    def test_normal_user_requests_return_403_forbidden(self, admin_test_env):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['normal_token']}"}
        endpoints = [
            ("GET", "/api/v1/admin/overview"),
            ("GET", "/api/v1/admin/users"),
            ("GET", f"/api/v1/admin/users/{admin_test_env['user_id_1']}"),
            ("PUT", f"/api/v1/admin/users/{admin_test_env['user_id_1']}/role"),
            ("PUT", f"/api/v1/admin/users/{admin_test_env['user_id_1']}/status"),
            ("GET", "/api/v1/admin/traffic/batches"),
            ("GET", "/api/v1/admin/traffic/quality"),
            ("GET", "/api/v1/admin/models"),
            ("GET", "/api/v1/admin/models/jobs"),
            ("GET", "/api/v1/admin/system/workers"),
            ("GET", "/api/v1/admin/audit-logs"),
        ]
        for method, path in endpoints:
            if method == "GET":
                resp = client.get(path, headers=headers)
            else:
                resp = client.put(path, json={"role": "admin"}, headers=headers)
            assert resp.status_code == 403, f"{method} {path} expected 403, got {resp.status_code}"
            assert "Admin privilege required" in resp.json()["detail"]

    def test_admin_user_can_access_endpoints(self, admin_test_env):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}
        resp = client.get("/api/v1/admin/overview", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_users"] == 4
        assert data["active_users"] == 3
        assert data["inactive_users"] == 1
        assert data["total_active_admins"] == 2


# ============================================================================
# 2. User Management & Privilege Mutation Tests
# ============================================================================

class TestAdminUserManagement:
    def test_list_users_pagination_and_counts(self, admin_test_env):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}

        resp = client.get("/api/v1/admin/users?limit=2&offset=0", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 4
        assert len(data["users"]) == 2
        assert data["limit"] == 2
        assert data["offset"] == 0

        # Safe serialization verification
        for u in data["users"]:
            assert "password_hash" not in u
            assert "token_version" not in u
            assert "email" in u
            assert "role" in u

    def test_list_users_search_filter(self, admin_test_env):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}

        # Search by name
        resp = client.get("/api/v1/admin/users?search=Alice", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["users"][0]["email"] == "alice@test.com"

        # Search by email
        resp = client.get("/api/v1/admin/users?search=bob_inactive", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

        # Search nonexistent
        resp = client.get("/api/v1/admin/users?search=nonexistent_xyz", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["total"] == 0

    def test_list_users_role_and_status_filters(self, admin_test_env):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}

        # Filter role=admin
        resp = client.get("/api/v1/admin/users?role=admin", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["total"] == 2

        # Filter role=user and is_active=0
        resp = client.get("/api/v1/admin/users?role=user&is_active=0", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["users"][0]["email"] == "bob_inactive@test.com"

    def test_get_user_detail_success_and_not_found(self, admin_test_env):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}

        # Existing user
        resp = client.get(f"/api/v1/admin/users/{admin_test_env['user_id_1']}", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "alice@test.com"
        assert data["saved_routes_count"] == 0
        assert data["route_searches_count"] == 0
        assert "password_hash" not in data

        # Nonexistent user
        resp = client.get("/api/v1/admin/users/nonexistent-id", headers=headers)
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()

    def test_user_role_update_promote_and_demote(self, admin_test_env):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}
        user_id = admin_test_env["user_id_1"]

        # 1. Promote Alice to admin
        resp = client.put(f"/api/v1/admin/users/{user_id}/role", json={"role": "admin"}, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["role"] == "admin"

        # Verify token_version bumped in DB
        async def check_user_token_version():
            async with admin_test_env["std_factory"]() as session:
                u = await session.get(User, user_id)
                assert u.role == "admin"
                assert u.token_version == 2

        run_async(check_user_token_version())

        # 2. Demote Alice back to user (allowed since 2 other admins exist)
        resp = client.put(f"/api/v1/admin/users/{user_id}/role", json={"role": "user"}, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["role"] == "user"

    def test_user_status_update_suspend_and_activate(self, admin_test_env):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}
        user_id = admin_test_env["user_id_1"]

        # Suspend Alice
        resp = client.put(f"/api/v1/admin/users/{user_id}/status", json={"is_active": 0}, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["is_active"] == 0

        # Reactivate Alice
        resp = client.put(f"/api/v1/admin/users/{user_id}/status", json={"is_active": 1}, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["is_active"] == 1

    def test_modify_nonexistent_user_returns_404(self, admin_test_env):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}

        resp = client.put("/api/v1/admin/users/ghost-user-id/role", json={"role": "admin"}, headers=headers)
        assert resp.status_code == 404

        resp = client.put("/api/v1/admin/users/ghost-user-id/status", json={"is_active": 0}, headers=headers)
        assert resp.status_code == 404

    def test_invalid_body_validation(self, admin_test_env):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}
        user_id = admin_test_env["user_id_1"]

        # Invalid role
        resp = client.put(f"/api/v1/admin/users/{user_id}/role", json={"role": "superadmin"}, headers=headers)
        assert resp.status_code == 400

        # Invalid status
        resp = client.put(f"/api/v1/admin/users/{user_id}/status", json={"is_active": 9}, headers=headers)
        assert resp.status_code == 400


# ============================================================================
# 3. Transactional Audit Logging & Last-Admin Protection Tests
# ============================================================================

class TestTransactionalAuditLogging:
    def test_successful_role_mutation_creates_exactly_one_audit_log(self, admin_test_env):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}
        user_id = admin_test_env["user_id_1"]

        # Verify initial audit logs count
        resp = client.get("/api/v1/admin/audit-logs", headers=headers)
        assert resp.status_code == 200
        initial_count = resp.json()["total"]

        # Promote user
        resp = client.put(f"/api/v1/admin/users/{user_id}/role", json={"role": "admin"}, headers=headers)
        assert resp.status_code == 200

        # Verify exactly one audit entry created
        resp = client.get("/api/v1/admin/audit-logs", headers=headers)
        data = resp.json()
        assert data["total"] == initial_count + 1
        latest = data["items"][0]
        assert latest["action"] == "USER_ROLE_CHANGE"
        assert latest["target_entity"] == f"user:{user_id}"
        assert latest["actor_id"] == admin_test_env["admin_id_1"]
        details = json.loads(latest["details"])
        assert details["old_role"] == "user"
        assert details["new_role"] == "admin"
        assert details["target_email"] == "alice@test.com"

    def test_successful_status_mutation_creates_exactly_one_audit_log(self, admin_test_env):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}
        user_id = admin_test_env["user_id_1"]

        resp = client.put(f"/api/v1/admin/users/{user_id}/status", json={"is_active": 0}, headers=headers)
        assert resp.status_code == 200

        resp = client.get("/api/v1/admin/audit-logs?action=USER_STATUS_CHANGE", headers=headers)
        data = resp.json()
        assert data["total"] >= 1
        latest = data["items"][0]
        assert latest["action"] == "USER_STATUS_CHANGE"
        details = json.loads(latest["details"])
        assert details["old_status"] == 1
        assert details["new_status"] == 0

    def test_last_active_admin_demotion_rejected_and_creates_no_audit(self, admin_test_env):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}
        admin_1 = admin_test_env["admin_id_1"]
        admin_2 = admin_test_env["admin_id_2"]

        # Step 1: Demote secondary admin (allowed because admin_1 remains)
        resp = client.put(f"/api/v1/admin/users/{admin_2}/role", json={"role": "user"}, headers=headers)
        assert resp.status_code == 200

        # Now admin_1 is the SOLE active administrator in the system
        # Record audit log count
        resp = client.get("/api/v1/admin/audit-logs", headers=headers)
        count_before = resp.json()["total"]

        # Step 2: Attempt to demote admin_1 (must be REJECTED)
        resp = client.put(f"/api/v1/admin/users/{admin_1}/role", json={"role": "user"}, headers=headers)
        assert resp.status_code == 400
        assert "Cannot demote or suspend the sole remaining active administrator" in resp.json()["detail"]

        # Step 3: Attempt to suspend admin_1 (must be REJECTED)
        resp = client.put(f"/api/v1/admin/users/{admin_1}/status", json={"is_active": 0}, headers=headers)
        assert resp.status_code == 400
        assert "Cannot demote or suspend the sole remaining active administrator" in resp.json()["detail"]

        # Verify audit log count did NOT increase for failed mutations
        resp = client.get("/api/v1/admin/audit-logs", headers=headers)
        assert resp.json()["total"] == count_before

        # Verify admin_1 is still an active admin in DB
        async def verify_admin_1_intact():
            async with admin_test_env["std_factory"]() as session:
                u = await session.get(User, admin_1)
                assert u.role == "admin"
                assert u.is_active == 1

        run_async(verify_admin_1_intact())

    def test_audit_logs_filtering_and_pagination(self, admin_test_env):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}

        # Filter by action
        resp = client.get("/api/v1/admin/audit-logs?action=USER_ROLE_CHANGE", headers=headers)
        assert resp.status_code == 200
        for item in resp.json()["items"]:
            assert item["action"] == "USER_ROLE_CHANGE"

        # Filter by actor_id
        resp = client.get(f"/api/v1/admin/audit-logs?actor_id={admin_test_env['admin_id_1']}", headers=headers)
        assert resp.status_code == 200
        for item in resp.json()["items"]:
            assert item["actor_id"] == admin_test_env["admin_id_1"]
            assert item["actor_email"] == "admin1@test.com"

    def test_audit_insertion_failure_rolls_back_user_mutation(self, admin_test_env, monkeypatch):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}
        user_id = admin_test_env["user_id_1"]

        from backend.admin import service

        async def failing_log_audit(*args, **kwargs):
            raise RuntimeError("Simulated audit disk failure")

        monkeypatch.setattr(service, "log_audit_event", failing_log_audit)

        with pytest.raises(RuntimeError, match="Simulated audit disk failure"):
            client.put(
                f"/api/v1/admin/users/{user_id}/role",
                json={"role": "admin"},
                headers=headers,
            )

        # Verify that because the transaction rolled back, the user's role remains unchanged!
        async def verify_user_unmodified():
            async with admin_test_env["std_factory"]() as session:
                u = await session.get(User, user_id)
                assert u.role == "user"
                assert u.token_version == 1

        run_async(verify_user_unmodified())

    def test_concurrent_last_admin_demotion_race_leaves_at_least_one_admin(self, admin_test_env):
        admin_1 = admin_test_env["admin_id_1"]
        admin_2 = admin_test_env["admin_id_2"]
        crit_factory = admin_test_env["crit_factory"]

        from backend.admin.service import update_user_role_transactional

        results = []

        async def worker_1():
            try:
                async with crit_factory() as session:
                    async with session.begin():
                        u = await update_user_role_transactional(
                            session=session,
                            admin_id=admin_2,
                            target_user_id=admin_1,
                            new_role="user",
                        )
                        results.append(("worker_1", "success", u.role))
            except Exception as e:
                results.append(("worker_1", "error", str(e)))

        async def worker_2():
            try:
                async with crit_factory() as session:
                    async with session.begin():
                        u = await update_user_role_transactional(
                            session=session,
                            admin_id=admin_1,
                            target_user_id=admin_2,
                            new_role="user",
                        )
                        results.append(("worker_2", "success", u.role))
            except Exception as e:
                results.append(("worker_2", "error", str(e)))

        async def run_race():
            await asyncio.gather(worker_1(), worker_2())

        run_async(run_race())

        # Exactly one worker should succeed, and one worker must fail with 400 error!
        successes = [r for r in results if r[1] == "success"]
        errors = [r for r in results if r[1] == "error"]
        assert len(successes) == 1, f"Expected exactly 1 success, got {results}"
        assert len(errors) == 1, f"Expected exactly 1 error, got {results}"
        assert "Cannot demote or suspend the sole remaining active administrator" in errors[0][2]

        # Verify database still has exactly one active administrator!
        async def check_admin_count():
            async with admin_test_env["std_factory"]() as session:
                count = await session.scalar(
                    select(func.count(User.id)).where(User.role == "admin", User.is_active == 1)
                )
                assert count == 1

        run_async(check_admin_count())


# ============================================================================
# 4. Monitoring & Telemetry Endpoints Tests
# ============================================================================

class TestAdminMonitoringEndpoints:
    def test_empty_database_monitoring_states(self, admin_test_env):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}

        # Traffic batches empty
        resp = client.get("/api/v1/admin/traffic/batches", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == {"total": 0, "limit": 20, "offset": 0, "batches": []}

        # Traffic quality empty
        resp = client.get("/api/v1/admin/traffic/quality", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["quality_events_count"] == 0
        assert data["rejections_count"] == 0
        assert data["source_breakdown"] == {}

        # Models empty
        resp = client.get("/api/v1/admin/models", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == {"total": 0, "active_model_id": None, "models": []}

        # Training jobs empty
        resp = client.get("/api/v1/admin/models/jobs", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == {"total": 0, "limit": 20, "offset": 0, "jobs": []}

        # Workers empty
        resp = client.get("/api/v1/admin/system/workers", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == {"total": 0, "workers": []}

    def test_populated_traffic_data_monitoring(self, admin_test_env):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}
        now = datetime.now(timezone.utc)

        # Seed traffic batches with different source types
        async def seed_traffic():
            async with admin_test_env["crit_factory"]() as session:
                async with session.begin():
                    b1 = TrafficIngestionBatch(
                        id="batch-real-1",
                        batch_name="Tricity Sensor Ingest",
                        source_type="REAL_SENSOR",
                        submitted_by=admin_test_env["admin_id_1"],
                        total_records=1000,
                        accepted_records=990,
                        rejected_records=10,
                        ingested_at=now - timedelta(hours=2),
                    )
                    b2 = TrafficIngestionBatch(
                        id="batch-synth-1",
                        batch_name="SUMO Corridor Sim",
                        source_type="SIMULATION_SYNTHETIC",
                        submitted_by=admin_test_env["admin_id_1"],
                        total_records=5000,
                        accepted_records=5000,
                        rejected_records=0,
                        ingested_at=now - timedelta(hours=1),
                    )
                    b3 = TrafficIngestionBatch(
                        id="batch-hist-1",
                        batch_name="Metro DOT Historical",
                        source_type="HISTORICAL_BENCHMARK",
                        submitted_by=None,
                        total_records=48204,
                        accepted_records=48204,
                        rejected_records=0,
                        ingested_at=now - timedelta(days=1),
                    )
                    q_event = DataQualityEvent(
                        id="q-evt-1",
                        source_identifier="detector-sec-17",
                        event_type="SAMPLING_GAP",
                        event_start=now - timedelta(hours=3),
                        event_end=now - timedelta(hours=2, minutes=50),
                        missing_intervals=2,
                        details="Network packet loss",
                        created_at=now - timedelta(hours=2, minutes=50),
                    )
                    rej = IngestionRejection(
                        id="rej-1",
                        batch_id="batch-real-1",
                        raw_record="bad,csv,line",
                        rejection_reason="Unparseable coordinate format",
                        created_at=now - timedelta(hours=2),
                    )
                    session.add_all([b1, b2, b3, q_event, rej])

        run_async(seed_traffic())

        # Test listing batches
        resp = client.get("/api/v1/admin/traffic/batches", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 3
        assert len(data["batches"]) == 3

        # Test filter by source_type
        resp = client.get("/api/v1/admin/traffic/batches?source_type=REAL_SENSOR", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["total"] == 1
        assert resp.json()["batches"][0]["batch_name"] == "Tricity Sensor Ingest"

        # Test traffic quality summary
        resp = client.get("/api/v1/admin/traffic/quality", headers=headers)
        assert resp.status_code == 200
        qdata = resp.json()
        assert qdata["quality_events_count"] == 1
        assert qdata["quality_events"][0]["event_type"] == "SAMPLING_GAP"
        assert qdata["rejections_count"] == 1
        assert qdata["rejections"][0]["rejection_reason"] == "Unparseable coordinate format"
        assert qdata["source_breakdown"] == {
            "REAL_SENSOR": 1,
            "SIMULATION_SYNTHETIC": 1,
            "HISTORICAL_BENCHMARK": 1,
        }

    def test_populated_ml_model_monitoring(self, admin_test_env):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}
        now = datetime.now(timezone.utc)

        # Seed ML model and training job
        async def seed_ml():
            async with admin_test_env["crit_factory"]() as session:
                async with session.begin():
                    job = MLTrainingJob(
                        id="job-ml-1",
                        triggered_by=admin_test_env["admin_id_1"],
                        status="COMPLETED",
                        dataset_name="traffic_volume.csv",
                        dataset_version="v1.0.0",
                        hyperparameters=json.dumps({"n_estimators": 150, "max_depth": 20}),
                        random_seed=42,
                        metrics=json.dumps({"accuracy": 0.88, "f1": 0.87}),
                        started_at=now - timedelta(hours=1),
                        completed_at=now - timedelta(minutes=45),
                        created_at=now - timedelta(hours=1),
                    )
                    session.add(job)
                    await session.flush()

                    model = ModelRegistry(
                        id="model-rf-150",
                        job_id="job-ml-1",
                        dataset_identity="traffic_volume.csv",
                        dataset_version="v1.0.0",
                        feature_names="temp,rain_1h,snow_1h,clouds_all,hour,day,month,day_of_week",
                        feature_schema_version="v1",
                        training_config=json.dumps({"n_estimators": 150, "max_depth": 20}),
                        random_seed=42,
                        evaluation_metrics=json.dumps({"f1_macro": 0.87}),
                        model_framework_version="scikit-learn 1.9.0",
                        artifact_path="backend/models/traffic_model.pkl",
                        artifact_checksum_sha256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                        is_active=1,
                        trained_by=admin_test_env["admin_id_1"],
                        trained_at=now - timedelta(minutes=45),
                        review_status="APPROVED",
                    )
                    session.add(model)
                    await session.flush()

                    deployment = ActiveModelDeployment(
                        id=1,
                        model_id="model-rf-150",
                        target_version=1,
                        deployed_at=now - timedelta(minutes=30),
                        deployed_by=admin_test_env["admin_id_1"],
                    )
                    session.add(deployment)

        run_async(seed_ml())

        # Test listing models
        resp = client.get("/api/v1/admin/models", headers=headers)
        assert resp.status_code == 200
        mdata = resp.json()
        assert mdata["total"] == 1
        assert mdata["active_model_id"] == "model-rf-150"
        assert mdata["models"][0]["model_framework_version"] == "scikit-learn 1.9.0"

        # Test listing training jobs
        resp = client.get("/api/v1/admin/models/jobs", headers=headers)
        assert resp.status_code == 200
        jdata = resp.json()
        assert jdata["total"] == 1
        assert jdata["jobs"][0]["status"] == "COMPLETED"
        assert jdata["jobs"][0]["dataset_name"] == "traffic_volume.csv"

        # Verify platform overview reflects active model
        resp = client.get("/api/v1/admin/overview", headers=headers)
        assert resp.status_code == 200
        ov = resp.json()
        assert ov["model_deployment_status"] == "DEPLOYED"
        assert ov["active_model"]["id"] == "model-rf-150"

    def test_populated_worker_status_monitoring(self, admin_test_env):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}
        now = datetime.now(timezone.utc)

        # Seed active and stale workers
        async def seed_workers():
            async with admin_test_env["crit_factory"]() as session:
                async with session.begin():
                    w_live = WorkerDeploymentStatus(
                        worker_id="worker-node-1",
                        pid=12345,
                        loaded_version=1,
                        loaded_model_id="model-rf-150",
                        status="READY",
                        last_heartbeat=now - timedelta(seconds=10),
                    )
                    w_stale = WorkerDeploymentStatus(
                        worker_id="worker-node-2",
                        pid=12346,
                        loaded_version=1,
                        loaded_model_id="model-rf-150",
                        status="LOAD_FAILED",
                        error_message="OOM during model unpickling",
                        last_heartbeat=now - timedelta(seconds=120),
                    )
                    session.add_all([w_live, w_stale])

        run_async(seed_workers())

        resp = client.get("/api/v1/admin/system/workers", headers=headers)
        assert resp.status_code == 200
        wdata = resp.json()
        assert wdata["total"] == 2
        # w_live: heartbeat 10s ago -> is_stale=False
        live = next(w for w in wdata["workers"] if w["worker_id"] == "worker-node-1")
        assert live["is_stale"] is False
        assert live["status"] == "READY"

        # w_stale: heartbeat 120s ago -> is_stale=True
        stale = next(w for w in wdata["workers"] if w["worker_id"] == "worker-node-2")
        assert stale["is_stale"] is True
        assert stale["status"] == "LOAD_FAILED"
        assert stale["error_message"] == "OOM during model unpickling"


class TestAdminCSRFAndAuditConstraints:
    def test_admin_put_role_and_status_succeed_with_valid_csrf_cookie_and_header(self, admin_test_env):
        client = admin_test_env["client"]
        admin_token = admin_test_env["admin_token"]
        user_id = admin_test_env["user_id_1"]
        csrf_val = generate_csrf_token()

        headers = {
            "Authorization": f"Bearer {admin_token}",
            "Origin": "http://localhost:5173",
            "X-CSRF-Token": csrf_val,
            "Cookie": f"{CSRF_COOKIE_NAME}={csrf_val}",
        }

        # Role mutation with valid CSRF
        res = client.put(
            f"/api/v1/admin/users/{user_id}/role",
            headers=headers,
            json={"role": "admin"},
        )
        assert res.status_code == 200
        assert res.json()["role"] == "admin"

        # Status mutation with valid CSRF
        res = client.put(
            f"/api/v1/admin/users/{user_id}/status",
            headers=headers,
            json={"is_active": 0},
        )
        assert res.status_code == 200
        assert res.json()["is_active"] == 0

    def test_admin_put_role_fails_when_csrf_cookie_present_without_header(self, admin_test_env):
        client = admin_test_env["client"]
        admin_token = admin_test_env["admin_token"]
        user_id = admin_test_env["user_id_1"]
        csrf_val = generate_csrf_token()

        headers = {
            "Authorization": f"Bearer {admin_token}",
            "Origin": "http://localhost:5173",
            "Cookie": f"{CSRF_COOKIE_NAME}={csrf_val}",
        }

        res = client.put(
            f"/api/v1/admin/users/{user_id}/role",
            headers=headers,
            json={"role": "admin"},
        )
        assert res.status_code == 403
        assert "csrf validation failed" in res.json()["detail"].lower()

    def test_admin_put_role_fails_when_csrf_token_mismatched(self, admin_test_env):
        client = admin_test_env["client"]
        admin_token = admin_test_env["admin_token"]
        user_id = admin_test_env["user_id_1"]
        csrf_val = generate_csrf_token()
        another_csrf_val = generate_csrf_token()

        headers = {
            "Authorization": f"Bearer {admin_token}",
            "Origin": "http://localhost:5173",
            "X-CSRF-Token": another_csrf_val,
            "Cookie": f"{CSRF_COOKIE_NAME}={csrf_val}",
        }

        res = client.put(
            f"/api/v1/admin/users/{user_id}/role",
            headers=headers,
            json={"role": "admin"},
        )
        assert res.status_code == 403
        assert "csrf validation failed: token mismatch" in res.json()["detail"].lower()

    def test_admin_put_role_fails_when_csrf_origin_untrusted(self, admin_test_env):
        client = admin_test_env["client"]
        admin_token = admin_test_env["admin_token"]
        user_id = admin_test_env["user_id_1"]
        csrf_val = generate_csrf_token()

        headers = {
            "Authorization": f"Bearer {admin_token}",
            "Origin": "http://evil-attacker.com",
            "X-CSRF-Token": csrf_val,
            "Cookie": f"{CSRF_COOKIE_NAME}={csrf_val}",
        }

        res = client.put(
            f"/api/v1/admin/users/{user_id}/role",
            headers=headers,
            json={"role": "admin"},
        )
        assert res.status_code == 403
        assert "untrusted origin" in res.json()["detail"].lower()

    def test_audit_log_database_check_constraint_permits_all_six_allowed_actions(self, admin_test_env):
        crit_factory = admin_test_env["crit_factory"]
        admin_id = admin_test_env["admin_id_1"]
        now = datetime.now(timezone.utc)

        expected_allowed = {
            "USER_ROLE_CHANGE",
            "USER_STATUS_CHANGE",
            "MODEL_DEPLOY",
            "MODEL_ROLLBACK",
            "NETWORK_BUILD",
            "DATASET_INGEST",
        }
        assert ALLOWED_ACTIONS == expected_allowed

        async def insert_all_allowed_actions():
            async with crit_factory() as session:
                async with session.begin():
                    for action in expected_allowed:
                        record = AuditLog(
                            id=uuid.uuid4().hex,
                            actor_id=admin_id,
                            action=action,
                            target_entity="system:test",
                            details=f'{{"action": "{action}"}}',
                            ip_address="127.0.0.1",
                            created_at=now,
                        )
                        session.add(record)

        # Proves SQLite check constraint ck_audit_logs_action accepts all 6 actions
        run_async(insert_all_allowed_actions())

        async def verify_records_count():
            async with crit_factory() as session:
                count = await session.scalar(
                    select(func.count(AuditLog.id)).where(AuditLog.target_entity == "system:test")
                )
                assert count == 6

        run_async(verify_records_count())

    def test_audit_log_service_and_db_constraint_reject_unsupported_actions(self, admin_test_env):
        crit_factory = admin_test_env["crit_factory"]
        admin_id = admin_test_env["admin_id_1"]
        now = datetime.now(timezone.utc)

        unsupported_actions = [
            "CONFIG_UPDATE",
            "MODEL_DEPLOYMENT",
            "EMERGENCY_OVERRIDE",
            "ARBITRARY_ACTION",
        ]

        # 1. Service layer rejection via ValueError
        for bogus_action in unsupported_actions:
            with pytest.raises(ValueError, match="Invalid audit action"):
                create_audit_record(
                    actor_id=admin_id,
                    action=bogus_action,
                    target_entity="system:test",
                    details={},
                )

        # 2. Database layer rejection via SQLite CHECK constraint ck_audit_logs_action
        for bogus_action in unsupported_actions:
            async def try_db_insert(action_name=bogus_action):
                async with crit_factory() as session:
                    async with session.begin():
                        record = AuditLog(
                            id=uuid.uuid4().hex,
                            actor_id=admin_id,
                            action=action_name,
                            target_entity="system:test",
                            details="{}",
                            ip_address="127.0.0.1",
                            created_at=now,
                        )
                        session.add(record)

            with pytest.raises(IntegrityError):
                run_async(try_db_insert())


# ============================================================================
# 8. Admin Overview Telemetry & Road Network Fallback Tests (Phase 11.5.4)
# ============================================================================

class TestAdminOverviewRoadNetworkFallbacks:
    """Verify backend/admin/service.py road network status mapping, fallbacks, and non-fabrication."""

    def test_road_network_fallback_with_actual_routing_structure(self, monkeypatch, admin_test_env):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}

        # Mock actual live structure from backend.routing.road_network
        monkeypatch.setattr(
            "backend.admin.service.get_network_status",
            lambda: {
                "available_locally": True,
                "status": "ready",
                "storage_path": "/path/chandigarh_tricity.graphml",
            },
        )
        monkeypatch.setattr(
            "backend.admin.service.get_network_summary",
            lambda: {
                "node_count": 56254,
                "directed_edge_count": 144015,
                "intersection_count": 45148,
                "mapped_traffic_signal_count": 26,
            },
        )

        resp = client.get("/api/v1/admin/overview", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        rn = data["road_network"]

        assert rn["available"] is True
        assert rn["status"] == "ready"
        assert rn["intersections_count"] == 45148
        assert rn["edges_count"] == 144015
        assert rn["message"] == "Network graph ready in memory"

    def test_road_network_fallback_when_unavailable_does_not_fabricate_zeros(
        self, monkeypatch, admin_test_env
    ):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}

        # Unavailable network with empty summary dict
        monkeypatch.setattr(
            "backend.admin.service.get_network_status",
            lambda: {"available_locally": False, "status": "missing"},
        )
        monkeypatch.setattr("backend.admin.service.get_network_summary", lambda: {})

        resp = client.get("/api/v1/admin/overview", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        rn = data["road_network"]

        # An unavailable network must NOT be reported as available
        assert rn["available"] is False
        assert rn["status"] == "missing"
        # Missing data must be None, NOT fabricated as 0
        assert rn["intersections_count"] is None
        assert rn["edges_count"] is None

    def test_road_network_fallback_on_exception_reports_error_without_crashing(
        self, monkeypatch, admin_test_env
    ):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}

        def raise_corrupted():
            raise RuntimeError("Simulated GraphML corrupted header")

        monkeypatch.setattr("backend.admin.service.get_network_status", raise_corrupted)

        resp = client.get("/api/v1/admin/overview", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        rn = data["road_network"]

        assert rn["available"] is False
        assert rn["status"] == "ERROR"
        assert "Simulated GraphML corrupted header" in rn["message"]

    def test_road_network_legacy_key_backward_compatibility(self, monkeypatch, admin_test_env):
        client = admin_test_env["client"]
        headers = {"Authorization": f"Bearer {admin_test_env['admin_token']}"}

        # Legacy keys from earlier draft schemas
        monkeypatch.setattr(
            "backend.admin.service.get_network_status",
            lambda: {"graph_available_locally": True, "load_status": "loaded"},
        )
        monkeypatch.setattr(
            "backend.admin.service.get_network_summary",
            lambda: {"total_intersections": 45000, "total_edges": 140000},
        )

        resp = client.get("/api/v1/admin/overview", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        rn = data["road_network"]

        assert rn["available"] is True
        assert rn["status"] == "loaded"
        assert rn["intersections_count"] == 45000
        assert rn["edges_count"] == 140000


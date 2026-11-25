import asyncio
from datetime import datetime, timezone
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.api.main import app
from backend.auth.jwt import create_access_token
from backend.auth.security import hash_password
from backend.database.migrate import run_migrations
from backend.database.models import RouteSearchHistory, SavedRoute, User
from backend.database.session import (
    get_critical_db,
    get_db,
    setup_engine_pragmas,
    setup_immediate_begin_listener,
)


def run_async(coro):
    return asyncio.run(coro)


@pytest.fixture
def workspace_db_setup(tmp_path):
    temp_db = tmp_path / "test_workspace.db"
    run_migrations(target_db_path=temp_db)
    url = f"sqlite+aiosqlite:///{temp_db.resolve().as_posix()}"

    test_std_engine = create_async_engine(url)
    setup_engine_pragmas(test_std_engine)
    test_std_factory = async_sessionmaker(test_std_engine, class_=AsyncSession, expire_on_commit=False)

    test_crit_engine = create_async_engine(url)
    setup_engine_pragmas(test_crit_engine)
    setup_immediate_begin_listener(test_crit_engine)
    test_crit_factory = async_sessionmaker(test_crit_engine, class_=AsyncSession, expire_on_commit=False)

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

    client = TestClient(app)

    yield {
        "client": client,
        "std_factory": test_std_factory,
        "crit_factory": test_crit_factory,
    }

    app.dependency_overrides.clear()
    run_async(test_std_engine.dispose())
    run_async(test_crit_engine.dispose())


def create_user_and_token(std_factory, email="user@test.com", full_name="User Test", role="user"):
    now = datetime.now(timezone.utc)
    uid = uuid.uuid4().hex

    async def _insert():
        async with std_factory() as session:
            u = User(
                id=uid,
                email=email,
                password_hash=hash_password("Password123!"),
                full_name=full_name,
                role=role,
                is_active=1,
                token_version=1,
                created_at=now,
                updated_at=now,
            )
            session.add(u)
            await session.commit()

    run_async(_insert())
    token = create_access_token(uid, role, 1)
    return uid, token


class TestUserWorkspaceBackend:
    def test_unauthenticated_requests_rejected(self, workspace_db_setup):
        client = workspace_db_setup["client"]

        assert client.get("/api/v1/user/saved-routes").status_code == 401
        assert client.post("/api/v1/user/saved-routes", json={}).status_code == 401
        assert client.delete("/api/v1/user/saved-routes/dummy-id").status_code == 401
        assert client.get("/api/v1/user/route-history").status_code == 401
        assert client.post("/api/v1/user/route-history", json={}).status_code == 401
        assert client.get("/api/v1/user/dashboard-summary").status_code == 401
        assert client.put("/auth/me", json={"full_name": "New"}).status_code == 401

    def test_profile_update_success_and_validation(self, workspace_db_setup):
        client = workspace_db_setup["client"]
        factory = workspace_db_setup["std_factory"]
        uid, token = create_user_and_token(factory, "profile@test.com", "Old Name")

        # 1. Update full name
        res = client.put(
            "/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            json={"full_name": "New Updated Name"},
        )
        assert res.status_code == 200
        assert res.json()["full_name"] == "New Updated Name"

        # 2. Verify via GET /auth/me
        get_res = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert get_res.status_code == 200
        assert get_res.json()["full_name"] == "New Updated Name"

        # 3. Validation: blank full_name rejected
        bad_res = client.put(
            "/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            json={"full_name": "   "},
        )
        assert bad_res.status_code == 400

    def test_saved_routes_crud_and_ownership(self, workspace_db_setup):
        client = workspace_db_setup["client"]
        factory = workspace_db_setup["std_factory"]

        u1_id, u1_token = create_user_and_token(factory, "u1@test.com", "User 1")
        u2_id, u2_token = create_user_and_token(factory, "u2@test.com", "User 2")

        # User 1 saves a route
        route_payload = {
            "title": "Home to Work",
            "origin_name": "Sector 17, Chandigarh",
            "origin_lat": 30.741482,
            "origin_lon": 76.768066,
            "destination_name": "IT Park, Chandigarh",
            "destination_lat": 30.724,
            "destination_lon": 76.845,
            "preferred_criteria": "balanced",
            "distance_km": 8.4,
            "estimated_duration_min": 17.5,
            "route_score": 88.2,
            "recommendation_reason": "Lowest aggregate signal delay",
        }
        create_res = client.post(
            "/api/v1/user/saved-routes",
            headers={"Authorization": f"Bearer {u1_token}"},
            json=route_payload,
        )
        assert create_res.status_code == 201
        saved_route_data = create_res.json()
        route_id = saved_route_data["id"]
        assert saved_route_data["title"] == "Home to Work"
        assert saved_route_data["user_id"] == u1_id
        assert saved_route_data["distance_km"] == 8.4
        assert saved_route_data["route_score"] == 88.2

        # User 1 lists saved routes: sees the route
        u1_list = client.get(
            "/api/v1/user/saved-routes",
            headers={"Authorization": f"Bearer {u1_token}"},
        )
        assert u1_list.status_code == 200
        assert len(u1_list.json()) == 1
        assert u1_list.json()[0]["id"] == route_id

        # User 2 lists saved routes: ISOLATION -> sees 0 routes!
        u2_list = client.get(
            "/api/v1/user/saved-routes",
            headers={"Authorization": f"Bearer {u2_token}"},
        )
        assert u2_list.status_code == 200
        assert len(u2_list.json()) == 0

        # User 2 attempts to delete User 1's route -> OWNERSHIP ENFORCEMENT -> 404 Not Found!
        hack_del = client.delete(
            f"/api/v1/user/saved-routes/{route_id}",
            headers={"Authorization": f"Bearer {u2_token}"},
        )
        assert hack_del.status_code == 404

        # User 1 deletes their route -> 200 OK
        valid_del = client.delete(
            f"/api/v1/user/saved-routes/{route_id}",
            headers={"Authorization": f"Bearer {u1_token}"},
        )
        assert valid_del.status_code == 200

        # Now User 1 has 0 routes
        empty_list = client.get(
            "/api/v1/user/saved-routes",
            headers={"Authorization": f"Bearer {u1_token}"},
        )
        assert len(empty_list.json()) == 0

    def test_route_history_and_isolation(self, workspace_db_setup):
        client = workspace_db_setup["client"]
        factory = workspace_db_setup["std_factory"]

        u1_id, u1_token = create_user_and_token(factory, "hist1@test.com", "H1")
        u2_id, u2_token = create_user_and_token(factory, "hist2@test.com", "H2")

        # Record search for User 1
        client.post(
            "/api/v1/user/route-history",
            headers={"Authorization": f"Bearer {u1_token}"},
            json={
                "origin_query": "Sector 35",
                "destination_query": "Airport",
                "selected_route_id": "route_0",
                "route_distance_km": 14.2,
                "estimated_duration_min": 24.0,
            },
        )

        # User 1 history has 1 record
        h1_res = client.get(
            "/api/v1/user/route-history",
            headers={"Authorization": f"Bearer {u1_token}"},
        )
        assert h1_res.status_code == 200
        assert len(h1_res.json()) == 1
        assert h1_res.json()[0]["origin_query"] == "Sector 35"

        # User 2 history is empty
        h2_res = client.get(
            "/api/v1/user/route-history",
            headers={"Authorization": f"Bearer {u2_token}"},
        )
        assert h2_res.status_code == 200
        assert len(h2_res.json()) == 0

    def test_dashboard_summary_endpoint(self, workspace_db_setup):
        client = workspace_db_setup["client"]
        factory = workspace_db_setup["std_factory"]

        uid, token = create_user_and_token(factory, "dash@test.com", "Dash User")

        # Create 2 saved routes
        for i in range(2):
            client.post(
                "/api/v1/user/saved-routes",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "title": f"Route {i}",
                    "origin_name": f"Origin {i}",
                    "origin_lat": 30.7,
                    "origin_lon": 76.7,
                    "destination_name": f"Dest {i}",
                    "destination_lat": 30.8,
                    "destination_lon": 76.8,
                    "preferred_criteria": "balanced",
                },
            )

        # Create 3 history searches
        for i in range(3):
            client.post(
                "/api/v1/user/route-history",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "origin_query": f"Query O {i}",
                    "destination_query": f"Query D {i}",
                },
            )

        summary_res = client.get(
            "/api/v1/user/dashboard-summary",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert summary_res.status_code == 200
        data = summary_res.json()
        assert data["user"]["full_name"] == "Dash User"
        assert data["total_saved_routes"] == 2
        assert data["total_searches"] == 3
        assert len(data["recent_saved_routes"]) == 2
        assert len(data["recent_searches"]) == 3

    def test_profile_update_cannot_escalate_role_or_privileges(self, workspace_db_setup):
        client = workspace_db_setup["client"]
        factory = workspace_db_setup["std_factory"]

        uid, token = create_user_and_token(factory, "priv@test.com", "Normal User", role="user")

        # Attempt to inject role="admin" and is_active=False via profile update
        exploit_res = client.put(
            "/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "full_name": "Updated Normal User",
                "role": "admin",
                "is_active": False,
                "token_version": 999,
            },
        )
        assert exploit_res.status_code == 200
        res_data = exploit_res.json()
        assert res_data["full_name"] == "Updated Normal User"
        assert res_data["role"] == "user"  # Role was NOT changed

        # Direct database verification
        async def _check_db():
            async with factory() as session:
                user = await session.get(User, uid)
                assert user.role == "user"
                assert user.is_active == 1
                assert user.token_version == 1

        run_async(_check_db())

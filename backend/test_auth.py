import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import uuid

import jwt
import pytest
from fastapi import Depends, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.api.main import app
from backend.auth.config import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    COOKIE_DOMAIN,
    COOKIE_NAME,
    COOKIE_PATH,
    COOKIE_SAMESITE,
    COOKIE_SECURE,
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME,
    ENVIRONMENT,
    JWT_ALGORITHM,
    JWT_SECRET_KEY,
)
from backend.auth.csrf import generate_csrf_token, is_origin_allowed, validate_csrf
from backend.auth.dependencies import (
    get_current_user,
    require_admin,
    require_authenticated_user,
)
from backend.auth.jwt import (
    InvalidTokenError,
    TokenExpiredError,
    create_access_token,
    decode_access_token,
)
from backend.auth.security import (
    hash_password,
    needs_rehash,
    validate_password_strength,
    verify_password,
)
from backend.auth.service import (
    create_user_account,
    demote_or_suspend_admin,
    hash_refresh_token,
    logout_all_sessions,
    logout_current_session,
    rotate_refresh_token_with_reuse_detection,
)
from backend.database.migrate import run_migrations
from backend.database.models import RefreshToken, User
from backend.database.session import (
    get_critical_db,
    get_db,
    setup_engine_pragmas,
    setup_immediate_begin_listener,
)


# Helper for running async functions in synchronous test cases
def run_async(coro):
    return asyncio.run(coro)


# Setup temporary isolated test database per fixture
@pytest.fixture
def test_db_setup(tmp_path):
    temp_db = tmp_path / "test_auth.db"
    run_migrations(target_db_path=temp_db)
    url = f"sqlite+aiosqlite:///{temp_db.resolve().as_posix()}"

    # Setup isolated standard engine
    test_std_engine = create_async_engine(url)
    setup_engine_pragmas(test_std_engine)
    test_std_factory = async_sessionmaker(test_std_engine, class_=AsyncSession, expire_on_commit=False)

    # Setup isolated critical engine
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
        "std_engine": test_std_engine,
        "crit_engine": test_crit_engine,
    }

    app.dependency_overrides.clear()
    run_async(test_std_engine.dispose())
    run_async(test_crit_engine.dispose())


# ============================================================================
# 1. Password Security Tests
# ============================================================================
class TestPasswordSecurity:
    def test_hash_and_verify_success(self):
        password = "SecurePassword123!"
        hashed = hash_password(password)
        assert hashed.startswith("$argon2id$")
        assert verify_password(password, hashed) is True
        assert verify_password("WrongPassword!", hashed) is False

    def test_password_strength_validation(self):
        # Too short (< 8 chars)
        with pytest.raises(ValueError, match="at least 8 characters"):
            validate_password_strength("short1")

        # Too long (> 128 chars)
        with pytest.raises(ValueError, match="cannot exceed 128 characters"):
            validate_password_strength("A" * 129)

        # Blank / Whitespace
        with pytest.raises(ValueError, match="cannot be empty or whitespace-only"):
            validate_password_strength("        ")

        # Valid password passes
        validate_password_strength("valid-pass-123")

    def test_needs_rehash_check(self):
        hashed = hash_password("MySecurePass123")
        assert needs_rehash(hashed) is False


# ============================================================================
# 2. JWT Access Token Tests
# ============================================================================
class TestJWTAccessTokens:
    def test_create_and_decode_valid_token(self):
        user_id = "user-123"
        role = "user"
        token_version = 1
        token = create_access_token(user_id, role, token_version)

        payload = decode_access_token(token)
        assert payload["sub"] == user_id
        assert payload["role"] == role
        assert payload["token_version"] == token_version
        assert "jti" in payload
        assert "iat" in payload
        assert "exp" in payload

    def test_token_expiration(self):
        token = create_access_token(
            "user-123", "user", 1, expires_delta=timedelta(minutes=-1)
        )
        with pytest.raises(TokenExpiredError, match="has expired"):
            decode_access_token(token)

    def test_token_invalid_signature(self):
        token = create_access_token("user-123", "user", 1)
        parts = token.split(".")
        tampered_token = f"{parts[0]}.{parts[1]}abc.{parts[2]}"
        with pytest.raises(InvalidTokenError):
            decode_access_token(tampered_token)

    def test_token_wrong_algorithm(self):
        fake_payload = {
            "sub": "user-123",
            "role": "user",
            "token_version": 1,
            "iat": int(datetime.now(timezone.utc).timestamp()),
            "exp": int((datetime.now(timezone.utc) + timedelta(minutes=15)).timestamp()),
            "jti": "mock-jti",
        }
        token = jwt.encode(fake_payload, "other-secret-key-that-is-at-least-48-bytes-long-for-hmac-sha384", algorithm="HS384")
        with pytest.raises(InvalidTokenError):
            decode_access_token(token)

    def test_token_missing_claims(self):
        incomplete_payload = {"sub": "user-123", "role": "user"}
        token = jwt.encode(incomplete_payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
        with pytest.raises(InvalidTokenError):
            decode_access_token(token)


# ============================================================================
# 3. User Registration Tests & Profile Contract
# ============================================================================
class TestRegistrationEndpoints:
    def test_register_user_success(self, test_db_setup):
        client = test_db_setup["client"]
        res = client.post(
            "/auth/register",
            json={
                "email": "NewUser@Example.com",
                "full_name": "New User",
                "password": "Password123!",
            },
        )
        assert res.status_code == 201
        data = res.json()
        assert data["email"] == "newuser@example.com"
        assert data["full_name"] == "New User"
        assert data["role"] == "user"
        assert data["is_active"] == 1
        assert "password_hash" not in data
        assert "username" not in data  # Proves schema uses full_name, not username

    def test_register_duplicate_email_rejected(self, test_db_setup):
        client = test_db_setup["client"]
        payload = {
            "email": "duplicate@test.com",
            "full_name": "First User",
            "password": "Password123!",
        }
        res1 = client.post("/auth/register", json=payload)
        assert res1.status_code == 201

        res2 = client.post("/auth/register", json=payload)
        assert res2.status_code == 400
        assert "already registered" in res2.json()["detail"].lower()

    def test_register_email_normalized(self, test_db_setup):
        client = test_db_setup["client"]
        res = client.post(
            "/auth/register",
            json={
                "email": "  SpAcEd_UsEr@TeSt.CoM  ",
                "full_name": "Spaced User",
                "password": "Password123!",
            },
        )
        assert res.status_code == 201
        assert res.json()["email"] == "spaced_user@test.com"

    def test_register_client_cannot_assign_admin_role(self, test_db_setup):
        client = test_db_setup["client"]
        res = client.post(
            "/auth/register",
            json={
                "email": "fakeadmin@test.com",
                "full_name": "Fake Admin",
                "password": "Password123!",
                "role": "admin",
            },
        )
        assert res.status_code == 201
        assert res.json()["role"] == "user"

    def test_register_invalid_password_rejected(self, test_db_setup):
        client = test_db_setup["client"]
        res = client.post(
            "/auth/register",
            json={
                "email": "badpass@test.com",
                "full_name": "Bad Pass",
                "password": "123",
            },
        )
        assert res.status_code == 400


# ============================================================================
# 4. Browser vs Mobile/CLI Transport & Login Tests
# ============================================================================
class TestLoginEndpointsAndTransport:
    def test_login_browser_flow_no_refresh_in_json(self, test_db_setup):
        client = test_db_setup["client"]
        client.post(
            "/auth/register",
            json={"email": "browser@test.com", "full_name": "Browser User", "password": "Password123!"},
        )

        # 1. Login with default browser cookie flow
        res = client.post(
            "/auth/login",
            json={"email": "browser@test.com", "password": "Password123!"},
        )
        assert res.status_code == 200
        data = res.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

        # Security invariant: Raw refresh token is NEVER exposed in JSON for browser flow!
        assert data.get("refresh_token") is None

        # CSRF token is provided in JSON and set in cookie
        assert data.get("csrf_token") is not None
        assert CSRF_COOKIE_NAME in res.cookies
        assert res.cookies[CSRF_COOKIE_NAME] == data["csrf_token"]

        # HttpOnly refresh cookie is set
        assert COOKIE_NAME in res.cookies

    def test_login_mobile_cli_flow_returns_refresh_token_in_json(self, test_db_setup):
        client = test_db_setup["client"]
        client.post(
            "/auth/register",
            json={"email": "mobile@test.com", "full_name": "Mobile User", "password": "Password123!"},
        )

        # Login with mobile/CLI body flow
        res = client.post(
            "/auth/login",
            json={"email": "mobile@test.com", "password": "Password123!", "token_transport": "body"},
        )
        assert res.status_code == 200
        data = res.json()
        assert "access_token" in data
        # In body flow, raw refresh token IS in JSON body
        assert data.get("refresh_token") is not None
        assert data.get("csrf_token") is None
        # Zero cookies should be set in mobile/CLI flow
        assert COOKIE_NAME not in res.cookies
        assert CSRF_COOKIE_NAME not in res.cookies

    def test_login_incorrect_password(self, test_db_setup):
        client = test_db_setup["client"]
        client.post(
            "/auth/register",
            json={"email": "user1@test.com", "full_name": "User One", "password": "Password123!"},
        )
        res = client.post(
            "/auth/login",
            json={"email": "user1@test.com", "password": "WrongPassword!"},
        )
        assert res.status_code == 401
        assert res.json()["detail"] == "Invalid email or password."

    def test_login_unknown_email(self, test_db_setup):
        client = test_db_setup["client"]
        res = client.post(
            "/auth/login",
            json={"email": "nonexistent@test.com", "password": "Password123!"},
        )
        assert res.status_code == 401
        assert res.json()["detail"] == "Invalid email or password."

    def test_login_inactive_account_rejected(self, test_db_setup):
        client = test_db_setup["client"]
        std_factory = test_db_setup["std_factory"]

        now = datetime.now(timezone.utc)
        async def create_inactive():
            async with std_factory() as session:
                user = User(
                    id="inactive-user-1",
                    email="inactive@test.com",
                    password_hash=hash_password("Password123!"),
                    full_name="Inactive User",
                    role="user",
                    is_active=0,
                    token_version=1,
                    created_at=now,
                    updated_at=now,
                )
                session.add(user)
                await session.commit()

        run_async(create_inactive())

        res = client.post(
            "/auth/login",
            json={"email": "inactive@test.com", "password": "Password123!"},
        )
        assert res.status_code == 403
        assert "inactive or suspended" in res.json()["detail"].lower()


# ============================================================================
# 5. CSRF Protection for Cookie-Authenticated Requests
# ============================================================================
class TestCSRFProtection:
    def test_cookie_refresh_without_csrf_header_rejected_with_403(self, test_db_setup):
        client = test_db_setup["client"]
        client.post(
            "/auth/register",
            json={"email": "csrf1@test.com", "full_name": "C1", "password": "Password123!"},
        )
        login_res = client.post(
            "/auth/login",
            json={"email": "csrf1@test.com", "password": "Password123!"},
        )
        assert login_res.status_code == 200

        # Attempt to refresh using cookie without X-CSRF-Token header (with valid Origin)
        res = client.post(
            "/auth/refresh",
            headers={"Origin": "http://localhost:5173"},
        )
        assert res.status_code == 403
        assert "csrf" in res.json()["detail"].lower()

    def test_cookie_refresh_missing_both_origin_and_referer_rejected_with_403(self, test_db_setup):
        client = test_db_setup["client"]
        client.post(
            "/auth/register",
            json={"email": "csrf_no_origin@test.com", "full_name": "NoOrigin", "password": "Password123!"},
        )
        login_res = client.post(
            "/auth/login",
            json={"email": "csrf_no_origin@test.com", "password": "Password123!"},
        )
        csrf_val = login_res.json()["csrf_token"]

        # Attempt refresh with valid CSRF header but MISSING Origin and Referer
        res = client.post(
            "/auth/refresh",
            headers={"X-CSRF-Token": csrf_val},
        )
        assert res.status_code == 403
        assert "missing origin and referer" in res.json()["detail"].lower()

    def test_cookie_refresh_with_mismatched_csrf_header_rejected_with_403(self, test_db_setup):
        client = test_db_setup["client"]
        client.post(
            "/auth/register",
            json={"email": "csrf2@test.com", "full_name": "C2", "password": "Password123!"},
        )
        login_res = client.post(
            "/auth/login",
            json={"email": "csrf2@test.com", "password": "Password123!"},
        )
        assert login_res.status_code == 200

        # Attempt refresh with fake X-CSRF-Token header
        res = client.post(
            "/auth/refresh",
            headers={
                "X-CSRF-Token": "completely-fake-csrf-token",
                "Origin": "http://localhost:5173",
            },
        )
        assert res.status_code == 403
        assert "csrf" in res.json()["detail"].lower()

    def test_cookie_refresh_with_forged_unsigned_csrf_cookie_rejected_with_403(self, test_db_setup):
        client = test_db_setup["client"]
        client.post(
            "/auth/register",
            json={"email": "forged@test.com", "full_name": "Forged", "password": "Password123!"},
        )
        client.post(
            "/auth/login",
            json={"email": "forged@test.com", "password": "Password123!"},
        )
        # Attacker injects forged unsigned CSRF cookie and header
        raw_cookie = client.cookies.get(COOKIE_NAME)
        forged_val = "unsigned_fake_token_value_not_from_server"

        res = client.post(
            "/auth/refresh",
            headers={
                "X-CSRF-Token": forged_val,
                "Origin": "http://localhost:5173",
                "Cookie": f"{COOKIE_NAME}={raw_cookie}; {CSRF_COOKIE_NAME}={forged_val}",
            },
        )
        assert res.status_code == 403
        assert "signature" in res.json()["detail"].lower()

    def test_cookie_refresh_with_duplicate_csrf_cookies_rejected_with_403(self, test_db_setup):
        client = test_db_setup["client"]
        client.post(
            "/auth/register",
            json={"email": "dup_csrf@test.com", "full_name": "Dup", "password": "Password123!"},
        )
        login_res = client.post(
            "/auth/login",
            json={"email": "dup_csrf@test.com", "password": "Password123!"},
        )
        csrf_val = login_res.json()["csrf_token"]
        raw_cookie = client.cookies.get(COOKIE_NAME)

        # Attacker tosses duplicate CSRF cookie
        res = client.post(
            "/auth/refresh",
            headers={
                "X-CSRF-Token": csrf_val,
                "Origin": "http://localhost:5173",
                "Cookie": f"{COOKIE_NAME}={raw_cookie}; {CSRF_COOKIE_NAME}={csrf_val}; {CSRF_COOKIE_NAME}=attacker_tossed",
            },
        )
        assert res.status_code == 403
        assert "duplicate csrf cookies" in res.json()["detail"].lower()

    def test_cookie_refresh_with_untrusted_origin_rejected_with_403(self, test_db_setup):
        client = test_db_setup["client"]
        client.post(
            "/auth/register",
            json={"email": "csrf3@test.com", "full_name": "C3", "password": "Password123!"},
        )
        login_res = client.post(
            "/auth/login",
            json={"email": "csrf3@test.com", "password": "Password123!"},
        )
        csrf_val = login_res.json()["csrf_token"]

        # Attempt refresh with attacker Origin
        res = client.post(
            "/auth/refresh",
            headers={
                "X-CSRF-Token": csrf_val,
                "Origin": "http://evil-attacker-site.com",
            },
        )
        assert res.status_code == 403
        assert "untrusted origin" in res.json()["detail"].lower()

    def test_cookie_refresh_with_valid_origin_and_csrf_succeeds(self, test_db_setup):
        client = test_db_setup["client"]
        client.post(
            "/auth/register",
            json={"email": "csrf4@test.com", "full_name": "C4", "password": "Password123!"},
        )
        login_res = client.post(
            "/auth/login",
            json={"email": "csrf4@test.com", "password": "Password123!"},
        )
        csrf_val = login_res.json()["csrf_token"]

        # Valid Origin and matching CSRF header
        res = client.post(
            "/auth/refresh",
            headers={
                "X-CSRF-Token": csrf_val,
                "Origin": "http://localhost:5173",
            },
        )
        assert res.status_code == 200
        data = res.json()
        assert "access_token" in data
        assert data.get("refresh_token") is None  # Browser invariant
        assert data.get("csrf_token") is not None  # CSRF rotated
        assert res.cookies[CSRF_COOKIE_NAME] == data["csrf_token"]

    def test_transport_mixing_refresh_with_both_cookie_and_body_token_rejected_with_400(self, test_db_setup):
        client = test_db_setup["client"]
        client.post(
            "/auth/register",
            json={"email": "mixing@test.com", "full_name": "Mix", "password": "Password123!"},
        )
        login_res = client.post(
            "/auth/login",
            json={"email": "mixing@test.com", "password": "Password123!"},
        )
        assert login_res.status_code == 200

        # Attempt refresh sending BOTH ambient cookie AND body token
        res = client.post(
            "/auth/refresh",
            json={"refresh_token": "some-body-refresh-token"},
            headers={"Origin": "http://localhost:5173"},
        )
        assert res.status_code == 400
        assert "ambiguous transport" in res.json()["detail"].lower()

    def test_transport_mixing_logout_with_both_cookie_and_body_token_rejected_with_400(self, test_db_setup):
        client = test_db_setup["client"]
        client.post(
            "/auth/register",
            json={"email": "mix_logout@test.com", "full_name": "MixOut", "password": "Password123!"},
        )
        client.post(
            "/auth/login",
            json={"email": "mix_logout@test.com", "password": "Password123!"},
        )

        res = client.post(
            "/auth/logout",
            json={"refresh_token": "body-token-conflict"},
            headers={"Origin": "http://localhost:5173"},
        )
        assert res.status_code == 400
        assert "ambiguous transport" in res.json()["detail"].lower()

    def test_body_mode_header_without_body_token_does_not_fall_back_to_cookie(self, test_db_setup):
        client = test_db_setup["client"]
        client.post(
            "/auth/register",
            json={"email": "fallback@test.com", "full_name": "Fall", "password": "Password123!"},
        )
        client.post(
            "/auth/login",
            json={"email": "fallback@test.com", "password": "Password123!"},
        )

        # Send X-Token-Transport: body header, with cookies active, but no body token
        res = client.post(
            "/auth/refresh",
            headers={"X-Token-Transport": "body"},
        )
        assert res.status_code == 400
        assert "body transport requested but no refresh token" in res.json()["detail"].lower()


# ============================================================================
# 6. Refresh Token Rotation & Multi-Device Reuse Detection Tests
# ============================================================================
class TestRefreshTokenRotationAndReuse:
    def test_successful_body_refresh_rotation(self, test_db_setup):
        client = test_db_setup["client"]
        client.post(
            "/auth/register",
            json={"email": "body_refresh@test.com", "full_name": "BR", "password": "Password123!"},
        )
        login_res = client.post(
            "/auth/login",
            json={"email": "body_refresh@test.com", "password": "Password123!", "token_transport": "body"},
        )
        raw_refresh_1 = login_res.json()["refresh_token"]

        # Body-based refresh
        refresh_res = client.post(
            "/auth/refresh",
            json={"refresh_token": raw_refresh_1},
        )
        assert refresh_res.status_code == 200
        data = refresh_res.json()
        raw_refresh_2 = data["refresh_token"]
        assert raw_refresh_2 != raw_refresh_1

        # Token 2 succeeds
        refresh_res_2 = client.post(
            "/auth/refresh",
            json={"refresh_token": raw_refresh_2},
        )
        assert refresh_res_2.status_code == 200

    def test_multi_device_reuse_detection_revokes_all_sessions_across_all_families(self, test_db_setup):
        """
        Verify security invariant:
        Device A logs in (family A).
        Device B logs in (family B).
        Device A rotates token A1 -> token A2.
        Token A1 is replayed (reuse detected).
        Result: ALL active refresh tokens for the user across ALL families (including Device B)
        are revoked, token_version is incremented, and no device can refresh or use prior access tokens!
        """
        client = test_db_setup["client"]
        client.post(
            "/auth/register",
            json={"email": "multidevice@test.com", "full_name": "Multi", "password": "Password123!"},
        )

        # 1. Device A login (family A)
        login_a = client.post(
            "/auth/login",
            json={"email": "multidevice@test.com", "password": "Password123!", "token_transport": "body"},
        )
        token_a1 = login_a.json()["refresh_token"]
        jwt_a = login_a.json()["access_token"]

        # 2. Device B login (family B)
        login_b = client.post(
            "/auth/login",
            json={"email": "multidevice@test.com", "password": "Password123!", "token_transport": "body"},
        )
        token_b1 = login_b.json()["refresh_token"]
        jwt_b = login_b.json()["access_token"]

        # 3. Device A performs legitimate rotation A1 -> A2
        rot_a = client.post("/auth/refresh", json={"refresh_token": token_a1})
        assert rot_a.status_code == 200
        token_a2 = rot_a.json()["refresh_token"]

        # Prior to reuse, Device B is completely healthy and can rotate B1 -> B2
        rot_b = client.post("/auth/refresh", json={"refresh_token": token_b1})
        assert rot_b.status_code == 200
        token_b2 = rot_b.json()["refresh_token"]

        # 4. Attacker replays compromised token A1 (Reuse Event!)
        theft_res = client.post("/auth/refresh", json={"refresh_token": token_a1})
        assert theft_res.status_code == 401
        assert "compromised" in theft_res.json()["detail"].lower()

        # 5. Verify Device A's current token A2 is revoked
        res_a2 = client.post("/auth/refresh", json={"refresh_token": token_a2})
        assert res_a2.status_code == 401
        assert "compromised" in res_a2.json()["detail"].lower()

        # 6. CRUCIAL: Verify Device B's current token B2 in family B is ALSO REVOKED!
        res_b2 = client.post("/auth/refresh", json={"refresh_token": token_b2})
        assert res_b2.status_code == 401
        assert "compromised" in res_b2.json()["detail"].lower()

        # 7. CRUCIAL: Verify all prior access tokens from both devices fail authorization
        auth_check_a = client.get("/auth/me", headers={"Authorization": f"Bearer {jwt_a}"})
        assert auth_check_a.status_code == 401
        assert "session has been revoked" in auth_check_a.json()["detail"].lower()

        auth_check_b = client.get("/auth/me", headers={"Authorization": f"Bearer {jwt_b}"})
        assert auth_check_b.status_code == 401
        assert "session has been revoked" in auth_check_b.json()["detail"].lower()

    def test_expired_refresh_token_rejected(self, test_db_setup):
        client = test_db_setup["client"]
        std_factory = test_db_setup["std_factory"]

        raw_token = "expired-token-val"
        token_h = hash_refresh_token(raw_token)
        now = datetime.now(timezone.utc)
        past = now - timedelta(days=1)

        async def insert_expired():
            async with std_factory() as session:
                u = User(
                    id="u-exp", email="exp@test.com", password_hash="h",
                    full_name="E", role="user", is_active=1, token_version=1,
                    created_at=now, updated_at=now,
                )
                session.add(u)
                rec = RefreshToken(
                    id="rt-exp", user_id="u-exp", token_hash=token_h,
                    family_id="fam-exp", is_revoked=0, expires_at=past,
                    created_at=past,
                )
                session.add(rec)
                await session.commit()

        run_async(insert_expired())

        res = client.post("/auth/refresh", json={"refresh_token": raw_token})
        assert res.status_code == 401
        assert "expired" in res.json()["detail"].lower()

    def test_unknown_refresh_token_rejected(self, test_db_setup):
        client = test_db_setup["client"]
        res = client.post("/auth/refresh", json={"refresh_token": "non-existent-token"})
        assert res.status_code == 401
        assert "invalid or unknown" in res.json()["detail"].lower()


# ============================================================================
# 7. Current-Session vs Account-Wide Logout Tests
# ============================================================================
class TestLogoutSemantics:
    def test_current_session_logout_preserves_other_devices(self, test_db_setup):
        """
        Verify: Device A logs out of current session.
        Device B remains logged in, can still refresh, and access tokens remain valid.
        """
        client = test_db_setup["client"]
        client.post(
            "/auth/register",
            json={"email": "logout_iso@test.com", "full_name": "Iso", "password": "Password123!"},
        )

        # Device A
        login_a = client.post(
            "/auth/login",
            json={"email": "logout_iso@test.com", "password": "Password123!", "token_transport": "body"},
        )
        token_a = login_a.json()["refresh_token"]

        # Device B
        login_b = client.post(
            "/auth/login",
            json={"email": "logout_iso@test.com", "password": "Password123!", "token_transport": "body"},
        )
        token_b = login_b.json()["refresh_token"]
        jwt_b = login_b.json()["access_token"]

        # Device A logs out (current session)
        logout_res = client.post("/auth/logout", json={"refresh_token": token_a})
        assert logout_res.status_code == 200

        # Device B CAN STILL refresh!
        res_b = client.post("/auth/refresh", json={"refresh_token": token_b})
        assert res_b.status_code == 200
        new_token_b = res_b.json()["refresh_token"]

        # Device B access token remains valid
        me_res = client.get("/auth/me", headers={"Authorization": f"Bearer {jwt_b}"})
        assert me_res.status_code == 200

        # Device A cannot refresh with logged-out token (rejected with 401)
        res_a = client.post("/auth/refresh", json={"refresh_token": token_a})
        assert res_a.status_code == 401

    def test_account_wide_logout_revokes_all_device_sessions(self, test_db_setup):
        """
        Verify: Account-wide logout revokes all devices and increments token_version.
        """
        client = test_db_setup["client"]
        client.post(
            "/auth/register",
            json={"email": "logout_all@test.com", "full_name": "All", "password": "Password123!"},
        )

        # Device A
        login_a = client.post(
            "/auth/login",
            json={"email": "logout_all@test.com", "password": "Password123!", "token_transport": "body"},
        )
        token_a = login_a.json()["refresh_token"]
        jwt_a = login_a.json()["access_token"]

        # Device B
        login_b = client.post(
            "/auth/login",
            json={"email": "logout_all@test.com", "password": "Password123!", "token_transport": "body"},
        )
        token_b = login_b.json()["refresh_token"]
        jwt_b = login_b.json()["access_token"]

        # Device A invokes account-wide logout
        logout_all_res = client.post(
            "/auth/logout-all",
            headers={"Authorization": f"Bearer {jwt_a}"},
        )
        assert logout_all_res.status_code == 200
        assert "all sessions" in logout_all_res.json()["detail"].lower()

        # Both devices can no longer refresh
        assert client.post("/auth/refresh", json={"refresh_token": token_a}).status_code == 401
        assert client.post("/auth/refresh", json={"refresh_token": token_b}).status_code == 401

        # Existing access tokens from both devices are now invalid
        assert client.get("/auth/me", headers={"Authorization": f"Bearer {jwt_a}"}).status_code == 401
        assert client.get("/auth/me", headers={"Authorization": f"Bearer {jwt_b}"}).status_code == 401


# ============================================================================
# 8. Protected Profile & RBAC Tests
# ============================================================================
class TestProfileAndTokenVersion:
    def test_get_me_success(self, test_db_setup):
        client = test_db_setup["client"]
        client.post(
            "/auth/register",
            json={"email": "me@test.com", "full_name": "Me User", "password": "Password123!"},
        )
        login_res = client.post(
            "/auth/login",
            json={"email": "me@test.com", "password": "Password123!"},
        )
        token = login_res.json()["access_token"]

        res = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        assert res.json()["email"] == "me@test.com"
        assert res.json()["full_name"] == "Me User"

    def test_get_me_unauthenticated_returns_401(self, test_db_setup):
        client = test_db_setup["client"]
        res = client.get("/auth/me")
        assert res.status_code == 401

    def test_token_version_increment_revokes_active_access_tokens(self, test_db_setup):
        client = test_db_setup["client"]
        std_factory = test_db_setup["std_factory"]

        client.post(
            "/auth/register",
            json={"email": "revoked@test.com", "full_name": "Rev", "password": "Password123!"},
        )
        login_res = client.post(
            "/auth/login",
            json={"email": "revoked@test.com", "password": "Password123!"},
        )
        token = login_res.json()["access_token"]
        user_id = login_res.json()["user"]["id"]

        # Token initially works
        res1 = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert res1.status_code == 200

        # Increment token_version
        async def increment_version():
            async with std_factory() as session:
                u = await session.get(User, user_id)
                u.token_version += 1
                await session.commit()

        run_async(increment_version())

        # Old token MUST now be rejected with 401
        res2 = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert res2.status_code == 401
        assert "session has been revoked" in res2.json()["detail"].lower()


class TestRoleBasedAccessControl:
    @pytest.fixture(autouse=True)
    def register_test_endpoints(self):
        @app.get("/test/user-only")
        async def user_only_route(user: User = Depends(require_authenticated_user)):
            return {"status": "ok", "user": user.email}

        @app.get("/test/admin-only")
        async def admin_only_route(admin: User = Depends(require_admin)):
            return {"status": "ok", "admin": admin.email}

    def test_ordinary_user_rejected_from_admin_route(self, test_db_setup):
        client = test_db_setup["client"]
        client.post(
            "/auth/register",
            json={"email": "reguser@test.com", "full_name": "Reg", "password": "Password123!"},
        )
        login_res = client.post(
            "/auth/login",
            json={"email": "reguser@test.com", "password": "Password123!"},
        )
        user_token = login_res.json()["access_token"]

        res1 = client.get("/test/user-only", headers={"Authorization": f"Bearer {user_token}"})
        assert res1.status_code == 200

        res2 = client.get("/test/admin-only", headers={"Authorization": f"Bearer {user_token}"})
        assert res2.status_code == 403
        assert "admin privilege required" in res2.json()["detail"].lower()

    def test_admin_user_passes_admin_route(self, test_db_setup):
        client = test_db_setup["client"]
        std_factory = test_db_setup["std_factory"]
        now = datetime.now(timezone.utc)

        async def create_admin():
            async with std_factory() as session:
                admin = User(
                    id="admin-user-id",
                    email="admin@test.com",
                    password_hash=hash_password("AdminPass123!"),
                    full_name="Admin",
                    role="admin",
                    is_active=1,
                    token_version=1,
                    created_at=now,
                    updated_at=now,
                )
                session.add(admin)
                await session.commit()

        run_async(create_admin())

        login_res = client.post(
            "/auth/login",
            json={"email": "admin@test.com", "password": "AdminPass123!"},
        )
        admin_token = login_res.json()["access_token"]

        res = client.get("/test/admin-only", headers={"Authorization": f"Bearer {admin_token}"})
        assert res.status_code == 200
        assert res.json()["admin"] == "admin@test.com"


# ============================================================================
# 9. Administrator Safeguards & Last-Admin Protection Tests
# ============================================================================
class TestAdminSafeguards:
    def test_sole_admin_cannot_be_demoted_or_suspended(self, test_db_setup):
        crit_factory = test_db_setup["crit_factory"]
        now = datetime.now(timezone.utc)
        admin_id = "sole-admin"

        async def setup_sole_admin():
            async with crit_factory() as session:
                async with session.begin():
                    admin = User(
                        id=admin_id,
                        email="soleadmin@test.com",
                        password_hash="hash",
                        full_name="Sole Admin",
                        role="admin",
                        is_active=1,
                        token_version=1,
                        created_at=now,
                        updated_at=now,
                    )
                    session.add(admin)

        run_async(setup_sole_admin())

        # Attempt to demote sole admin -> MUST FAIL
        async def attempt_demote():
            async with crit_factory() as session:
                async with session.begin():
                    await demote_or_suspend_admin(
                        admin_id=admin_id,
                        new_role="user",
                        custom_session=session,
                    )

        with pytest.raises(HTTPException) as exc:
            run_async(attempt_demote())
        assert exc.value.status_code == 400
        assert "sole remaining active administrator" in exc.value.detail

        # Attempt to suspend sole admin -> MUST FAIL
        async def attempt_suspend():
            async with crit_factory() as session:
                async with session.begin():
                    await demote_or_suspend_admin(
                        admin_id=admin_id,
                        new_is_active=0,
                        custom_session=session,
                    )

        with pytest.raises(HTTPException) as exc:
            run_async(attempt_suspend())
        assert exc.value.status_code == 400
        assert "sole remaining active administrator" in exc.value.detail

    def test_admin_demotion_allowed_when_multiple_admins_exist(self, test_db_setup):
        crit_factory = test_db_setup["crit_factory"]
        now = datetime.now(timezone.utc)
        a1_id = "admin-1"
        a2_id = "admin-2"

        async def setup_two_admins():
            async with crit_factory() as session:
                async with session.begin():
                    a1 = User(id=a1_id, email="a1@test.com", password_hash="h", full_name="A1", role="admin", is_active=1, token_version=1, created_at=now, updated_at=now)
                    a2 = User(id=a2_id, email="a2@test.com", password_hash="h", full_name="A2", role="admin", is_active=1, token_version=1, created_at=now, updated_at=now)
                    session.add_all([a1, a2])

        run_async(setup_two_admins())

        async def demote_a1():
            async with crit_factory() as session:
                async with session.begin():
                    return await demote_or_suspend_admin(
                        admin_id=a1_id,
                        new_role="user",
                        custom_session=session,
                    )

        updated_a1 = run_async(demote_a1())
        assert updated_a1.role == "user"

        async def demote_a2():
            async with crit_factory() as session:
                async with session.begin():
                    await demote_or_suspend_admin(
                        admin_id=a2_id,
                        new_role="user",
                        custom_session=session,
                    )

        with pytest.raises(HTTPException) as exc:
            run_async(demote_a2())
        assert exc.value.status_code == 400
        assert "sole remaining active administrator" in exc.value.detail

    def test_concurrent_last_admin_demotion_race_leaves_exactly_one_admin(self, test_db_setup):
        crit_factory = test_db_setup["crit_factory"]
        now = datetime.now(timezone.utc)
        a1_id = "race-admin-1"
        a2_id = "race-admin-2"

        async def setup_race_admins():
            async with crit_factory() as session:
                async with session.begin():
                    a1 = User(id=a1_id, email="race1@test.com", password_hash="h", full_name="R1", role="admin", is_active=1, token_version=1, created_at=now, updated_at=now)
                    a2 = User(id=a2_id, email="race2@test.com", password_hash="h", full_name="R2", role="admin", is_active=1, token_version=1, created_at=now, updated_at=now)
                    session.add_all([a1, a2])

        run_async(setup_race_admins())

        results = []

        async def demote_worker(target_id: str):
            try:
                async with crit_factory() as session:
                    async with session.begin():
                        await demote_or_suspend_admin(
                            admin_id=target_id,
                            new_role="user",
                            custom_session=session,
                        )
                results.append("success")
            except HTTPException as e:
                results.append(f"rejected_{e.status_code}")

        async def run_race():
            await asyncio.gather(demote_worker(a1_id), demote_worker(a2_id))

        run_async(run_race())

        assert "success" in results
        assert "rejected_400" in results

        async def verify_count():
            async with crit_factory() as session:
                return await session.scalar(
                    select(func.count(User.id)).where(User.role == "admin", User.is_active == 1)
                )

        final_count = run_async(verify_count())
        assert final_count == 1


# ============================================================================
# 10. Admin CLI & Security Configuration Tests
# ============================================================================
class TestAdminCLIAndSecurityConfig:
    def test_admin_cli_creates_admin_with_full_name(self, test_db_setup, monkeypatch):
        from backend.auth.admin_cli import create_admin_account

        admin_email = f"cli-admin-{uuid.uuid4().hex[:6]}@test.com"
        admin_name = "Master Administrator"
        admin_pass = "StrongAdminPass123!"

        monkeypatch.setattr("backend.auth.admin_cli.async_session_factory", test_db_setup["std_factory"])

        # Run non-interactive / flagged execution
        code = run_async(create_admin_account(
            email=admin_email,
            full_name=admin_name,
            password=admin_pass,
        ))
        assert code == 0

        # Verify DB record
        std_factory = test_db_setup["std_factory"]
        async def verify_admin():
            async with std_factory() as session:
                stmt = select(User).where(User.email == admin_email)
                user = (await session.execute(stmt)).scalar_one_or_none()
                assert user is not None
                assert user.full_name == admin_name
                assert user.role == "admin"
                assert user.is_active == 1
                assert verify_password(admin_pass, user.password_hash) is True

        run_async(verify_admin())

    def test_cookie_and_origin_security_configuration(self):
        # Validate origin parser
        assert is_origin_allowed("http://localhost:5173") is True
        assert is_origin_allowed("http://127.0.0.1:5173") is True
        assert is_origin_allowed("http://malicious-site.com") is False
        assert is_origin_allowed("") is False

        # Validate Cookie Path and SameSite
        assert COOKIE_PATH == "/"
        assert COOKIE_SAMESITE in ("lax", "strict")

        # Validate token generation
        t1 = generate_csrf_token()
        t2 = generate_csrf_token()
        assert len(t1) >= 32
        assert t1 != t2

    def test_change_password_and_session_invalidation(self, test_db_setup):
        client = test_db_setup["client"]
        email = "pwdchange@example.com"
        old_pass = "OldPassword123!"
        new_pass = "NewPassword456!"

        res = client.post("/auth/register", json={
            "email": email,
            "full_name": "Pwd User",
            "password": old_pass,
        })
        assert res.status_code == 201

        login_res = client.post("/auth/login", json={
            "email": email,
            "password": old_pass,
            "token_transport": "body",
        })
        assert login_res.status_code == 200
        old_access = login_res.json()["access_token"]
        old_refresh = login_res.json()["refresh_token"]

        # Wrong current password -> 401
        bad_res = client.put(
            "/auth/password",
            headers={"Authorization": f"Bearer {old_access}"},
            json={"current_password": "WrongPassword1!", "new_password": new_pass},
        )
        assert bad_res.status_code == 401

        # Same password -> 400
        same_res = client.put(
            "/auth/password",
            headers={"Authorization": f"Bearer {old_access}"},
            json={"current_password": old_pass, "new_password": old_pass},
        )
        assert same_res.status_code == 400

        # Valid change -> 200 and revokes old access/refresh tokens
        ok_res = client.put(
            "/auth/password",
            headers={"Authorization": f"Bearer {old_access}"},
            json={"current_password": old_pass, "new_password": new_pass},
        )
        assert ok_res.status_code == 200

        assert client.get("/auth/me", headers={"Authorization": f"Bearer {old_access}"}).status_code == 401
        assert client.post("/auth/refresh", json={"refresh_token": old_refresh}).status_code == 401

        # Old password rejected, new password succeeds
        assert client.post("/auth/login", json={"email": email, "password": old_pass}).status_code == 401
        new_login = client.post("/auth/login", json={"email": email, "password": new_pass, "token_transport": "body"})
        assert new_login.status_code == 200

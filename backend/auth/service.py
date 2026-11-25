from datetime import datetime, timedelta, timezone
import hashlib
import logging
import secrets
from typing import Optional
import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.config import REFRESH_TOKEN_EXPIRE_DAYS
from backend.auth.jwt import create_access_token
from backend.auth.security import hash_password, verify_password
from backend.database.models import RefreshToken, User
from backend.database.session import critical_session_factory

logger = logging.getLogger("itms.auth.service")


def generate_raw_refresh_token() -> str:
    """Generate high-entropy cryptographically secure opaque refresh token."""
    return secrets.token_urlsafe(32)


def hash_refresh_token(raw_token: str) -> str:
    """Compute SHA-256 hash of refresh token secret."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


async def create_user_account(
    session: AsyncSession,
    email: str,
    full_name: str,
    password: str,
    role: str = "user",
    is_active: int = 1,
) -> User:
    """
    Register a new user account.
    Normalizes email, verifies uniqueness, and hashes password with Argon2id.
    """
    normalized_email = email.strip().lower()

    # Check for existing email
    stmt = select(User).where(User.email == normalized_email)
    existing = (await session.execute(stmt)).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is already registered.",
        )

    # Force role safety: public registration always user
    assigned_role = "admin" if role == "admin" else "user"

    now = datetime.now(timezone.utc)
    hashed_pwd = hash_password(password)

    user = User(
        id=uuid.uuid4().hex,
        email=normalized_email,
        password_hash=hashed_pwd,
        full_name=full_name.strip(),
        role=assigned_role,
        is_active=is_active,
        token_version=1,
        created_at=now,
        updated_at=now,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def authenticate_user_credentials(
    session: AsyncSession,
    email: str,
    password: str,
) -> User:
    """
    Authenticate user by email and password.
    Returns User if valid, raises HTTPException otherwise.
    Does not leak whether email exists.
    """
    normalized_email = email.strip().lower()
    stmt = select(User).where(User.email == normalized_email)
    user = (await session.execute(stmt)).scalar_one_or_none()

    if not user:
        # Dummy verification to mitigate timing discrepancy
        verify_password("dummy_password", "$argon2id$v=19$m=65536,t=3,p=4$dummy$dummy")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.is_active == 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive or suspended.",
        )

    return user


async def create_refresh_token_session(
    session: AsyncSession,
    user_id: str,
    family_id: str | None = None,
) -> tuple[str, RefreshToken]:
    """Issue a new refresh token belonging to a token family."""
    raw_token = generate_raw_refresh_token()
    token_hash = hash_refresh_token(raw_token)
    fam_id = family_id or uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    record = RefreshToken(
        id=uuid.uuid4().hex,
        user_id=user_id,
        token_hash=token_hash,
        family_id=fam_id,
        is_revoked=0,
        expires_at=expires_at,
        created_at=now,
    )
    session.add(record)
    return raw_token, record


async def rotate_refresh_token_with_reuse_detection(
    raw_token: str,
    session: AsyncSession,
) -> tuple[str, str, User]:
    """
    Atomically rotate refresh token and issue a fresh access token.
    Detects reuse of previously rotated/revoked tokens.
    
    Security Contract on Reuse:
    - If a revoked token is presented, this indicates token theft or replay.
    - All active refresh tokens belonging to the user across ALL families are immediately revoked.
    - The user's token_version is incremented in the same critical write transaction.
    - The request is rejected with HTTP 401.
    
    Returns: (new_raw_refresh_token, new_access_token, user)
    """
    if not raw_token or not raw_token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token_hash = hash_refresh_token(raw_token.strip())

    # Find the token record
    stmt = select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    token_record = (await session.execute(stmt)).scalar_one_or_none()

    if not token_record:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or unknown refresh token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 1. Reuse / Theft Detection: token is already revoked!
    if token_record.is_revoked == 1:
        logger.warning(
            "COMPROMISED REFRESH TOKEN DETECTED! Revoking ALL sessions for user %s across all families",
            token_record.user_id,
        )
        # Atomically revoke ALL active refresh tokens for this user across all families
        revoke_all_user_tokens_stmt = (
            update(RefreshToken)
            .where(
                RefreshToken.user_id == token_record.user_id,
                RefreshToken.is_revoked == 0,
            )
            .values(is_revoked=1)
        )
        await session.execute(revoke_all_user_tokens_stmt)

        # Invalidate all active access tokens by bumping token_version
        user = await session.get(User, token_record.user_id)
        if user:
            user.token_version += 1
            user.updated_at = datetime.now(timezone.utc)

        await session.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Compromised refresh token detected: All sessions have been revoked.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 2. Check Expiration
    now = datetime.now(timezone.utc)
    expires_at = token_record.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at < now:
        token_record.is_revoked = 1
        await session.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has expired.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 3. Check User Account Status
    user = await session.get(User, token_record.user_id)
    if not user or user.is_active == 0:
        token_record.is_revoked = 1
        await session.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive or suspended.",
        )

    # 4. Atomic Rotation
    token_record.is_revoked = 1

    # Issue replacement in same family
    new_raw_token, _ = await create_refresh_token_session(
        session, user.id, family_id=token_record.family_id
    )

    # Issue fresh access token
    new_access_token = create_access_token(user.id, user.role, user.token_version)

    await session.commit()
    return new_raw_token, new_access_token, user


async def logout_current_session(
    session: AsyncSession,
    raw_token: str,
) -> bool:
    """
    Revoke the current refresh-token family (current session logout).
    Does NOT increment token_version and does NOT invalidate other device families.
    """
    if not raw_token or not raw_token.strip():
        return False
    token_hash = hash_refresh_token(raw_token.strip())
    stmt = select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    record = (await session.execute(stmt)).scalar_one_or_none()
    if record and record.is_revoked == 0:
        # Revoke all active tokens in this family
        revoke_family_stmt = (
            update(RefreshToken)
            .where(
                RefreshToken.family_id == record.family_id,
                RefreshToken.is_revoked == 0,
            )
            .values(is_revoked=1)
        )
        await session.execute(revoke_family_stmt)
        await session.commit()
        return True
    return False


async def logout_all_sessions(
    session: AsyncSession,
    user_id: str,
) -> None:
    """
    Account-wide logout: revokes all refresh-token families for user and increments token_version.
    Immediately invalidates all existing access tokens and refresh tokens.
    """
    # Revoke all active refresh tokens for the user
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.is_revoked == 0)
        .values(is_revoked=1)
    )
    user = await session.get(User, user_id)
    if user:
        user.token_version += 1
        user.updated_at = datetime.now(timezone.utc)
    await session.commit()


async def demote_or_suspend_admin(
    admin_id: str,
    new_role: str | None = None,
    new_is_active: int | None = None,
    custom_session: AsyncSession | None = None,
) -> User:
    """
    Safely update an administrator's role or active status with last-active-admin concurrency protection.
    Uses BEGIN IMMEDIATE via critical_session_factory to guarantee active_count >= 1.
    """
    async def _execute_logic(session: AsyncSession) -> User:
        user = await session.get(User, admin_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found.",
            )

        # Count active admins within write lock reservation
        active_admin_count = await session.scalar(
            select(func.count(User.id)).where(User.role == "admin", User.is_active == 1)
        )

        is_currently_active_admin = (user.role == "admin" and user.is_active == 1)
        will_demote = (new_role is not None and new_role != "admin")
        will_suspend = (new_is_active is not None and new_is_active != 1)

        if is_currently_active_admin and (will_demote or will_suspend) and active_admin_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Operation rejected: Cannot demote or suspend the sole remaining active administrator.",
            )

        if new_role is not None:
            user.role = new_role
        if new_is_active is not None:
            user.is_active = new_is_active

        user.token_version += 1
        user.updated_at = datetime.now(timezone.utc)
        if not session.in_transaction():
            await session.commit()
        else:
            await session.flush()
        await session.refresh(user)
        return user

    if custom_session is not None:
        return await _execute_logic(custom_session)

    async with critical_session_factory() as session:
        async with session.begin():
            return await _execute_logic(session)

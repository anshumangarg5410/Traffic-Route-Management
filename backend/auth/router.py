from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.config import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    COOKIE_DOMAIN,
    COOKIE_NAME,
    COOKIE_PATH,
    COOKIE_SAMESITE,
    COOKIE_SECURE,
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME,
    REFRESH_TOKEN_EXPIRE_DAYS,
)
from backend.auth.csrf import generate_csrf_token, validate_csrf
from backend.auth.dependencies import get_current_user, get_optional_current_user
from backend.auth.jwt import create_access_token
from backend.auth.schemas import (
    LoginRequest,
    MessageResponse,
    PasswordChangeRequest,
    ProfileUpdateRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from backend.auth.service import (
    authenticate_user_credentials,
    change_user_password,
    create_refresh_token_session,
    create_user_account,
    hash_refresh_token,
    logout_all_sessions,
    logout_current_session,
    rotate_refresh_token_with_reuse_detection,
)
from backend.database.models import RefreshToken, User
from backend.database.session import get_critical_db, get_db

auth_router = APIRouter()


def _set_auth_cookies(response: Response, raw_refresh_token: str, csrf_token: str) -> None:
    """Set secure HttpOnly refresh token cookie and client-readable CSRF token cookie."""
    # 1. HttpOnly Refresh Token Cookie
    response.set_cookie(
        key=COOKIE_NAME,
        value=raw_refresh_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path=COOKIE_PATH,
        domain=COOKIE_DOMAIN,
    )
    # 2. Client-Readable CSRF Token Cookie (Double-Submit Pattern)
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=csrf_token,
        httponly=False,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path=COOKIE_PATH,
        domain=COOKIE_DOMAIN,
    )


def _clear_auth_cookies(response: Response) -> None:
    """Clear both refresh token and CSRF token cookies with identical scope parameters."""
    response.delete_cookie(
        key=COOKIE_NAME,
        path=COOKIE_PATH,
        domain=COOKIE_DOMAIN,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
    )
    response.delete_cookie(
        key=CSRF_COOKIE_NAME,
        path=COOKIE_PATH,
        domain=COOKIE_DOMAIN,
        httponly=False,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
    )


@auth_router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register new user account",
)
async def register(
    req: RegisterRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserResponse:
    """
    Register a standard user account.
    Validates email format, verifies uniqueness, and hashes password using Argon2id.
    Role is strictly defaulted to 'user'.
    """
    user = await create_user_account(
        session=db,
        email=req.email,
        full_name=req.full_name,
        password=req.password,
        role="user",
    )
    return UserResponse.model_validate(user)


@auth_router.post(
    "/login",
    response_model=TokenResponse,
    summary="Authenticate credentials and issue tokens",
)
async def login(
    req: LoginRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TokenResponse:
    """
    Authenticate user by email and password.
    
    Transport Behavior:
    - Browser flow (default, token_transport="cookie"): Sets HttpOnly refresh token cookie
      and readable CSRF cookie. Refresh token is omitted (None) from response JSON.
    - Mobile/CLI flow (token_transport="body" or X-Token-Transport: body header):
      Returns refresh token in response JSON and sets NO cookies.
    """
    user = await authenticate_user_credentials(
        session=db,
        email=req.email,
        password=req.password,
    )

    # Issue initial refresh token in new family
    raw_refresh_token, _ = await create_refresh_token_session(db, user.id)
    await db.commit()

    # Issue access token
    access_token = create_access_token(user.id, user.role, user.token_version)

    wants_body = (
        req.token_transport == "body"
        or request.headers.get("X-Token-Transport", "").strip().lower() == "body"
    )

    if wants_body:
        # Mobile / CLI flow: raw token in JSON body, zero cookies
        return TokenResponse(
            access_token=access_token,
            token_type="bearer",
            expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            refresh_token=raw_refresh_token,
            csrf_token=None,
            user=UserResponse.model_validate(user),
        )

    # Browser cookie flow: HttpOnly cookie + CSRF cookie, NO refresh token in JSON
    csrf_token = generate_csrf_token()
    _set_auth_cookies(response, raw_refresh_token, csrf_token)

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        refresh_token=None,
        csrf_token=csrf_token,
        user=UserResponse.model_validate(user),
    )


@auth_router.post(
    "/refresh",
    response_model=TokenResponse,
    summary="Rotate refresh token and issue fresh access token",
)
async def refresh_token(
    request: Request,
    response: Response,
    req_body: RefreshRequest | None = None,
    cookie_token: Annotated[str | None, Cookie(alias=COOKIE_NAME)] = None,
    cookie_csrf: Annotated[str | None, Cookie(alias=CSRF_COOKIE_NAME)] = None,
    crit_db: Annotated[AsyncSession, Depends(get_critical_db)] = None,
) -> TokenResponse:
    """
    Atomically rotate refresh token.
    
    Transport Isolation:
    - Rejects ambiguous requests combining cookie and body refresh tokens with HTTP 400.
    - If body transport requested via header but token missing from body, rejects with HTTP 400 (no silent fallback).
    - Browser cookie flow strictly enforces CSRF checks (Origin/Referer whitelist + HMAC signed CSRF token).
    """
    has_body_token = bool(req_body and req_body.refresh_token and req_body.refresh_token.strip())
    raw_cookie_token = cookie_token or request.cookies.get(COOKIE_NAME)
    has_cookie_token = bool(raw_cookie_token and raw_cookie_token.strip())
    is_body_mode_header = (request.headers.get("X-Token-Transport", "").strip().lower() == "body")

    # 1. Transport Ambiguity Protection: cannot combine cookie and body token
    if has_body_token and has_cookie_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ambiguous transport: cannot combine cookie and body token authentication.",
        )

    # 2. Body transport mode declared via header: no silent fallback to cookie
    if is_body_mode_header:
        if not has_body_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Body transport requested but no refresh token provided in request body.",
            )
        raw_token = req_body.refresh_token.strip()
        new_raw_refresh, new_access_token, user = (
            await rotate_refresh_token_with_reuse_detection(
                raw_token=raw_token,
                session=crit_db,
            )
        )
        return TokenResponse(
            access_token=new_access_token,
            token_type="bearer",
            expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            refresh_token=new_raw_refresh,
            csrf_token=None,
            user=UserResponse.model_validate(user),
        )

    # 3. Mobile / CLI Flow (Body-based token)
    if has_body_token:
        raw_token = req_body.refresh_token.strip()
        new_raw_refresh, new_access_token, user = (
            await rotate_refresh_token_with_reuse_detection(
                raw_token=raw_token,
                session=crit_db,
            )
        )
        return TokenResponse(
            access_token=new_access_token,
            token_type="bearer",
            expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            refresh_token=new_raw_refresh,
            csrf_token=None,
            user=UserResponse.model_validate(user),
        )

    # 4. Browser Cookie Flow
    if has_cookie_token:
        raw_token = raw_cookie_token.strip()

        # Enforce CSRF protection for cookie-authenticated request
        header_csrf = request.headers.get(CSRF_HEADER_NAME) or request.headers.get("x-csrf-token")
        raw_cookie_csrf = cookie_csrf or request.cookies.get(CSRF_COOKIE_NAME)
        validate_csrf(request, raw_cookie_csrf, header_csrf)

        # Rotate token
        new_raw_refresh, new_access_token, user = (
            await rotate_refresh_token_with_reuse_detection(
                raw_token=raw_token,
                session=crit_db,
            )
        )

        # Rotate CSRF cookie alongside refresh cookie
        new_csrf = generate_csrf_token()
        _set_auth_cookies(response, new_raw_refresh, new_csrf)

        return TokenResponse(
            access_token=new_access_token,
            token_type="bearer",
            expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            refresh_token=None,
            csrf_token=new_csrf,
            user=UserResponse.model_validate(user),
        )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Refresh token is required.",
        headers={"WWW-Authenticate": "Bearer"},
    )


@auth_router.post(
    "/logout",
    response_model=MessageResponse,
    summary="Revoke current session and clear refresh token",
)
async def logout(
    request: Request,
    response: Response,
    req_body: RefreshRequest | None = None,
    cookie_token: Annotated[str | None, Cookie(alias=COOKIE_NAME)] = None,
    cookie_csrf: Annotated[str | None, Cookie(alias=CSRF_COOKIE_NAME)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
) -> MessageResponse:
    """
    Current-session logout: revokes only the presented refresh-token family.
    Does NOT revoke other active device sessions.
    """
    has_body_token = bool(req_body and req_body.refresh_token and req_body.refresh_token.strip())
    raw_cookie_token = cookie_token or request.cookies.get(COOKIE_NAME)
    has_cookie_token = bool(raw_cookie_token and raw_cookie_token.strip())

    if has_body_token and has_cookie_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ambiguous transport: cannot combine cookie and body tokens.",
        )

    if has_cookie_token:
        header_csrf = request.headers.get(CSRF_HEADER_NAME) or request.headers.get("x-csrf-token")
        raw_cookie_csrf = cookie_csrf or request.cookies.get(CSRF_COOKIE_NAME)
        validate_csrf(request, raw_cookie_csrf, header_csrf)
        if db:
            await logout_current_session(db, raw_cookie_token.strip())
        _clear_auth_cookies(response)
        return MessageResponse(detail="Successfully logged out of current session.")

    if has_body_token:
        if db:
            await logout_current_session(db, req_body.refresh_token.strip())
        return MessageResponse(detail="Successfully logged out of current session.")

    _clear_auth_cookies(response)
    return MessageResponse(detail="Successfully logged out of current session.")


@auth_router.post(
    "/logout-all",
    response_model=MessageResponse,
    summary="Revoke all sessions across all devices for the account",
)
async def logout_all(
    request: Request,
    response: Response,
    req_body: RefreshRequest | None = None,
    cookie_token: Annotated[str | None, Cookie(alias=COOKIE_NAME)] = None,
    cookie_csrf: Annotated[str | None, Cookie(alias=CSRF_COOKIE_NAME)] = None,
    current_user: Annotated[User | None, Depends(get_optional_current_user)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
) -> MessageResponse:
    """
    Account-wide logout: revokes every refresh token family belonging to the user
    and increments user.token_version, invalidating all existing access tokens.
    """
    has_body_token = bool(req_body and req_body.refresh_token and req_body.refresh_token.strip())
    raw_cookie_token = cookie_token or request.cookies.get(COOKIE_NAME)
    has_cookie_token = bool(raw_cookie_token and raw_cookie_token.strip())

    if has_body_token and has_cookie_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ambiguous transport: cannot combine cookie and body tokens.",
        )

    user_id = None

    if current_user:
        user_id = current_user.id
    elif has_cookie_token:
        header_csrf = request.headers.get(CSRF_HEADER_NAME) or request.headers.get("x-csrf-token")
        raw_cookie_csrf = cookie_csrf or request.cookies.get(CSRF_COOKIE_NAME)
        validate_csrf(request, raw_cookie_csrf, header_csrf)

        token_hash = hash_refresh_token(raw_cookie_token.strip())
        stmt = select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        token_rec = (await db.execute(stmt)).scalar_one_or_none()
        if token_rec:
            user_id = token_rec.user_id
    elif has_body_token:
        token_hash = hash_refresh_token(req_body.refresh_token.strip())
        stmt = select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        token_rec = (await db.execute(stmt)).scalar_one_or_none()
        if token_rec:
            user_id = token_rec.user_id

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required to perform account-wide logout.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    await logout_all_sessions(db, user_id)
    if has_cookie_token or current_user:
        _clear_auth_cookies(response)
    return MessageResponse(detail="Successfully logged out of all sessions.")


@auth_router.get(
    "/me",
    response_model=UserResponse,
    summary="Get current authenticated user profile",
)
async def get_me(
    current_user: Annotated[User, Depends(get_current_user)],
) -> UserResponse:
    """Return the profile of the currently authenticated user."""
    return UserResponse.model_validate(current_user)


@auth_router.put(
    "/me",
    response_model=UserResponse,
    summary="Update profile details for current authenticated user",
)
async def update_profile(
    req: ProfileUpdateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserResponse:
    """Update editable profile fields (full_name) for authenticated user."""
    from datetime import datetime, timezone
    current_user.full_name = req.full_name
    current_user.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(current_user)
    return UserResponse.model_validate(current_user)


@auth_router.put(
    "/password",
    response_model=MessageResponse,
    summary="Change password for current authenticated user",
)
async def change_password(
    req: PasswordChangeRequest,
    response: Response,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MessageResponse:
    """Verify current password, update password, and revoke existing sessions."""
    await change_user_password(
        session=db,
        user=current_user,
        current_password=req.current_password,
        new_password=req.new_password,
    )
    _clear_auth_cookies(response)
    return MessageResponse(detail="Password updated successfully. Please sign in again.")

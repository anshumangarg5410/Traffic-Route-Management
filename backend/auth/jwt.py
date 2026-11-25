from datetime import datetime, timedelta, timezone
from typing import Any
import uuid

import jwt

from backend.auth.config import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    JWT_ALGORITHM,
    JWT_SECRET_KEY,
)


class TokenError(Exception):
    """Base exception for JWT validation errors."""
    pass


class TokenExpiredError(TokenError):
    """Token has expired."""
    pass


class InvalidTokenError(TokenError):
    """Token is invalid, malformed, or signature verification failed."""
    pass


def create_access_token(
    user_id: str,
    role: str,
    token_version: int,
    expires_delta: timedelta | None = None,
) -> str:
    """Generate signed JWT access token with mandatory security claims."""
    now = datetime.now(timezone.utc)
    duration = expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    expire_at = now + duration

    payload: dict[str, Any] = {
        "sub": str(user_id),
        "role": str(role),
        "token_version": int(token_version),
        "iat": int(now.timestamp()),
        "exp": int(expire_at.timestamp()),
        "jti": uuid.uuid4().hex,
    }

    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """
    Validate and decode JWT access token.
    Enforces signature, expiration, algorithm, and mandatory claims.
    """
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM],
            options={
                "require": ["sub", "role", "iat", "exp", "jti", "token_version"],
                "verify_exp": True,
                "verify_iat": True,
            },
        )
    except jwt.ExpiredSignatureError as e:
        raise TokenExpiredError("Access token has expired.") from e
    except jwt.PyJWTError as e:
        raise InvalidTokenError(f"Invalid access token: {str(e)}") from e

    # Validate claim types and semantics
    if not isinstance(payload.get("sub"), str) or not payload["sub"].strip():
        raise InvalidTokenError("Missing or invalid 'sub' claim in token.")
    if payload.get("role") not in ("user", "admin"):
        raise InvalidTokenError("Invalid 'role' claim in token.")
    if not isinstance(payload.get("token_version"), int) or payload["token_version"] < 1:
        raise InvalidTokenError("Invalid 'token_version' claim in token.")

    return payload

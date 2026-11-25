from backend.auth.csrf import generate_csrf_token, validate_csrf
from backend.auth.dependencies import (
    get_current_user,
    get_optional_current_user,
    require_admin,
    require_authenticated_user,
    require_role,
)
from backend.auth.jwt import (
    create_access_token,
    decode_access_token,
)
from backend.auth.router import auth_router
from backend.auth.schemas import (
    LoginRequest,
    MessageResponse,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from backend.auth.security import (
    hash_password,
    needs_rehash,
    validate_password_strength,
    verify_password,
)
from backend.auth.service import (
    authenticate_user_credentials,
    create_user_account,
    demote_or_suspend_admin,
    logout_all_sessions,
    logout_current_session,
    rotate_refresh_token_with_reuse_detection,
)

__all__ = [
    "auth_router",
    "get_current_user",
    "get_optional_current_user",
    "require_authenticated_user",
    "require_admin",
    "require_role",
    "hash_password",
    "verify_password",
    "needs_rehash",
    "validate_password_strength",
    "create_access_token",
    "decode_access_token",
    "create_user_account",
    "authenticate_user_credentials",
    "rotate_refresh_token_with_reuse_detection",
    "logout_current_session",
    "logout_all_sessions",
    "demote_or_suspend_admin",
    "validate_csrf",
    "generate_csrf_token",
    "RegisterRequest",
    "LoginRequest",
    "RefreshRequest",
    "TokenResponse",
    "UserResponse",
    "MessageResponse",
]

import logging
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

logger = logging.getLogger("itms.auth.security")

# Initialized with RFC 9106 recommended Argon2id parameters
_hasher = PasswordHasher(
    time_cost=3,
    memory_cost=65536,  # 64 MiB
    parallelism=4,
    hash_len=32,
    salt_len=16,
)


def validate_password_strength(password: str) -> None:
    """Validate password length and character constraints."""
    if not isinstance(password, str):
        raise ValueError("Password must be a string.")
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters long.")
    if len(password) > 128:
        raise ValueError("Password cannot exceed 128 characters.")
    if not password.strip():
        raise ValueError("Password cannot be empty or whitespace-only.")


def hash_password(password: str) -> str:
    """Hash password using Argon2id."""
    validate_password_strength(password)
    return _hasher.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify plain password against stored Argon2id hash.
    Returns True if valid, False otherwise without leaking timing information.
    """
    if not plain_password or not hashed_password:
        return False
    try:
        return _hasher.verify(hashed_password, plain_password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    except Exception as e:
        logger.error("Unexpected error during password verification: %s", type(e).__name__)
        return False


def needs_rehash(hashed_password: str) -> bool:
    """Check if password hash requires parameter upgrade."""
    try:
        return _hasher.check_needs_rehash(hashed_password)
    except Exception:
        return False

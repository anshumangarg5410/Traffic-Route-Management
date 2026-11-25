import logging
import os

logger = logging.getLogger("itms.auth.config")

ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()

# JWT Secret & Algorithm
_DEFAULT_DEV_SECRET = "itms-development-secret-key-do-not-use-in-production-min-32-chars-long"
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")

if not JWT_SECRET_KEY:
    if ENVIRONMENT in ("production", "staging"):
        raise RuntimeError(
            "CRITICAL: JWT_SECRET_KEY must be explicitly configured in production/staging environment."
        )
    logger.warning(
        "JWT_SECRET_KEY not set. Using insecure development default key. Do NOT use in production!"
    )
    JWT_SECRET_KEY = _DEFAULT_DEV_SECRET
elif len(JWT_SECRET_KEY) < 32:
    if ENVIRONMENT in ("production", "staging"):
        raise RuntimeError(
            "CRITICAL: JWT_SECRET_KEY in production/staging must be at least 32 characters long."
        )
    logger.warning("JWT_SECRET_KEY is shorter than 32 characters. Consider using a stronger key.")

JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

# Token Lifetimes
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

# Cookie Security Settings
COOKIE_NAME = os.getenv("COOKIE_NAME", "itms_refresh_token")
CSRF_COOKIE_NAME = os.getenv("CSRF_COOKIE_NAME", "itms_csrf_token")
CSRF_HEADER_NAME = os.getenv("CSRF_HEADER_NAME", "X-CSRF-Token")

COOKIE_PATH = os.getenv("COOKIE_PATH", "/")
COOKIE_DOMAIN = os.getenv("COOKIE_DOMAIN", None)

# In production and staging, Secure must ALWAYS be True
if ENVIRONMENT in ("production", "staging"):
    COOKIE_SECURE = True
else:
    _cookie_secure_env = os.getenv("COOKIE_SECURE")
    if _cookie_secure_env is not None:
        COOKIE_SECURE = _cookie_secure_env.lower() in ("true", "1", "yes")
    else:
        COOKIE_SECURE = False

COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "lax").lower()
if COOKIE_SAMESITE not in ("lax", "strict", "none"):
    COOKIE_SAMESITE = "lax"

# Allowed CORS / CSRF Origins
_raw_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

import hashlib
import hmac
import logging
import secrets
from urllib.parse import urlparse

from fastapi import HTTPException, Request, status

from backend.auth.config import ALLOWED_ORIGINS, CSRF_COOKIE_NAME, JWT_SECRET_KEY

logger = logging.getLogger("itms.auth.csrf")


def _sign_nonce(nonce: str) -> str:
    """Generate HMAC-SHA256 signature for a CSRF nonce using the application secret."""
    return hmac.new(
        JWT_SECRET_KEY.encode("utf-8"),
        nonce.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def generate_csrf_token() -> str:
    """
    Generate cryptographically secure HMAC-signed CSRF token.
    Structure: <nonce>.<signature>
    Prevents cookie tossing/injection attacks by guaranteeing server authenticity.
    """
    nonce = secrets.token_urlsafe(32)
    sig = _sign_nonce(nonce)
    return f"{nonce}.{sig}"


def verify_csrf_token_signature(token: str) -> bool:
    """Verify that a CSRF token carries a valid HMAC signature created by this server."""
    if not token or "." not in token:
        return False
    parts = token.split(".", 1)
    if len(parts) != 2:
        return False
    nonce, sig = parts
    expected_sig = _sign_nonce(nonce)
    return secrets.compare_digest(sig, expected_sig)


def is_origin_allowed(origin: str) -> bool:
    """Check if an Origin or Referer base matches the configured allowed origins."""
    if not origin:
        return False
    parsed_origin = urlparse(origin.strip().lower())
    origin_base = f"{parsed_origin.scheme}://{parsed_origin.netloc}"

    for allowed in ALLOWED_ORIGINS:
        parsed_allowed = urlparse(allowed.strip().lower())
        allowed_base = f"{parsed_allowed.scheme}://{parsed_allowed.netloc}"
        if origin_base == allowed_base:
            return True
    return False


def check_duplicate_csrf_cookies(request: Request) -> bool:
    """
    Check if the incoming Cookie header contains multiple instances of the CSRF cookie.
    Detects subdomain cookie injection / tossing attempts.
    """
    raw_cookie_header = request.headers.get("cookie", "")
    if not raw_cookie_header:
        return False
    occurrences = [
        item.strip() for item in raw_cookie_header.split(";")
        if item.strip().startswith(f"{CSRF_COOKIE_NAME}=")
    ]
    return len(occurrences) > 1


def validate_csrf(
    request: Request,
    cookie_csrf: str | None,
    header_csrf: str | None,
) -> None:
    """
    Validate CSRF for cookie-authenticated state-changing requests.

    Threat Model & Defense-in-Depth:
    1. Origin / Referer Validation: Reject any request that has neither Origin nor Referer,
       or whose Origin/Referer is untrusted.
    2. Cookie Ambiguity Protection: Detect and reject duplicate CSRF cookies (subdomain tossing).
    3. Cryptographic Signature Validation: Ensure both cookie and header CSRF tokens are authentic
       HMAC-SHA256 signatures generated with the server's key.
    4. Constant-Time Match: Compare cookie and header values using secrets.compare_digest.
    """
    # 1. Origin / Referer Header Validation (At least one must be present and valid)
    origin = request.headers.get("origin")
    referer = request.headers.get("referer")

    if not origin and not referer:
        logger.warning("CSRF validation failed: Missing both Origin and Referer headers")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF validation failed: Missing Origin and Referer headers.",
        )

    if origin:
        if not is_origin_allowed(origin):
            logger.warning("CSRF validation failed: Untrusted Origin header '%s'", origin)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="CSRF validation failed: Untrusted Origin.",
            )
    elif referer:
        parsed_referer = urlparse(referer)
        referer_origin = f"{parsed_referer.scheme}://{parsed_referer.netloc}"
        if not is_origin_allowed(referer_origin):
            logger.warning("CSRF validation failed: Untrusted Referer header '%s'", referer)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="CSRF validation failed: Untrusted Referer.",
            )

    # 2. Check for Duplicate / Ambiguous CSRF Cookies (Cookie Tossing Defense)
    if check_duplicate_csrf_cookies(request):
        logger.warning("CSRF validation failed: Duplicate CSRF cookies detected in Cookie header")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF validation failed: Ambiguous duplicate CSRF cookies detected.",
        )

    # 3. Double-Submit Token Presence
    if not cookie_csrf or not cookie_csrf.strip():
        logger.warning("CSRF validation failed: Missing CSRF cookie")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF validation failed: Missing CSRF cookie.",
        )

    if not header_csrf or not header_csrf.strip():
        logger.warning("CSRF validation failed: Missing X-CSRF-Token header")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF validation failed: Missing X-CSRF-Token header.",
        )

    # 4. Cryptographic Signature Validation
    clean_cookie = cookie_csrf.strip()
    clean_header = header_csrf.strip()

    if not verify_csrf_token_signature(clean_cookie):
        logger.warning("CSRF validation failed: Invalid CSRF cookie cryptographic signature")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF validation failed: Invalid CSRF cookie signature.",
        )

    if not verify_csrf_token_signature(clean_header):
        logger.warning("CSRF validation failed: Invalid CSRF header cryptographic signature")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF validation failed: Invalid CSRF header signature.",
        )

    # 5. Constant-time Equality Check
    if not secrets.compare_digest(clean_cookie, clean_header):
        logger.warning("CSRF validation failed: Token mismatch between cookie and header")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF validation failed: Token mismatch.",
        )

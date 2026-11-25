# Authentication, Token Infrastructure & Role-Based Access Control (RBAC)

This module implements Phase 11.3 of the Intelligent Traffic Management System (ITMS): a production-conscious authentication and authorization system using Argon2id password hashing, short-lived JWT access tokens, rotating refresh tokens with account-wide reuse detection, CSRF protection, and role-based access control.

---

## 1. Architecture & Token Transport Flows

The system strictly bifurcates token transport according to client type:

### A. Browser Cookie-Based Flow (Default: `token_transport="cookie"`)
Designed for web applications running in browsers:
1. **Login (`POST /auth/login`)**:
   - Authenticates credentials.
   - Sets the raw refresh token in an `HttpOnly`, `SameSite=Lax` (or `Strict`), `Secure` cookie named `itms_refresh_token`.
   - Sets an opaque CSRF token in a client-readable cookie named `itms_csrf_token`.
   - **Crucial Security Invariant**: The raw refresh token is **NEVER** included in the JSON response payload (`refresh_token: null`). The browser JavaScript receives only `access_token` and `csrf_token`.
2. **Refresh (`POST /auth/refresh`)**:
   - Browser automatically includes the `itms_refresh_token` cookie.
   - Browser client reads `itms_csrf_token` and echoes it in the `X-CSRF-Token` HTTP header.
   - Server enforces CSRF validation: checks `Origin` / `Referer` against trusted origins and validates that `X-CSRF-Token` header matches the `itms_csrf_token` cookie via constant-time comparison.
   - Server rotates the refresh token and sets updated `itms_refresh_token` and rotated `itms_csrf_token` cookies.
   - Response JSON returns the new `access_token` and updated `csrf_token` (`refresh_token: null`).
3. **Logout (`POST /auth/logout`)**:
   - Enforces CSRF validation for cookie-authenticated requests.
   - Revokes the current refresh token family.
   - Clears both cookies (`itms_refresh_token` and `itms_csrf_token`) using identical scope attributes (`path`, `domain`, `secure`, `samesite`).

### B. Mobile / CLI Body-Based Flow (`token_transport="body"` or header `X-Token-Transport: body`)
Designed for non-browser clients (iOS/Android apps, background workers, automated CLI tools):
1. **Login (`POST /auth/login`)**:
   - Does **NOT** issue `Set-Cookie` headers.
   - Returns both `access_token` and `refresh_token` directly in the JSON response payload.
2. **Refresh (`POST /auth/refresh`)**:
   - Client sends `{"refresh_token": "..."}` in the JSON body.
   - Rotated refresh token is returned in the JSON response payload.
   - No CSRF validation is required because non-browser clients do not use ambient cookie credentials.
3. **Logout (`POST /auth/logout`)**:
   - Client sends `{"refresh_token": "..."}` in the JSON body to revoke the current session.

---

## 2. CSRF Threat Model & Defense Strategy

### Threat Model
Cross-Site Request Forgery (CSRF) occurs when an attacker's website tricks a victim's authenticated browser into issuing unauthorized state-changing requests to the ITMS API using ambient cookie credentials. While `SameSite=Lax` cookies provide a baseline defense in modern browsers, defense-in-depth requires active validation for cookie-authenticated endpoints.

### Defense Mechanism
1. **Origin / Referer Whitelist Validation**:
   - Incoming state-changing requests (`/refresh`, `/logout`, `/logout-all`) inspect the `Origin` (falling back to `Referer` if `Origin` is absent).
   - If present, the origin must strictly match one of the allowed origins in `ALLOWED_ORIGINS` (default: `http://localhost:5173`, `http://127.0.0.1:5173`).
   - Untrusted origins are immediately rejected with HTTP 403 Forbidden.
2. **Double-Submit CSRF Cookie / Header**:
   - On login and refresh, the server sets a readable cookie `itms_csrf_token` containing a 256-bit random token.
   - The frontend JavaScript reads this cookie and passes it via the `X-CSRF-Token` request header.
   - Due to the browser's Same-Origin Policy (SOP), an external malicious site cannot read the cookie value on the ITMS domain and cannot set the required header.
   - The backend validates matching tokens using constant-time comparison (`secrets.compare_digest`).

---

## 3. Account-Wide Refresh Token Revocation on Reuse

### Scenario
- User logs in on Device A, creating token family A.
- User logs in on Device B, creating token family B.
- Device A rotates token A1 -> A2. Token A1 is now marked `is_revoked = 1`.
- A compromised token A1 is replayed to `/auth/refresh`.

### Security Response
1. The server detects that a revoked token was submitted (`is_revoked == 1`), indicating potential token theft or intercept.
2. **Account-Wide Revocation**: The server immediately executes an atomic update revoking **ALL** active refresh tokens belonging to that user across **ALL** token families:
   ```sql
   UPDATE refresh_tokens SET is_revoked = 1 WHERE user_id = :user_id AND is_revoked = 0;
   ```
3. **Version Increment**: The server increments `user.token_version += 1` in the same critical-write transaction.
4. **Immediate Invalidation**:
   - Device A's current token (A2) cannot refresh.
   - Device B's token (B2) cannot refresh.
   - All active access tokens across all devices are immediately rejected on protected routes (such as `/auth/me`).
5. Rejects the request with HTTP 401 (`"Compromised refresh token detected: All sessions have been revoked."`).

---

## 4. Logout Semantics

The system provides two distinct logout operations:

1. **Current-Session Logout (`POST /auth/logout`)**:
   - Revokes only the presented refresh-token family (`family_id`).
   - Does **NOT** increment `user.token_version`.
   - Other active devices (e.g. Device B) remain completely logged in and functional.
   - Clears auth and CSRF cookies on the client.
2. **Account-Wide Logout (`POST /auth/logout-all`)**:
   - Accessible via Bearer JWT or refresh token (cookie or body).
   - Enforces CSRF validation when invoked with cookie credentials.
   - Revokes every refresh-token family belonging to the user.
   - Increments `user.token_version += 1`.
   - Immediately terminates all sessions and invalidates all outstanding access tokens.

---

## 5. User Profile Schema & Contract

The user profile model in the approved Phase 11.2 database schema uses:
- **`full_name`**: `Mapped[str] = mapped_column(Text, nullable=False)`
- **`email`**: `Mapped[str] = mapped_column(Text, unique=True, nullable=False)`

There is **no** `username` column in the database. All API contracts, registration requests, `/auth/me` responses, and CLI commands consistently expose `full_name`.

---

## 6. Endpoints Inventory

| Method | Endpoint | Description | Auth Required | Refresh Token Transport | CSRF Protection |
|---|---|---|---|---|---|
| `POST` | `/auth/register` | Register new user account | Public | None | N/A |
| `POST` | `/auth/login` | Authenticate credentials | Public | Cookie (browser) or Body (CLI/mobile) | Sets CSRF Cookie |
| `POST` | `/auth/refresh` | Rotate refresh token | Cookie or Body | Rotates Cookie or Body | Enforced for cookie |
| `POST` | `/auth/logout` | Current-session logout | Cookie or Body | Clears Cookie | Enforced for cookie |
| `POST` | `/auth/logout-all` | Account-wide logout | Bearer JWT or Cookie/Body | Clears Cookie | Enforced for cookie |
| `GET` | `/auth/me` | Current authenticated profile | Bearer JWT | None | N/A |

*All endpoints are additionally mounted under `/api/v1/auth/*`.*

---

## 7. Password Security (Argon2id)

- **Algorithm**: Argon2id via `argon2-cffi` (RFC 9106)
- **Memory Cost (`m`)**: 65,536 KiB (64 MiB)
- **Time Cost (`t`)**: 3 iterations
- **Parallelism (`p`)**: 4 threads
- **Hash Length**: 32 bytes | **Salt Length**: 16 bytes
- **Password Strength Rules**: 8–128 characters, non-empty, non-whitespace.

---

## 8. Cookie & CORS Security Configuration

- **`COOKIE_SECURE`**: Always `True` in `production` and `staging` environments.
- **`COOKIE_HTTPONLY`**: Always `True` on the refresh token cookie (`itms_refresh_token`).
- **`COOKIE_SAMESITE`**: Explicitly configured to `"lax"` (or `"strict"`).
- **`COOKIE_PATH`**: Defaults to `"/"` to cover both `/auth` and `/api/v1/auth`.
- **`COOKIE_DOMAIN`**: Defaults to `None` (restricting to host-only cookie).
- **Cookie Deletion**: Strictly mirrors creation parameters (`path`, `domain`, `secure`, `samesite`).
- **CORS Credentials & Wildcard Protection**:
  `CORSMiddleware` uses explicit origin list `ALLOWED_ORIGINS`. Startup assertion verifies that `*` is never combined with `allow_credentials=True`.

---

## 9. Administrator Provisioning CLI

```bash
# Interactive mode (prompts for email, full name, and masked password)
python -m backend.auth.admin_cli

# Flagged non-interactive / automation mode
python -m backend.auth.admin_cli --email "admin@itms.local" --full-name "System Administrator" --password "StrongPass123!"
```
Masked input uses Python's standard `getpass` module.

---

## 10. Automated Tests

Run the full authentication security suite:
```bash
python3 -m pytest backend/test_auth.py -v
```
38 tests passing across:
- Argon2id password security & strength validation.
- JWT issuance, decoding, expiry, signature, and algorithm defense.
- User registration and email normalization.
- Browser vs Mobile/CLI token transport isolation.
- CSRF Origin checks and double-submit header validation.
- Multi-device refresh rotation and cross-family reuse detection.
- Current-session vs account-wide logout semantics.
- Profile contract (`full_name`) and `token_version` invalidation.
- RBAC permissions (`require_admin`, `require_authenticated_user`).
- Last-admin demotion/suspension concurrency protection (`BEGIN IMMEDIATE`).
- Admin CLI account creation.
- Security configuration assertions.

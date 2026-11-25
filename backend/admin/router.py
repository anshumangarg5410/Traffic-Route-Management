from datetime import datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Cookie, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.admin.schemas import (
    AdminUserDetailResponse,
    AdminUserListResponse,
    AdminUserResponse,
    AuditLogListResponse,
    ModelRegistryListResponse,
    PlatformOverviewResponse,
    TrafficBatchListResponse,
    TrafficQualityResponse,
    TrainingJobListResponse,
    UserRoleUpdateRequest,
    UserStatusUpdateRequest,
    WorkerStatusListResponse,
)
from backend.admin.service import (
    get_platform_overview,
    get_traffic_quality_summary,
    get_user_details,
    list_audit_logs,
    list_registered_models,
    list_traffic_batches,
    list_training_jobs,
    list_users_paginated,
    list_worker_statuses,
    update_user_role_transactional,
    update_user_status_transactional,
)
from backend.auth.config import COOKIE_NAME, CSRF_COOKIE_NAME, CSRF_HEADER_NAME
from backend.auth.csrf import validate_csrf
from backend.auth.dependencies import require_admin
from backend.database.models import User
from backend.database.session import get_critical_db, get_db

admin_router = APIRouter()


def _get_client_ip(request: Request) -> Optional[str]:
    """Safely extract remote client IP address from request."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def _verify_admin_csrf_if_cookie_present(
    request: Request,
    cookie_csrf: Optional[str] = None,
) -> None:
    """
    Enforces double-submit CSRF protection on mutating admin actions when ambient cookies are present.
    If the request carries ambient session/auth cookies (e.g., from browser context), CSRF validation is mandatory.
    If invoked purely via Authorization: Bearer without cookies (CLI/automated testing), CSRF is not required.
    """
    raw_cookie_csrf = cookie_csrf or request.cookies.get(CSRF_COOKIE_NAME)
    has_ambient_cookie = bool(raw_cookie_csrf or request.cookies.get(COOKIE_NAME))
    if has_ambient_cookie:
        header_csrf = request.headers.get(CSRF_HEADER_NAME) or request.headers.get("x-csrf-token")
        validate_csrf(request, raw_cookie_csrf, header_csrf)


# ============================================================================
# Platform Overview Endpoint
# ============================================================================

@admin_router.get(
    "/overview",
    response_model=PlatformOverviewResponse,
    summary="Platform overview metrics and telemetry",
)
async def get_overview_endpoint(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PlatformOverviewResponse:
    """Retrieve measured platform overview, user counts, model status, and recent activity."""
    return await get_platform_overview(session=db)


# ============================================================================
# User Management Endpoints
# ============================================================================

@admin_router.get(
    "/users",
    response_model=AdminUserListResponse,
    summary="List users with pagination, search, and filtering",
)
async def list_users_endpoint(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
    search: Optional[str] = Query(None, description="Search term matching email or full name"),
    role: Optional[str] = Query(None, description="Filter by role ('user' or 'admin')"),
    is_active: Optional[int] = Query(None, description="Filter by status (1 for active, 0 for inactive)"),
    limit: int = Query(20, ge=1, le=100, description="Page limit"),
    offset: int = Query(0, ge=0, description="Page offset"),
) -> AdminUserListResponse:
    """Retrieve paginated list of registered users."""
    return await list_users_paginated(
        session=db,
        search=search,
        role=role,
        is_active=is_active,
        limit=limit,
        offset=offset,
    )


@admin_router.get(
    "/users/{user_id}",
    response_model=AdminUserDetailResponse,
    summary="Get user details and activity counts",
)
async def get_user_detail_endpoint(
    user_id: str,
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AdminUserDetailResponse:
    """Retrieve safe user account information and usage statistics."""
    return await get_user_details(session=db, user_id=user_id)


@admin_router.put(
    "/users/{user_id}/role",
    response_model=AdminUserResponse,
    summary="Update a user's role with transactional audit logging",
)
async def update_user_role_endpoint(
    user_id: str,
    req: UserRoleUpdateRequest,
    request: Request,
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_critical_db)],
    cookie_csrf: Annotated[Optional[str], Cookie(alias=CSRF_COOKIE_NAME)] = None,
) -> AdminUserResponse:
    """
    Atomically modify a user's role and write an AuditLog record.
    Uses BEGIN IMMEDIATE write reservation to prevent concurrent demotion of the last active administrator.
    Immediately increments token_version to revoke active sessions for the modified user.
    Enforces double-submit CSRF verification when ambient auth/session cookies are present.
    """
    _verify_admin_csrf_if_cookie_present(request, cookie_csrf)
    client_ip = _get_client_ip(request)
    async with db.begin():
        updated_user = await update_user_role_transactional(
            session=db,
            admin_id=current_admin.id,
            target_user_id=user_id,
            new_role=req.role,
            ip_address=client_ip,
        )
    return AdminUserResponse.model_validate(updated_user)


@admin_router.put(
    "/users/{user_id}/status",
    response_model=AdminUserResponse,
    summary="Activate or suspend a user with transactional audit logging",
)
async def update_user_status_endpoint(
    user_id: str,
    req: UserStatusUpdateRequest,
    request: Request,
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_critical_db)],
    cookie_csrf: Annotated[Optional[str], Cookie(alias=CSRF_COOKIE_NAME)] = None,
) -> AdminUserResponse:
    """
    Atomically modify a user's active/suspended status and write an AuditLog record.
    Uses BEGIN IMMEDIATE write reservation to prevent concurrent suspension of the last active administrator.
    Immediately increments token_version to revoke active sessions for the modified user.
    Enforces double-submit CSRF verification when ambient auth/session cookies are present.
    """
    _verify_admin_csrf_if_cookie_present(request, cookie_csrf)
    client_ip = _get_client_ip(request)
    async with db.begin():
        updated_user = await update_user_status_transactional(
            session=db,
            admin_id=current_admin.id,
            target_user_id=user_id,
            new_is_active=req.is_active,
            ip_address=client_ip,
        )
    return AdminUserResponse.model_validate(updated_user)


# ============================================================================
# Traffic Data Monitoring Endpoints
# ============================================================================

@admin_router.get(
    "/traffic/batches",
    response_model=TrafficBatchListResponse,
    summary="List traffic ingestion batches",
)
async def list_traffic_batches_endpoint(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
    source_type: Optional[str] = Query(None, description="Filter by source type (REAL_SENSOR, SIMULATION_SYNTHETIC, HISTORICAL_BENCHMARK)"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> TrafficBatchListResponse:
    """Retrieve paginated traffic ingestion batches."""
    return await list_traffic_batches(
        session=db,
        source_type=source_type,
        limit=limit,
        offset=offset,
    )


@admin_router.get(
    "/traffic/quality",
    response_model=TrafficQualityResponse,
    summary="Get traffic data quality events, rejections, and source breakdown",
)
async def get_traffic_quality_endpoint(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> TrafficQualityResponse:
    """Retrieve data quality events, detector faults, and dead-letter rejections."""
    return await get_traffic_quality_summary(
        session=db,
        limit=limit,
        offset=offset,
    )


# ============================================================================
# ML Model & Training Job Monitoring Endpoints
# ============================================================================

@admin_router.get(
    "/models",
    response_model=ModelRegistryListResponse,
    summary="List registered ML models and active deployment",
)
async def list_models_endpoint(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ModelRegistryListResponse:
    """Retrieve registered ML model catalog and active production deployment status."""
    return await list_registered_models(session=db)


@admin_router.get(
    "/models/jobs",
    response_model=TrainingJobListResponse,
    summary="List ML training jobs and execution status",
)
async def list_training_jobs_endpoint(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
    status: Optional[str] = Query(None, description="Filter by job status (QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED)"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> TrainingJobListResponse:
    """Retrieve paginated ML training job history and status."""
    return await list_training_jobs(
        session=db,
        status_filter=status,
        limit=limit,
        offset=offset,
    )


# ============================================================================
# System Monitoring Endpoints
# ============================================================================

@admin_router.get(
    "/system/workers",
    response_model=WorkerStatusListResponse,
    summary="List worker deployment status and heartbeat telemetry",
)
async def list_workers_endpoint(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> WorkerStatusListResponse:
    """Retrieve worker status records, loaded model versions, and heartbeat staleness."""
    return await list_worker_statuses(session=db)


# ============================================================================
# Audit Logs Endpoints
# ============================================================================

@admin_router.get(
    "/audit-logs",
    response_model=AuditLogListResponse,
    summary="List administrative audit logs with filtering and pagination",
)
async def list_audit_logs_endpoint(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
    action: Optional[str] = Query(None, description="Filter by action string"),
    actor_id: Optional[str] = Query(None, description="Filter by actor user ID"),
    target_entity: Optional[str] = Query(None, description="Filter by target entity"),
    start_date: Optional[datetime] = Query(None, description="Filter records created on or after start date"),
    end_date: Optional[datetime] = Query(None, description="Filter records created on or before end date"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> AuditLogListResponse:
    """Retrieve paginated audit logs with actor email and full name join."""
    return await list_audit_logs(
        session=db,
        action=action,
        actor_id=actor_id,
        target_entity=target_entity,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        offset=offset,
    )

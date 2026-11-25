from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.admin.audit import log_audit_event
from backend.admin.schemas import (
    ActiveModelSummary,
    AdminUserDetailResponse,
    AdminUserListResponse,
    AdminUserResponse,
    AuditLogItemResponse,
    AuditLogListResponse,
    BackendHealthSummary,
    DataQualityEventItemResponse,
    IngestionRejectionItemResponse,
    ModelRegistryListResponse,
    PlatformOverviewResponse,
    RegisteredModelItemResponse,
    RoadNetworkOverview,
    TrafficBatchItemResponse,
    TrafficBatchListResponse,
    TrafficQualityResponse,
    TrainingJobItemResponse,
    TrainingJobListResponse,
    WorkerStatusItemResponse,
    WorkerStatusListResponse,
)
from backend.auth.service import demote_or_suspend_admin
from backend.database.models import (
    ActiveModelDeployment,
    AuditLog,
    DataQualityEvent,
    IngestionRejection,
    MLTrainingJob,
    ModelRegistry,
    RouteSearchHistory,
    SavedRoute,
    TrafficIngestionBatch,
    User,
    WorkerDeploymentStatus,
)
from backend.routing.road_network import (
    get_network_status,
    get_network_summary,
    is_graph_available_locally,
)


# ============================================================================
# Platform Overview Service
# ============================================================================

async def get_platform_overview(session: AsyncSession) -> PlatformOverviewResponse:
    """Aggregate measurable platform overview telemetry across database and services."""
    # User counts
    total_users_stmt = select(func.count(User.id))
    active_users_stmt = select(func.count(User.id)).where(User.is_active == 1)
    inactive_users_stmt = select(func.count(User.id)).where(User.is_active == 0)
    active_admins_stmt = select(func.count(User.id)).where(
        User.role == "admin", User.is_active == 1
    )

    total_users = (await session.scalar(total_users_stmt)) or 0
    active_users = (await session.scalar(active_users_stmt)) or 0
    inactive_users = (await session.scalar(inactive_users_stmt)) or 0
    total_active_admins = (await session.scalar(active_admins_stmt)) or 0

    # Active deployed model
    active_deploy_stmt = (
        select(ActiveModelDeployment, ModelRegistry)
        .join(ModelRegistry, ActiveModelDeployment.model_id == ModelRegistry.id)
        .where(ActiveModelDeployment.id == 1)
    )
    deploy_row = (await session.execute(active_deploy_stmt)).first()

    active_model_summary = None
    deployment_status = "NO_ACTIVE_MODEL"
    if deploy_row:
        deployment, reg_model = deploy_row
        active_model_summary = ActiveModelSummary(
            id=reg_model.id,
            dataset_identity=reg_model.dataset_identity,
            dataset_version=reg_model.dataset_version,
            model_framework_version=reg_model.model_framework_version,
            deployed_at=deployment.deployed_at,
            deployed_by=deployment.deployed_by,
        )
        deployment_status = "DEPLOYED"

    # Road network status
    try:
        net_status = get_network_status()
        net_summary = get_network_summary()
        road_network = RoadNetworkOverview(
            available=bool(net_status.get("available_locally", net_status.get("graph_available_locally", False))),
            status=net_status.get("status", net_status.get("load_status")),
            intersections_count=net_summary.get("intersection_count", net_summary.get("total_intersections")),
            edges_count=net_summary.get("directed_edge_count", net_summary.get("total_edges", net_summary.get("edge_count"))),
            message=net_status.get("message") or ("Network graph ready in memory" if net_status.get("available_locally") else None),
        )
    except Exception as e:
        road_network = RoadNetworkOverview(
            available=False,
            status="ERROR",
            message=f"Failed to inspect network status: {str(e)}",
        )

    # Backend health
    backend_health = BackendHealthSummary(
        status="healthy",
        service="Intelligent Traffic Management System",
        version="1.0.0",
    )

    # Recent audit activity (latest 5)
    recent_audits_stmt = (
        select(AuditLog, User.email, User.full_name)
        .outerjoin(User, AuditLog.actor_id == User.id)
        .order_by(AuditLog.created_at.desc())
        .limit(5)
    )
    audit_rows = (await session.execute(recent_audits_stmt)).all()
    recent_activity = []
    for audit, email, name in audit_rows:
        recent_activity.append(
            AuditLogItemResponse(
                id=audit.id,
                actor_id=audit.actor_id,
                actor_email=email,
                actor_name=name,
                action=audit.action,
                target_entity=audit.target_entity,
                details=audit.details,
                ip_address=audit.ip_address,
                created_at=audit.created_at,
            )
        )

    return PlatformOverviewResponse(
        total_users=total_users,
        active_users=active_users,
        inactive_users=inactive_users,
        total_active_admins=total_active_admins,
        active_model=active_model_summary,
        model_deployment_status=deployment_status,
        road_network=road_network,
        backend_health=backend_health,
        recent_audit_activity=recent_activity,
    )


# ============================================================================
# User Management Service
# ============================================================================

async def list_users_paginated(
    session: AsyncSession,
    search: Optional[str] = None,
    role: Optional[str] = None,
    is_active: Optional[int] = None,
    limit: int = 20,
    offset: int = 0,
) -> AdminUserListResponse:
    """Retrieve filtered, paginated user records for administrative management."""
    filters = []
    if search and search.strip():
        term = f"%{search.strip()}%"
        filters.append(or_(User.email.ilike(term), User.full_name.ilike(term)))
    if role:
        filters.append(User.role == role)
    if is_active is not None:
        filters.append(User.is_active == is_active)

    count_stmt = select(func.count(User.id))
    if filters:
        count_stmt = count_stmt.where(*filters)
    total = (await session.scalar(count_stmt)) or 0

    query = select(User)
    if filters:
        query = query.where(*filters)
    query = query.order_by(User.created_at.desc(), User.id.asc()).offset(offset).limit(limit)

    result = await session.execute(query)
    users = result.scalars().all()

    return AdminUserListResponse(
        total=total,
        limit=limit,
        offset=offset,
        users=[AdminUserResponse.model_validate(u) for u in users],
    )


async def get_user_details(
    session: AsyncSession,
    user_id: str,
) -> AdminUserDetailResponse:
    """Retrieve full user metadata and activity statistics."""
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User '{user_id}' not found.",
        )

    saved_count_stmt = select(func.count(SavedRoute.id)).where(SavedRoute.user_id == user_id)
    saved_routes_count = (await session.scalar(saved_count_stmt)) or 0

    search_count_stmt = select(func.count(RouteSearchHistory.id)).where(
        RouteSearchHistory.user_id == user_id
    )
    route_searches_count = (await session.scalar(search_count_stmt)) or 0

    return AdminUserDetailResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        updated_at=user.updated_at,
        saved_routes_count=saved_routes_count,
        route_searches_count=route_searches_count,
    )


async def update_user_role_transactional(
    session: AsyncSession,
    admin_id: str,
    target_user_id: str,
    new_role: str,
    ip_address: Optional[str] = None,
) -> User:
    """
    Atomically update a user's role and write an AuditLog in the exact same transaction.
    Must be called inside an active BEGIN IMMEDIATE transaction (critical engine).
    Enforces last-active-admin protection and revokes active sessions via token_version.
    """
    target_user = await session.get(User, target_user_id)
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User '{target_user_id}' not found.",
        )
    old_role = target_user.role

    # Mutate role using existing last-admin protection helper within the active transaction
    updated_user = await demote_or_suspend_admin(
        admin_id=target_user_id,
        new_role=new_role,
        custom_session=session,
    )

    # In the exact same transaction, record the audit entry
    await log_audit_event(
        session=session,
        actor_id=admin_id,
        action="USER_ROLE_CHANGE",
        target_entity=f"user:{target_user_id}",
        details={
            "old_role": old_role,
            "new_role": new_role,
            "target_email": target_user.email,
        },
        ip_address=ip_address,
    )

    return updated_user


async def update_user_status_transactional(
    session: AsyncSession,
    admin_id: str,
    target_user_id: str,
    new_is_active: int,
    ip_address: Optional[str] = None,
) -> User:
    """
    Atomically update a user's status and write an AuditLog in the exact same transaction.
    Must be called inside an active BEGIN IMMEDIATE transaction (critical engine).
    Enforces last-active-admin protection and revokes active sessions via token_version.
    """
    target_user = await session.get(User, target_user_id)
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User '{target_user_id}' not found.",
        )
    old_status = target_user.is_active

    # Mutate status using existing last-admin protection helper within the active transaction
    updated_user = await demote_or_suspend_admin(
        admin_id=target_user_id,
        new_is_active=new_is_active,
        custom_session=session,
    )

    # In the exact same transaction, record the audit entry
    await log_audit_event(
        session=session,
        actor_id=admin_id,
        action="USER_STATUS_CHANGE",
        target_entity=f"user:{target_user_id}",
        details={
            "old_status": old_status,
            "new_status": new_is_active,
            "target_email": target_user.email,
        },
        ip_address=ip_address,
    )

    return updated_user


# ============================================================================
# Traffic Data Monitoring Service
# ============================================================================

async def list_traffic_batches(
    session: AsyncSession,
    source_type: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
) -> TrafficBatchListResponse:
    """Retrieve paginated traffic ingestion batches."""
    filters = []
    if source_type:
        filters.append(TrafficIngestionBatch.source_type == source_type)

    count_stmt = select(func.count(TrafficIngestionBatch.id))
    if filters:
        count_stmt = count_stmt.where(*filters)
    total = (await session.scalar(count_stmt)) or 0

    query = select(TrafficIngestionBatch)
    if filters:
        query = query.where(*filters)
    query = (
        query.order_by(TrafficIngestionBatch.ingested_at.desc(), TrafficIngestionBatch.id.asc())
        .offset(offset)
        .limit(limit)
    )

    result = await session.execute(query)
    batches = result.scalars().all()

    return TrafficBatchListResponse(
        total=total,
        limit=limit,
        offset=offset,
        batches=[TrafficBatchItemResponse.model_validate(b) for b in batches],
    )


async def get_traffic_quality_summary(
    session: AsyncSession,
    limit: int = 20,
    offset: int = 0,
) -> TrafficQualityResponse:
    """Retrieve data quality events, rejection logs, and ingestion source breakdowns."""
    # Quality events
    events_count_stmt = select(func.count(DataQualityEvent.id))
    quality_events_count = (await session.scalar(events_count_stmt)) or 0

    events_stmt = (
        select(DataQualityEvent)
        .order_by(DataQualityEvent.created_at.desc(), DataQualityEvent.id.asc())
        .offset(offset)
        .limit(limit)
    )
    events = (await session.execute(events_stmt)).scalars().all()

    # Ingestion rejections
    rejections_count_stmt = select(func.count(IngestionRejection.id))
    rejections_count = (await session.scalar(rejections_count_stmt)) or 0

    rejections_stmt = (
        select(IngestionRejection)
        .order_by(IngestionRejection.created_at.desc(), IngestionRejection.id.asc())
        .offset(offset)
        .limit(limit)
    )
    rejections = (await session.execute(rejections_stmt)).scalars().all()

    # Source breakdown from ingestion batches
    breakdown_stmt = select(
        TrafficIngestionBatch.source_type, func.count(TrafficIngestionBatch.id)
    ).group_by(TrafficIngestionBatch.source_type)
    breakdown_rows = (await session.execute(breakdown_stmt)).all()
    source_breakdown = {st: cnt for st, cnt in breakdown_rows}

    return TrafficQualityResponse(
        quality_events_count=quality_events_count,
        quality_events=[DataQualityEventItemResponse.model_validate(e) for e in events],
        rejections_count=rejections_count,
        rejections=[IngestionRejectionItemResponse.model_validate(r) for r in rejections],
        source_breakdown=source_breakdown,
    )


# ============================================================================
# ML Model & Training Job Monitoring Service
# ============================================================================

async def list_registered_models(session: AsyncSession) -> ModelRegistryListResponse:
    """Retrieve catalog of trained machine learning model artifacts."""
    stmt = select(ModelRegistry).order_by(
        ModelRegistry.trained_at.desc(), ModelRegistry.id.asc()
    )
    result = await session.execute(stmt)
    models = result.scalars().all()

    active_model_id = None
    for m in models:
        if m.is_active == 1:
            active_model_id = m.id
            break

    return ModelRegistryListResponse(
        total=len(models),
        active_model_id=active_model_id,
        models=[RegisteredModelItemResponse.model_validate(m) for m in models],
    )


async def list_training_jobs(
    session: AsyncSession,
    status_filter: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
) -> TrainingJobListResponse:
    """Retrieve paginated training-job history and state machine records."""
    filters = []
    if status_filter:
        filters.append(MLTrainingJob.status == status_filter)

    count_stmt = select(func.count(MLTrainingJob.id))
    if filters:
        count_stmt = count_stmt.where(*filters)
    total = (await session.scalar(count_stmt)) or 0

    query = select(MLTrainingJob)
    if filters:
        query = query.where(*filters)
    query = (
        query.order_by(MLTrainingJob.created_at.desc(), MLTrainingJob.id.asc())
        .offset(offset)
        .limit(limit)
    )

    result = await session.execute(query)
    jobs = result.scalars().all()

    return TrainingJobListResponse(
        total=total,
        limit=limit,
        offset=offset,
        jobs=[TrainingJobItemResponse.model_validate(j) for j in jobs],
    )


# ============================================================================
# System Monitoring Service
# ============================================================================

async def list_worker_statuses(session: AsyncSession) -> WorkerStatusListResponse:
    """Retrieve worker deployment status and compute heartbeat staleness."""
    stmt = select(WorkerDeploymentStatus).order_by(
        WorkerDeploymentStatus.last_heartbeat.desc(), WorkerDeploymentStatus.worker_id.asc()
    )
    result = await session.execute(stmt)
    workers = result.scalars().all()

    now = datetime.now(timezone.utc)
    items = []
    for w in workers:
        hb = w.last_heartbeat
        if hb.tzinfo is None:
            hb = hb.replace(tzinfo=timezone.utc)
        is_stale = (now - hb) > timedelta(seconds=60)
        items.append(
            WorkerStatusItemResponse(
                worker_id=w.worker_id,
                pid=w.pid,
                loaded_version=w.loaded_version,
                loaded_model_id=w.loaded_model_id,
                status=w.status,
                error_message=w.error_message,
                last_heartbeat=w.last_heartbeat,
                is_stale=is_stale,
            )
        )

    return WorkerStatusListResponse(
        total=len(items),
        workers=items,
    )


# ============================================================================
# Audit Logs Service
# ============================================================================

async def list_audit_logs(
    session: AsyncSession,
    action: Optional[str] = None,
    actor_id: Optional[str] = None,
    target_entity: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    limit: int = 50,
    offset: int = 0,
) -> AuditLogListResponse:
    """Retrieve filtered, paginated administrative audit logs with safe actor join."""
    filters = []
    if action:
        filters.append(AuditLog.action == action)
    if actor_id:
        filters.append(AuditLog.actor_id == actor_id)
    if target_entity:
        filters.append(AuditLog.target_entity.ilike(f"%{target_entity}%"))
    if start_date:
        filters.append(AuditLog.created_at >= start_date)
    if end_date:
        filters.append(AuditLog.created_at <= end_date)

    count_stmt = select(func.count(AuditLog.id))
    if filters:
        count_stmt = count_stmt.where(*filters)
    total = (await session.scalar(count_stmt)) or 0

    query = (
        select(AuditLog, User.email, User.full_name)
        .outerjoin(User, AuditLog.actor_id == User.id)
    )
    if filters:
        query = query.where(*filters)
    query = (
        query.order_by(AuditLog.created_at.desc(), AuditLog.id.asc())
        .offset(offset)
        .limit(limit)
    )

    result = await session.execute(query)
    rows = result.all()

    items = []
    for audit, email, name in rows:
        items.append(
            AuditLogItemResponse(
                id=audit.id,
                actor_id=audit.actor_id,
                actor_email=email,
                actor_name=name,
                action=audit.action,
                target_entity=audit.target_entity,
                details=audit.details,
                ip_address=audit.ip_address,
                created_at=audit.created_at,
            )
        )

    return AuditLogListResponse(
        total=total,
        limit=limit,
        offset=offset,
        items=items,
    )

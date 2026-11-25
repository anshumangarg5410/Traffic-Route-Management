from datetime import datetime, timezone
from typing import Annotated
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.dependencies import require_authenticated_user
from backend.auth.schemas import MessageResponse, UserResponse
from backend.database.models import RouteSearchHistory, SavedRoute, User
from backend.database.session import get_db
from backend.user.schemas import (
    DashboardSummaryResponse,
    RouteHistoryCreateRequest,
    RouteHistoryResponse,
    SavedRouteCreateRequest,
    SavedRouteResponse,
)

user_router = APIRouter()


# ============================================================================
# Saved Routes (Scoped strictly to authenticated user)
# ============================================================================
@user_router.get(
    "/saved-routes",
    response_model=list[SavedRouteResponse],
    summary="List saved routes for authenticated user",
)
async def list_saved_routes(
    current_user: Annotated[User, Depends(require_authenticated_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[SavedRouteResponse]:
    """Retrieve all saved routes owned by the currently authenticated user."""
    stmt = (
        select(SavedRoute)
        .where(SavedRoute.user_id == current_user.id)
        .order_by(SavedRoute.created_at.desc())
    )
    result = await db.execute(stmt)
    routes = result.scalars().all()
    return [SavedRouteResponse.model_validate(r) for r in routes]


@user_router.post(
    "/saved-routes",
    response_model=SavedRouteResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Save a route for authenticated user",
)
async def create_saved_route(
    req: SavedRouteCreateRequest,
    current_user: Annotated[User, Depends(require_authenticated_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SavedRouteResponse:
    """Create and persist a saved route scoped to the authenticated user."""
    now = datetime.now(timezone.utc)
    route_record = SavedRoute(
        id=uuid.uuid4().hex,
        user_id=current_user.id,
        title=req.title,
        origin_name=req.origin_name,
        origin_lat=req.origin_lat,
        origin_lon=req.origin_lon,
        destination_name=req.destination_name,
        destination_lat=req.destination_lat,
        destination_lon=req.destination_lon,
        preferred_criteria=req.preferred_criteria,
        distance_km=req.distance_km,
        estimated_duration_min=req.estimated_duration_min,
        route_score=req.route_score,
        route_geometry=req.route_geometry,
        recommendation_reason=req.recommendation_reason,
        created_at=now,
    )
    db.add(route_record)
    await db.commit()
    await db.refresh(route_record)
    return SavedRouteResponse.model_validate(route_record)


@user_router.delete(
    "/saved-routes/{route_id}",
    response_model=MessageResponse,
    summary="Delete a saved route owned by authenticated user",
)
async def delete_saved_route(
    route_id: str,
    current_user: Annotated[User, Depends(require_authenticated_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MessageResponse:
    """
    Delete a saved route.
    Enforces strict ownership: if route does not belong to current user, returns 404
    to prevent leaking resource existence.
    """
    stmt = select(SavedRoute).where(
        SavedRoute.id == route_id,
        SavedRoute.user_id == current_user.id,
    )
    route_record = (await db.execute(stmt)).scalar_one_or_none()
    if not route_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Saved route not found.",
        )

    await db.delete(route_record)
    await db.commit()
    return MessageResponse(detail="Saved route deleted successfully.")


# ============================================================================
# Route Search History (Scoped strictly to authenticated user)
# ============================================================================
@user_router.get(
    "/route-history",
    response_model=list[RouteHistoryResponse],
    summary="List route search history for authenticated user",
)
async def list_route_history(
    current_user: Annotated[User, Depends(require_authenticated_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[RouteHistoryResponse]:
    """Retrieve historical route queries performed by the authenticated user."""
    stmt = (
        select(RouteSearchHistory)
        .where(RouteSearchHistory.user_id == current_user.id)
        .order_by(RouteSearchHistory.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    history = result.scalars().all()
    return [RouteHistoryResponse.model_validate(h) for h in history]


@user_router.post(
    "/route-history",
    response_model=RouteHistoryResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record a route search event in user history",
)
async def record_route_search(
    req: RouteHistoryCreateRequest,
    current_user: Annotated[User, Depends(require_authenticated_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RouteHistoryResponse:
    """Record an executed route search to the authenticated user's history."""
    now = datetime.now(timezone.utc)
    history_record = RouteSearchHistory(
        id=uuid.uuid4().hex,
        user_id=current_user.id,
        origin_query=req.origin_query,
        destination_query=req.destination_query,
        selected_route_id=req.selected_route_id,
        route_distance_km=req.route_distance_km,
        estimated_duration_min=req.estimated_duration_min,
        created_at=now,
    )
    db.add(history_record)
    await db.commit()
    await db.refresh(history_record)
    return RouteHistoryResponse.model_validate(history_record)


# ============================================================================
# User Workspace Dashboard Summary
# ============================================================================
@user_router.get(
    "/dashboard-summary",
    response_model=DashboardSummaryResponse,
    summary="Retrieve workspace dashboard metrics for authenticated user",
)
async def get_dashboard_summary(
    current_user: Annotated[User, Depends(require_authenticated_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DashboardSummaryResponse:
    """Aggregate real workspace statistics and recent activity for authenticated user."""
    # Count saved routes
    saved_count_stmt = select(func.count(SavedRoute.id)).where(SavedRoute.user_id == current_user.id)
    total_saved = (await db.scalar(saved_count_stmt)) or 0

    # Count search history
    history_count_stmt = select(func.count(RouteSearchHistory.id)).where(
        RouteSearchHistory.user_id == current_user.id
    )
    total_searches = (await db.scalar(history_count_stmt)) or 0

    # Top 3 recent saved routes
    recent_saved_stmt = (
        select(SavedRoute)
        .where(SavedRoute.user_id == current_user.id)
        .order_by(SavedRoute.created_at.desc())
        .limit(3)
    )
    recent_saved = (await db.execute(recent_saved_stmt)).scalars().all()

    # Top 5 recent searches
    recent_history_stmt = (
        select(RouteSearchHistory)
        .where(RouteSearchHistory.user_id == current_user.id)
        .order_by(RouteSearchHistory.created_at.desc())
        .limit(5)
    )
    recent_history = (await db.execute(recent_history_stmt)).scalars().all()

    return DashboardSummaryResponse(
        user=UserResponse.model_validate(current_user),
        total_saved_routes=total_saved,
        total_searches=total_searches,
        recent_saved_routes=[SavedRouteResponse.model_validate(r) for r in recent_saved],
        recent_searches=[RouteHistoryResponse.model_validate(h) for h in recent_history],
    )

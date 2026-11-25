from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.auth.schemas import UserResponse


class ProfileUpdateRequest(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=100)

    @field_validator("full_name")
    @classmethod
    def clean_name(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Full name cannot be blank or whitespace-only.")
        return cleaned


class SavedRouteCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=100)
    origin_name: str = Field(..., min_length=1, max_length=200)
    origin_lat: float
    origin_lon: float
    destination_name: str = Field(..., min_length=1, max_length=200)
    destination_lat: float
    destination_lon: float
    preferred_criteria: str = Field("balanced", max_length=50)
    distance_km: Optional[float] = None
    estimated_duration_min: Optional[float] = None
    route_score: Optional[float] = None
    route_geometry: Optional[str] = None
    recommendation_reason: Optional[str] = None

    @field_validator("title")
    @classmethod
    def clean_title(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Route title cannot be blank.")
        return cleaned


class SavedRouteUpdateRequest(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=100)
    preferred_criteria: Optional[str] = Field(None, max_length=50)

    @field_validator("title")
    @classmethod
    def clean_optional_title(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Route title cannot be blank.")
        return cleaned


class SavedRouteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    title: str
    origin_name: str
    origin_lat: float
    origin_lon: float
    destination_name: str
    destination_lat: float
    destination_lon: float
    preferred_criteria: str
    distance_km: Optional[float] = None
    estimated_duration_min: Optional[float] = None
    route_score: Optional[float] = None
    route_geometry: Optional[str] = None
    recommendation_reason: Optional[str] = None
    created_at: datetime


class RouteHistoryCreateRequest(BaseModel):
    origin_query: str = Field(..., min_length=1, max_length=200)
    destination_query: str = Field(..., min_length=1, max_length=200)
    selected_route_id: Optional[str] = None
    route_distance_km: Optional[float] = None
    estimated_duration_min: Optional[float] = None


class RouteHistoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    origin_query: str
    destination_query: str
    selected_route_id: Optional[str] = None
    route_distance_km: Optional[float] = None
    estimated_duration_min: Optional[float] = None
    created_at: datetime


class DashboardSummaryResponse(BaseModel):
    user: UserResponse
    total_saved_routes: int
    total_searches: int
    recent_saved_routes: list[SavedRouteResponse]
    recent_searches: list[RouteHistoryResponse]

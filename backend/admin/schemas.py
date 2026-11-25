from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator


# ============================================================================
# User Management Schemas
# ============================================================================

class AdminUserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    full_name: str
    role: str
    is_active: int
    created_at: datetime
    updated_at: datetime


class AdminUserListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    users: list[AdminUserResponse]


class AdminUserDetailResponse(AdminUserResponse):
    saved_routes_count: int = 0
    route_searches_count: int = 0


class UserRoleUpdateRequest(BaseModel):
    role: str = Field(..., description="Role must be either 'user' or 'admin'")

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        clean = v.strip().lower()
        if clean not in ("user", "admin"):
            raise ValueError("Role must be strictly 'user' or 'admin'.")
        return clean


class UserStatusUpdateRequest(BaseModel):
    is_active: int = Field(..., description="1 for active, 0 for inactive/suspended")

    @field_validator("is_active")
    @classmethod
    def validate_status(cls, v: int) -> int:
        if v not in (0, 1):
            raise ValueError("is_active must be either 1 (active) or 0 (inactive/suspended).")
        return v


# ============================================================================
# Audit Log Schemas
# ============================================================================

class AuditLogItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    actor_id: Optional[str] = None
    actor_email: Optional[str] = None
    actor_name: Optional[str] = None
    action: str
    target_entity: str
    details: str
    ip_address: Optional[str] = None
    created_at: datetime


class AuditLogListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[AuditLogItemResponse]


# ============================================================================
# Platform Overview Schemas
# ============================================================================

class BackendHealthSummary(BaseModel):
    status: str
    service: str
    version: str


class RoadNetworkOverview(BaseModel):
    available: bool
    status: Optional[str] = None
    intersections_count: Optional[int] = None
    edges_count: Optional[int] = None
    message: Optional[str] = None


class ActiveModelSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    dataset_identity: str
    dataset_version: str
    model_framework_version: str
    deployed_at: Optional[datetime] = None
    deployed_by: Optional[str] = None


class PlatformOverviewResponse(BaseModel):
    total_users: int
    active_users: int
    inactive_users: int
    total_active_admins: int
    active_model: Optional[ActiveModelSummary] = None
    model_deployment_status: str
    road_network: RoadNetworkOverview
    backend_health: BackendHealthSummary
    recent_audit_activity: list[AuditLogItemResponse]


# ============================================================================
# Traffic Data Monitoring Schemas
# ============================================================================

class TrafficBatchItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    batch_name: str
    source_type: str
    submitted_by: Optional[str] = None
    total_records: int
    accepted_records: int
    rejected_records: int
    ingested_at: datetime


class TrafficBatchListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    batches: list[TrafficBatchItemResponse]


class DataQualityEventItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_identifier: str
    event_type: str
    event_start: datetime
    event_end: Optional[datetime] = None
    missing_intervals: Optional[int] = None
    details: Optional[str] = None
    created_at: datetime


class IngestionRejectionItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    batch_id: Optional[str] = None
    raw_record: str
    rejection_reason: str
    created_at: datetime


class TrafficQualityResponse(BaseModel):
    quality_events_count: int
    quality_events: list[DataQualityEventItemResponse]
    rejections_count: int
    rejections: list[IngestionRejectionItemResponse]
    source_breakdown: dict[str, int]


# ============================================================================
# ML Monitoring Schemas
# ============================================================================

class RegisteredModelItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    job_id: str
    dataset_identity: str
    dataset_version: str
    feature_names: str
    feature_schema_version: str
    training_config: str
    random_seed: int
    evaluation_metrics: str
    model_framework_version: str
    artifact_path: str
    artifact_checksum_sha256: str
    is_active: int
    review_status: str
    trained_by: str
    trained_at: datetime
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    deployed_by: Optional[str] = None
    deployed_at: Optional[datetime] = None


class ModelRegistryListResponse(BaseModel):
    total: int
    active_model_id: Optional[str] = None
    models: list[RegisteredModelItemResponse]


class TrainingJobItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    triggered_by: str
    status: str
    dataset_name: str
    dataset_version: str
    hyperparameters: str
    random_seed: int
    metrics: Optional[str] = None
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime


class TrainingJobListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    jobs: list[TrainingJobItemResponse]


# ============================================================================
# System Monitoring Schemas
# ============================================================================

class WorkerStatusItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    worker_id: str
    pid: int
    loaded_version: int
    loaded_model_id: str
    status: str
    error_message: Optional[str] = None
    last_heartbeat: datetime
    is_stale: bool = False


class WorkerStatusListResponse(BaseModel):
    total: int
    workers: list[WorkerStatusItemResponse]

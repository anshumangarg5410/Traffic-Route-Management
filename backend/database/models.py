from datetime import datetime
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    asc,
    desc,
    text,
)
from sqlalchemy.orm import Mapped, backref, mapped_column, relationship

from backend.database.base import Base


# 1. System Coordination & Distributed Locks
class SystemCoordination(Base):
    __tablename__ = "system_coordination"

    lock_name: Mapped[str] = mapped_column(Text, primary_key=True)
    locked_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# 2. User Management & Authentication
class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False, server_default="user")
    is_active: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint("role IN ('user', 'admin')", name="ck_users_role"),
        CheckConstraint("is_active IN (0, 1)", name="ck_users_is_active"),
    )


# 3. Long-Lived Refresh Tokens
class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    family_id: Mapped[str] = mapped_column(Text, nullable=False)
    is_revoked: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped["User"] = relationship(
        "User", backref=backref("refresh_tokens", cascade="all, delete-orphan", passive_deletes=True)
    )

    __table_args__ = (
        CheckConstraint("is_revoked IN (0, 1)", name="ck_refresh_tokens_is_revoked"),
        Index("idx_refresh_tokens_family", "family_id"),
    )


# 4. Cross-Worker SSE Tickets
class SSETicket(Base):
    __tablename__ = "sse_tickets"

    ticket_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_version: Mapped[int] = mapped_column(Integer, nullable=False)
    scope: Mapped[str] = mapped_column(Text, nullable=False)
    resource_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_consumed: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped["User"] = relationship(
        "User", backref=backref("sse_tickets", cascade="all, delete-orphan", passive_deletes=True)
    )

    __table_args__ = (
        CheckConstraint(
            "scope IN ('ml_job_logs', 'system_metrics')", name="ck_sse_tickets_scope"
        ),
        CheckConstraint("is_consumed IN (0, 1)", name="ck_sse_tickets_is_consumed"),
        Index("idx_sse_tickets_lookup", "ticket_hash", "is_consumed", "expires_at"),
    )


# 5. User Saved Routes & Bookmarks
class SavedRoute(Base):
    __tablename__ = "saved_routes"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    origin_name: Mapped[str] = mapped_column(Text, nullable=False)
    origin_lat: Mapped[float] = mapped_column(Float, nullable=False)
    origin_lon: Mapped[float] = mapped_column(Float, nullable=False)
    destination_name: Mapped[str] = mapped_column(Text, nullable=False)
    destination_lat: Mapped[float] = mapped_column(Float, nullable=False)
    destination_lon: Mapped[float] = mapped_column(Float, nullable=False)
    preferred_criteria: Mapped[str] = mapped_column(Text, nullable=False)
    distance_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimated_duration_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    route_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    route_geometry: Mapped[str | None] = mapped_column(Text, nullable=True)
    recommendation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped["User"] = relationship(
        "User", backref=backref("saved_routes", cascade="all, delete-orphan", passive_deletes=True)
    )

    __table_args__ = (Index("idx_saved_routes_user", "user_id"),)


# 6. User Trip & Search History
class RouteSearchHistory(Base):
    __tablename__ = "route_search_history"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    origin_query: Mapped[str] = mapped_column(Text, nullable=False)
    destination_query: Mapped[str] = mapped_column(Text, nullable=False)
    selected_route_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    route_distance_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimated_duration_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped["User"] = relationship(
        "User", backref=backref("search_history", cascade="all, delete-orphan", passive_deletes=True)
    )

    __table_args__ = (
        Index("idx_user_history_user_time", "user_id", desc("created_at")),
    )


# 7. Traffic Ingestion Batches (Audit Trail)
class TrafficIngestionBatch(Base):
    __tablename__ = "traffic_ingestion_batches"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    batch_name: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[str] = mapped_column(Text, nullable=False)
    submitted_by: Mapped[str | None] = mapped_column(
        Text, ForeignKey("users.id"), nullable=True
    )
    total_records: Mapped[int] = mapped_column(Integer, nullable=False)
    accepted_records: Mapped[int] = mapped_column(Integer, nullable=False)
    rejected_records: Mapped[int] = mapped_column(Integer, nullable=False)
    raw_payload_blob: Mapped[str | None] = mapped_column(Text, nullable=True)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    submitter: Mapped["User | None"] = relationship(
        "User", backref="ingestion_batches"
    )

    __table_args__ = (
        CheckConstraint(
            "source_type IN ('REAL_SENSOR', 'SIMULATION_SYNTHETIC', 'HISTORICAL_BENCHMARK')",
            name="ck_traffic_ingestion_batches_source_type",
        ),
    )


# 8. Traffic Observations (Immutable Raw Data)
class TrafficObservation(Base):
    __tablename__ = "traffic_observations"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    batch_id: Mapped[str | None] = mapped_column(
        Text, ForeignKey("traffic_ingestion_batches.id"), nullable=True
    )
    source_identifier: Mapped[str] = mapped_column(Text, nullable=False)
    data_source: Mapped[str] = mapped_column(Text, nullable=False)
    approach_direction: Mapped[str] = mapped_column(Text, nullable=False)
    lane_index: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    sampling_interval_s: Mapped[int] = mapped_column(Integer, nullable=False)
    raw_vehicle_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    raw_speed_kmh: Mapped[float | None] = mapped_column(Float, nullable=True)
    quality_tag: Mapped[str] = mapped_column(Text, nullable=False, server_default="VALID")
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    batch: Mapped["TrafficIngestionBatch | None"] = relationship(
        "TrafficIngestionBatch", backref="observations"
    )

    __table_args__ = (
        CheckConstraint(
            "data_source IN ('REAL_SENSOR', 'SIMULATION_SYNTHETIC', 'HISTORICAL_BENCHMARK')",
            name="ck_traffic_obs_data_source",
        ),
        CheckConstraint(
            "approach_direction IN ('north', 'south', 'east', 'west')",
            name="ck_traffic_obs_approach_direction",
        ),
        CheckConstraint(
            "quality_tag IN ('VALID', 'SUSPICIOUS_SPIKE', 'OUT_OF_RANGE', 'BELOW_FLOOR')",
            name="ck_traffic_obs_quality_tag",
        ),
        UniqueConstraint(
            "source_identifier",
            "observed_at",
            "approach_direction",
            "lane_index",
            "sampling_interval_s",
            name="uq_observation",
        ),
        Index("idx_traffic_obs_source_time", "source_identifier", desc("observed_at")),
        Index("idx_traffic_obs_ingested", desc("ingested_at")),
    )


# 9. Data Quality & Gap Events
class DataQualityEvent(Base):
    __tablename__ = "data_quality_events"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    source_identifier: Mapped[str] = mapped_column(Text, nullable=False)
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    event_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    event_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    missing_intervals: Mapped[int | None] = mapped_column(Integer, nullable=True)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint(
            "event_type IN ('SAMPLING_GAP', 'DETECTOR_OFFLINE', 'HARDWARE_FAULT')",
            name="ck_data_quality_events_event_type",
        ),
    )


# 10. Dead-Letter Ingestion Rejections
class IngestionRejection(Base):
    __tablename__ = "ingestion_rejections"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    batch_id: Mapped[str | None] = mapped_column(
        Text, ForeignKey("traffic_ingestion_batches.id"), nullable=True
    )
    raw_record: Mapped[str] = mapped_column(Text, nullable=False)
    rejection_reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    batch: Mapped["TrafficIngestionBatch | None"] = relationship(
        "TrafficIngestionBatch", backref="rejections"
    )


# 11. ML Training Jobs & State Machine
class MLTrainingJob(Base):
    __tablename__ = "ml_training_jobs"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    triggered_by: Mapped[str] = mapped_column(
        Text, ForeignKey("users.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(Text, nullable=False)
    dataset_name: Mapped[str] = mapped_column(Text, nullable=False)
    dataset_version: Mapped[str] = mapped_column(Text, nullable=False)
    hyperparameters: Mapped[str] = mapped_column(Text, nullable=False)
    random_seed: Mapped[int] = mapped_column(Integer, nullable=False)
    metrics: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    process_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    process_create_time: Mapped[float | None] = mapped_column(Float, nullable=True)
    child_heartbeat: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    job_process_pid: Mapped[int | None] = mapped_column(Integer, nullable=True)
    supervisor_worker_pid: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped["User"] = relationship("User", backref="ml_jobs")

    __table_args__ = (
        CheckConstraint(
            "status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')",
            name="ck_ml_training_jobs_status",
        ),
        Index("idx_ml_jobs_status_created", "status", desc("created_at")),
    )


# 12. ML Job Logs (for Cross-Worker Replay)
class MLJobLog(Base):
    __tablename__ = "ml_job_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(
        Text, ForeignKey("ml_training_jobs.id", ondelete="CASCADE"), nullable=False
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    level: Mapped[str] = mapped_column(Text, nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    job: Mapped["MLTrainingJob"] = relationship(
        "MLTrainingJob", backref=backref("logs", cascade="all, delete-orphan", passive_deletes=True)
    )

    __table_args__ = (
        CheckConstraint(
            "level IN ('DEBUG', 'INFO', 'WARNING', 'ERROR')",
            name="ck_ml_job_logs_level",
        ),
        UniqueConstraint("job_id", "seq", name="uq_job_log_seq"),
        Index("idx_ml_job_logs_stream", "job_id", asc("seq")),
    )


# 13. Reproducible Model Registry
class ModelRegistry(Base):
    __tablename__ = "model_registry"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    job_id: Mapped[str] = mapped_column(
        Text, ForeignKey("ml_training_jobs.id"), nullable=False
    )
    dataset_identity: Mapped[str] = mapped_column(Text, nullable=False)
    dataset_version: Mapped[str] = mapped_column(Text, nullable=False)
    feature_names: Mapped[str] = mapped_column(Text, nullable=False)
    feature_schema_version: Mapped[str] = mapped_column(Text, nullable=False)
    training_config: Mapped[str] = mapped_column(Text, nullable=False)
    random_seed: Mapped[int] = mapped_column(Integer, nullable=False)
    evaluation_metrics: Mapped[str] = mapped_column(Text, nullable=False)
    model_framework_version: Mapped[str] = mapped_column(Text, nullable=False)
    artifact_path: Mapped[str] = mapped_column(Text, nullable=False)
    artifact_checksum_sha256: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    trained_by: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    trained_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reviewed_by: Mapped[str | None] = mapped_column(
        Text, ForeignKey("users.id"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    review_status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="PENDING_REVIEW"
    )
    deployed_by: Mapped[str | None] = mapped_column(
        Text, ForeignKey("users.id"), nullable=True
    )
    deployed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    rollback_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    rollback_by: Mapped[str | None] = mapped_column(
        Text, ForeignKey("users.id"), nullable=True
    )

    job: Mapped["MLTrainingJob"] = relationship("MLTrainingJob", backref="registered_models")
    trainer: Mapped["User"] = relationship("User", foreign_keys=[trained_by])
    reviewer: Mapped["User | None"] = relationship("User", foreign_keys=[reviewed_by])
    deployer: Mapped["User | None"] = relationship("User", foreign_keys=[deployed_by])
    rollbacker: Mapped["User | None"] = relationship("User", foreign_keys=[rollback_by])

    __table_args__ = (
        CheckConstraint("is_active IN (0, 1)", name="ck_model_registry_is_active"),
        CheckConstraint(
            "review_status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED')",
            name="ck_model_registry_review_status",
        ),
        # Partial Unique Index: at most ONE model can ever be active (is_active = 1)
        Index(
            "idx_single_active_model",
            "is_active",
            unique=True,
            sqlite_where=text("is_active = 1"),
        ),
    )


# 14. Active Model Deployment Singleton
class ActiveModelDeployment(Base):
    __tablename__ = "active_model_deployment"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    model_id: Mapped[str] = mapped_column(
        Text, ForeignKey("model_registry.id"), nullable=False
    )
    target_version: Mapped[int] = mapped_column(Integer, nullable=False)
    deployed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    deployed_by: Mapped[str] = mapped_column(
        Text, ForeignKey("users.id"), nullable=False
    )

    model: Mapped["ModelRegistry"] = relationship("ModelRegistry")
    deployer: Mapped["User"] = relationship("User")

    __table_args__ = (
        CheckConstraint("id = 1", name="ck_active_model_deployment_singleton"),
    )


# 15. Worker Deployment Sync Status
class WorkerDeploymentStatus(Base):
    __tablename__ = "worker_deployment_status"

    worker_id: Mapped[str] = mapped_column(Text, primary_key=True)
    pid: Mapped[int] = mapped_column(Integer, nullable=False)
    loaded_version: Mapped[int] = mapped_column(Integer, nullable=False)
    loaded_model_id: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_heartbeat: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('READY', 'LOAD_FAILED', 'CHECKSUM_MISMATCH')",
            name="ck_worker_deployment_status",
        ),
    )


# 16. Administrative Audit Logs
class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    actor_id: Mapped[str | None] = mapped_column(
        Text, ForeignKey("users.id"), nullable=True
    )
    action: Mapped[str] = mapped_column(Text, nullable=False)
    target_entity: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[str] = mapped_column(Text, nullable=False)
    ip_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    actor: Mapped["User | None"] = relationship("User", backref="audit_logs")

    __table_args__ = (
        CheckConstraint(
            "action IN ('USER_ROLE_CHANGE', 'USER_STATUS_CHANGE', 'MODEL_DEPLOY', 'MODEL_ROLLBACK', 'NETWORK_BUILD', 'DATASET_INGEST')",
            name="ck_audit_logs_action",
        ),
        Index("idx_audit_logs_actor_time", "actor_id", desc("created_at")),
    )

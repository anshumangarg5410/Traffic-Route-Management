# ITMS Database Foundation (Phase 11.2)

This directory contains the database foundation for the Intelligent Traffic Management System (ITMS). The architecture strictly implements the blueprint approved in Phase 11.1 (`phase_11_1_architecture_report_corrected.md`), utilizing an asynchronous SQLite persistence layer with SQLAlchemy 2.x, `aiosqlite`, and Alembic.

---

## 1. Directory Structure

```text
backend/database/
├── __init__.py         # Public exports (Base, models, engines, session factories, dependencies)
├── base.py             # DeclarativeBase definition
├── config.py           # Absolute directory resolution & DATABASE_URL configuration
├── session.py          # Dual-engine architecture, PRAGMA listeners, and FastAPI dependencies
├── models.py           # Declarative ORM models for all 16 system tables
├── migrate.py          # Pre-startup WAL verification and Alembic migration runner
└── README.md           # Database foundation documentation
```

---

## 2. Path Resolution & Environment Configuration

Database paths are resolved relative to the backend package root, ensuring complete independence from the process Current Working Directory (CWD):

- **Default SQLite Database File:** `backend/data/itms.db`
- **Environment Override:** Set the `DATABASE_URL` environment variable:
  ```bash
  export DATABASE_URL="sqlite+aiosqlite:////absolute/path/to/database.db"
  ```
- **Helper Functions (`backend/database/config.py`):**
  - `get_sync_database_url()`: Converts `sqlite+aiosqlite://` to `sqlite://` for synchronous tooling (Alembic offline mode, sync scripts).
  - `get_db_file_path()`: Extracts a `pathlib.Path` pointing to the underlying SQLite file.

---

## 3. Dual-Engine Architecture & SQLite Locking

SQLite in WAL mode permits concurrent readers alongside a single active writer. To balance maximum read throughput with race-free guarantees for critical operations without global lock contention, ITMS implements a **dual-engine architecture**:

| Component | Engine | Transaction Type | Intended Use Case |
| :--- | :--- | :--- | :--- |
| **Standard Session** (`get_db`, `async_session_factory`) | `engine` | Deferred (`BEGIN`) | Ordinary reads, route queries, user profile updates, bookmarks, search history, raw traffic observation batch ingestion, and audit logs. |
| **Critical Session** (`get_critical_db`, `critical_session_factory`) | `critical_engine` | Immediate (`BEGIN IMMEDIATE`) | Strictly reserved for: (1) Last-active-admin demotion/suspension protection, (2) Cross-worker single-active ML training job claim, and (3) Cross-worker startup recovery lease acquisition. |

### Immediate Write Lock Semantics
The `critical_engine` registers a dedicated SQLAlchemy event listener:
```python
@event.listens_for(critical_engine.sync_engine, "begin")
def set_sqlite_immediate_begin(conn):
    conn.exec_driver_sql("BEGIN IMMEDIATE")
```
When a transaction opens through `critical_session_factory()`, SQLite immediately reserves its write lock (tracked in the `-shm` index). Concurrent readers continue reading consistent snapshots via WAL, but competing writers pause and retry up to the 5,000 ms busy timeout before failing.

---

## 4. PRAGMA Configuration & WAL Mode Lifecycle

### Connection-Level PRAGMAs (Applied to Every Connection)
Applied automatically via `@event.listens_for(sync_engine, "connect")` on both `engine` and `critical_engine`:
1. `PRAGMA foreign_keys = ON;`: Enforces relational integrity and cascading foreign keys across all operations.
2. `PRAGMA busy_timeout = 5000;`: Instructs SQLite to sleep and retry internally for up to 5,000 ms when encountering a locked database before raising `sqlite3.OperationalError`.

### Database-Level Persistent Header Property (`journal_mode = WAL`)
- `journal_mode = WAL` is a persistent database file header property.
- Established and verified once during pre-startup migration execution (`python -m backend.database.migrate`).
- **Startup Failure Behavior:** If `PRAGMA journal_mode = WAL;` does not return `"wal"` (e.g. if the file is on an unsupported network filesystem lacking POSIX shared memory), the runner logs a critical error and aborts with exit code `1`. The application never starts in a degraded rollback journal mode.

---

## 5. Schema Model Inventory (16 Tables)

All models inherit from `backend.database.base.Base` and are declared in `backend/database/models.py`:

| # | Model Class | Table Name | Key Constraints & Indexes |
| :-: | :--- | :--- | :--- |
| 1 | `SystemCoordination` | `system_coordination` | `lock_name` PK. Seeded with `'startup_recovery'` for distributed leader election. |
| 2 | `User` | `users` | `email` UNIQUE, `CHECK (role IN ('user', 'admin'))`, `CHECK (is_active IN (0, 1))`. |
| 3 | `RefreshToken` | `refresh_tokens` | `token_hash` UNIQUE, `CHECK (is_revoked IN (0, 1))`, FK `users.id` (CASCADE), index on `family_id`. |
| 4 | `SSETicket` | `sse_tickets` | `ticket_hash` PK, `CHECK (scope IN ('ml_job_logs', 'system_metrics'))`, `CHECK (is_consumed IN (0, 1))`, lookup index on `(ticket_hash, is_consumed, expires_at)`. |
| 5 | `SavedRoute` | `saved_routes` | FK `users.id` (CASCADE), index on `user_id`. Stores route preferences as JSON string. |
| 6 | `RouteSearchHistory` | `route_search_history` | FK `users.id` (CASCADE), index on `(user_id, created_at DESC)`. |
| 7 | `TrafficIngestionBatch` | `traffic_ingestion_batches` | `CHECK (source_type IN ('REAL_SENSOR', 'SIMULATION_SYNTHETIC', 'HISTORICAL_BENCHMARK'))`. |
| 8 | `TrafficObservation` | `traffic_observations` | `CHECK (data_source ...)`, `CHECK (approach_direction ...)`, `CHECK (quality_tag ...)`. Nullable vehicle count & speed (distinguishes offline detector from 0 traffic). Unique composite constraint `uq_observation` on `(source_identifier, observed_at, approach_direction, lane_index, sampling_interval_s)`. Indexes on `(source_identifier, observed_at DESC)` and `(ingested_at DESC)`. |
| 9 | `DataQualityEvent` | `data_quality_events` | `CHECK (event_type IN ('SAMPLING_GAP', 'DETECTOR_OFFLINE', 'HARDWARE_FAULT'))`. |
| 10 | `IngestionRejection` | `ingestion_rejections` | Dead-letter queue for malformed payloads. FK `traffic_ingestion_batches.id`. |
| 11 | `MLTrainingJob` | `ml_training_jobs` | `CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'))`. Tracks process token, creation epoch time, child heartbeat, child PID, and supervisor worker PID. Index on `(status, created_at DESC)`. |
| 12 | `MLJobLog` | `ml_job_logs` | Autoincrement PK, FK `ml_training_jobs.id` (CASCADE), `CHECK (level ...)`. Unique constraint `(job_id, seq)`. Stream replay index on `(job_id, seq ASC)`. |
| 13 | `ModelRegistry` | `model_registry` | Tracks 11-feature contract, hyperparameter metadata, SHA-256 artifact checksum. `CHECK (is_active IN (0, 1))`. **Partial Unique Index:** `idx_single_active_model` on `(is_active) WHERE is_active = 1` guarantees at most one active model system-wide. |
| 14 | `ActiveModelDeployment` | `active_model_deployment` | Singleton table enforced by `CHECK (id = 1)`. FK `model_registry.id`. |
| 15 | `WorkerDeploymentStatus` | `worker_deployment_status` | Worker heartbeat registry. `CHECK (status IN ('READY', 'LOAD_FAILED', 'CHECKSUM_MISMATCH'))`. |
| 16 | `AuditLog` | `audit_logs` | Immutable audit trail. `CHECK (action ...)`. Index on `(actor_id, created_at DESC)`. |

---

## 6. Alembic Migrations

Alembic is configured for asynchronous SQLAlchemy migrations via `backend/alembic/` and root `alembic.ini`.

### Pre-Startup Migration Execution
To apply migrations and verify SQLite WAL mode prior to starting Uvicorn:
```bash
python3 -m backend.database.migrate
```

### Manual Alembic Commands
```bash
# Generate a new autogenerated revision after modifying models
python3 -m alembic revision --autogenerate -m "describe_change"

# Upgrade database to latest revision
python3 -m alembic upgrade head

# Roll back the most recent revision
python3 -m alembic downgrade -1

# Roll back completely to base
python3 -m alembic downgrade base
```

---

## 7. Automated Testing & Verification

The test suite covers database configuration, WAL mode, connection PRAGMAs, foreign keys, dual-engine concurrency, check constraints, partial unique indexes, cascade deletions, and migration rollback cycles:

```bash
# Run database test suite (23 tests)
python3 -m pytest backend/test_database.py -v

# Run full project regression suite (261 backend tests + 24 frontend tests)
python3 -m pytest && npm test --prefix frontend
```

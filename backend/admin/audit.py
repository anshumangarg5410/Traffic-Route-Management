from datetime import datetime, timezone
import json
from typing import Any, Optional
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.models import AuditLog

ALLOWED_ACTIONS = {
    "USER_ROLE_CHANGE",
    "USER_STATUS_CHANGE",
    "MODEL_DEPLOY",
    "MODEL_ROLLBACK",
    "NETWORK_BUILD",
    "DATASET_INGEST",
}


def create_audit_record(
    actor_id: Optional[str],
    action: str,
    target_entity: str,
    details: Any,
    ip_address: Optional[str] = None,
) -> AuditLog:
    """
    Construct an AuditLog instance adhering to database check constraints.
    Serializes dictionary details into JSON strings while omitting sensitive credentials.
    """
    if action not in ALLOWED_ACTIONS:
        raise ValueError(
            f"Invalid audit action '{action}'. Permitted actions: {sorted(ALLOWED_ACTIONS)}"
        )

    if isinstance(details, (dict, list)):
        # Strip out any accidental token or password keys
        if isinstance(details, dict):
            sanitized = {
                k: v
                for k, v in details.items()
                if "password" not in k.lower()
                and "token" not in k.lower()
                and "secret" not in k.lower()
            }
        else:
            sanitized = details
        details_str = json.dumps(sanitized, sort_keys=True)
    else:
        details_str = str(details)

    return AuditLog(
        id=uuid.uuid4().hex,
        actor_id=actor_id,
        action=action,
        target_entity=target_entity,
        details=details_str,
        ip_address=ip_address,
        created_at=datetime.now(timezone.utc),
    )


async def log_audit_event(
    session: AsyncSession,
    actor_id: Optional[str],
    action: str,
    target_entity: str,
    details: Any,
    ip_address: Optional[str] = None,
) -> AuditLog:
    """
    Record an administrative audit event in the provided database session.
    Flushes the record so it is included in the current write transaction,
    ensuring that it commits or rolls back together with the associated mutation.
    """
    record = create_audit_record(
        actor_id=actor_id,
        action=action,
        target_entity=target_entity,
        details=details,
        ip_address=ip_address,
    )
    session.add(record)
    await session.flush()
    return record
